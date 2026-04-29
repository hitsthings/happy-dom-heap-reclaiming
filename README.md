# happy-dom Memory Leak Reproduction

Reproduces a memory leak in [happy-dom](https://github.com/capricorn86/happy-dom) v20.9.0 where documents created by `DOMParser.parseFromString()` are never cleaned up by `window.happyDOM.close()`.

## Running the tests

```sh
npm install
npm test
```

Tests use the Node.js built-in test runner with `--expose-gc` to allow manual garbage collection control.

## Findings

### Root cause: parsed documents are orphaned from cleanup

`DOMParser.parseFromString()` creates a new `HTMLDocument` and sets its `defaultView` to the parent window, but the window never tracks these documents. When `window.happyDOM.close()` is called, it destroys the window's own document via `document[PropertySymbol.destroy]()`, but parsed documents are never reached by this cleanup chain.

`document.close()` is unrelated to memory management -- it is the web API for ending a `document.write()` stream and does not release any resources.

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

Manually calling `removeChild` on all body children eliminates the growth:

```js
const document = new localWindow.DOMParser().parseFromString(html, 'text/html');
while (document.body.firstChild) {
  document.body.removeChild(document.body.firstChild);
}
```

| Iteration | Without removeChild | With removeChild |
|-----------|---------------------|------------------|
| 1         | 21 MB               | 21 MB            |
| 100       | 449 MB              | 62 MB            |
| 250       | 1,089 MB            | 35 MB            |
| 500       | 2,159 MB            | 53 MB            |

With `removeChild`, heap stays flat (~50 MB), confirming that the DOM nodes are what's being retained.

### The memory is eventually GC-reclaimable

With aggressive GC (5 rounds of `gc()` + 50ms delay), the retained memory is eventually collected. The nodes are not permanently leaked via strong references from a global root. Rather, `happyDOM.close()` does not destroy parsed documents, leaving large object graphs reachable until a future GC cycle collects them once all JS references go out of scope.

## Test structure

- **Assertion tests** -- verify that retained heap stays under 5 MB after 2,000 iterations with aggressive GC
- **Diagnostic tests** -- measure raw heap growth without intermediate GC to show the per-iteration accumulation pattern
