# happy-dom Memory Leak Reproduction

Reproduces a memory leak in [happy-dom](https://github.com/nicedoc/happy-dom) v20.9.0 where `document.close()` and `window.happyDOM.close()` do not release DOM nodes from parsed documents.

## Running the tests

```sh
npm install
npm test
```

Tests use the Node.js built-in test runner with `--expose-gc` to allow manual garbage collection control.

## Findings

### The leak: `document.close()` does not release DOM nodes

When using `DOMParser.parseFromString()` to parse HTML, calling `document.close()` followed by `window.happyDOM.close()` does not detach child nodes from the document. Each parsed document retains memory proportional to its DOM size, and that memory is not freed.

### Growth is linear and per-document

Each parse cycle adds a fixed amount of retained heap proportional to the document size. With no GC between iterations:

| Iteration | RICH_HTML (20 list items) | LARGE_HTML (200 list items) |
|-----------|--------------------------|------------------------------|
| 1         | 17 MB                    | 21 MB                        |
| 100       | 96 MB                    | 449 MB                       |
| 500       | 414 MB                   | 2,159 MB                     |
| 2000      | 1,590 MB                 | OOM                          |

~0.5 MB/parse for the 20-item doc, ~4.3 MB/parse for the 200-item doc. 10x more DOM nodes = 10x more retained memory.

### The leak is in DOMParser, not Window

Using a single `Window` and creating a new `DOMParser` for each iteration produces the same linear growth. The `Window` itself is not the source.

### Workaround: manually remove children

Manually calling `removeChild` on all body children before `document.close()` eliminates the growth:

```js
const document = new localWindow.DOMParser().parseFromString(html, 'text/html');
while (document.body.firstChild) {
  document.body.removeChild(document.body.firstChild);
}
document.close();
```

| Iteration | Without removeChild | With removeChild |
|-----------|---------------------|------------------|
| 1         | 21 MB               | 21 MB            |
| 100       | 449 MB              | 62 MB            |
| 250       | 1,089 MB            | 35 MB            |
| 500       | 2,159 MB            | 53 MB            |

With `removeChild`, heap stays flat (~50 MB), confirming that `close()` is not detaching the DOM tree.

### The memory is eventually GC-reclaimable

With aggressive GC (5 rounds of `gc()` + 50ms delay), the retained memory is eventually collected. This means the nodes are not permanently leaked via strong references from a global root, but rather that `close()` fails to eagerly release internal references, leaving large object graphs reachable until a future GC cycle finds them unreachable through other means.

## Test structure

- **Assertion tests** -- verify that retained heap stays under 5 MB after 2,000 iterations with aggressive GC
- **Diagnostic tests** -- measure raw heap growth without intermediate GC to show the per-iteration accumulation pattern
