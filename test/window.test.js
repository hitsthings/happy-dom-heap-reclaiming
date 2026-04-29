const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Window } = require('happy-dom');

const SIMPLE_HTML = '<html><body><h1>Hello</h1><p>World</p></body></html>';

const RICH_HTML = `
  <p>Some intro text with a smart link
    <a href="https://example.atlassian.net/browse/DEV-21" title="smart-card" class="external-link" rel="nofollow noreferrer">https://example.atlassian.net/browse/DEV-21</a>
  </p>
  <span class="jira-issue-macro" data-jira-key="DEV-32">
    <a href="https://example.atlassian.net/browse/DEV-32" class="jira-issue-macro-key issue-link" title="Flagged issue">
      <img class="icon" src="https://example.atlassian.net/avatar.png" />DEV-32
    </a>
    <span class="aui-lozenge">Happening</span>
  </span>
  <ul>
    ${Array.from({ length: 20 }, (_, i) => `<li>Item ${i} with <strong>bold</strong> and <em>italics</em></li>`).join('')}
  </ul>
`;

const LARGE_HTML = `
  <p>Some intro text with a smart link
    <a href="https://example.atlassian.net/browse/DEV-21" title="smart-card" class="external-link" rel="nofollow noreferrer">https://example.atlassian.net/browse/DEV-21</a>
  </p>
  <span class="jira-issue-macro" data-jira-key="DEV-32">
    <a href="https://example.atlassian.net/browse/DEV-32" class="jira-issue-macro-key issue-link" title="Flagged issue">
      <img class="icon" src="https://example.atlassian.net/avatar.png" />DEV-32
    </a>
    <span class="aui-lozenge">Happening</span>
  </span>
  <ul>
    ${Array.from({ length: 200 }, (_, i) => `<li>Item ${i} with <strong>bold</strong> and <em>italics</em></li>`).join('')}
  </ul>
`;

const ITERATIONS = 2_000;

// Empirically, the un-fixed path retains tens of MB after 2k iterations
// (each un-closed Window keeps ~tens of KB reachable). The fixed path stays
// in the low single-digit MBs. 5 MB is the divider — it cleanly separates
// the two regimes without being flaky on either side.
const RETAINED_HEAP_LIMIT_BYTES = 5 * 1024 * 1024;

async function measureRetainedHeap(work, iterations) {
  for (let i = 0; i < 5; i++) {
    gc();
    await new Promise(r => setTimeout(r, 50));
  }

  const before = process.memoryUsage().heapUsed;

  for (let i = 0; i < iterations; i++) work();

  for (let i = 0; i < 5; i++) {
    gc();
    await new Promise(r => setTimeout(r, 50));
  }

  const after = process.memoryUsage().heapUsed;
  return after - before;
}

describe('happy-dom memory leaks', () => {
  it('does not retain when creating a window', async () => {
    const retained = await measureRetainedHeap(
      () => {
        const localWindow = new Window({
          settings: {
            disableJavaScriptEvaluation: true,
            disableJavaScriptFileLoading: true,
            disableCSSFileLoading: true,
            disableIframePageLoading: true,
            disableComputedStyleRendering: true,
          },
        });
        // const document = new localWindow.DOMParser().parseFromString(SIMPLE_HTML, 'text/html');
        // document.close();
        localWindow.happyDOM.close();
      },
      ITERATIONS,
    );
    assert.ok(retained < RETAINED_HEAP_LIMIT_BYTES,
      `Retained ${(retained / 1024 / 1024).toFixed(2)} MB exceeds ${RETAINED_HEAP_LIMIT_BYTES / 1024 / 1024} MB limit`);
  });

  it('does not retain when parsing a document', async () => {
    const retained = await measureRetainedHeap(
      () => {
        const localWindow = new Window({
          settings: {
            disableJavaScriptEvaluation: true,
            disableJavaScriptFileLoading: true,
            disableCSSFileLoading: true,
            disableIframePageLoading: true,
            disableComputedStyleRendering: true,
          },
        });
        const document = new localWindow.DOMParser().parseFromString(SIMPLE_HTML, 'text/html');
        document.close();
        localWindow.happyDOM.close();
      },
      ITERATIONS,
    );
    assert.ok(retained < RETAINED_HEAP_LIMIT_BYTES,
      `Retained ${(retained / 1024 / 1024).toFixed(2)} MB exceeds ${RETAINED_HEAP_LIMIT_BYTES / 1024 / 1024} MB limit`);
  });

  it('subset: large list only', async () => {
    const retained = await measureRetainedHeap(
      () => {
        const localWindow = new Window({
          settings: {
            disableJavaScriptEvaluation: true,
            disableJavaScriptFileLoading: true,
            disableCSSFileLoading: true,
            disableIframePageLoading: true,
            disableComputedStyleRendering: true,
          },
        });
        const document = new localWindow.DOMParser().parseFromString(LARGE_HTML, 'text/html');
        document.close();
        localWindow.happyDOM.close();
      },
      500,
    );
    assert.ok(retained < RETAINED_HEAP_LIMIT_BYTES,
      `Retained ${(retained / 1024 / 1024).toFixed(2)} MB exceeds ${RETAINED_HEAP_LIMIT_BYTES / 1024 / 1024} MB limit`);
  });

  it('does not retain when parsing a rich document', async () => {
    const retained = await measureRetainedHeap(
      () => {
        const localWindow = new Window({
          settings: {
            disableJavaScriptEvaluation: true,
            disableJavaScriptFileLoading: true,
            disableCSSFileLoading: true,
            disableIframePageLoading: true,
            disableComputedStyleRendering: true,
          },
        });
        const document = new localWindow.DOMParser().parseFromString(RICH_HTML, 'text/html');
        document.close();
        localWindow.happyDOM.close();
      },
      ITERATIONS,
    );
    assert.ok(retained < RETAINED_HEAP_LIMIT_BYTES,
      `Retained ${(retained / 1024 / 1024).toFixed(2)} MB exceeds ${RETAINED_HEAP_LIMIT_BYTES / 1024 / 1024} MB limit`);
  });

  it('heap growth per window (diagnostic)', async () => {
    gc();
    await new Promise(r => setTimeout(r, 50));
    gc();

    const samples = [];
    const samplePoints = [1, 10, 50, 100, 250, 500, 1000, 2000];

    for (let i = 1; i <= ITERATIONS; i++) {
      const localWindow = new Window({
        settings: {
          disableJavaScriptEvaluation: true,
          disableJavaScriptFileLoading: true,
          disableCSSFileLoading: true,
          disableIframePageLoading: true,
          disableComputedStyleRendering: true,
        },
      });
      const document = new localWindow.DOMParser().parseFromString(RICH_HTML, 'text/html');
      document.close();
      localWindow.happyDOM.close();

      if (samplePoints.includes(i)) {
        samples.push({ iteration: i, heapMB: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) });
      }
    }

    console.log('\nHeap growth over iterations (no GC between iterations):');
    console.log('Iteration | Heap (MB)');
    console.log('----------|----------');
    for (const s of samples) {
      console.log(`${String(s.iteration).padStart(9)} | ${s.heapMB}`);
    }
  });

  it('heap growth per DOMParser on single window (diagnostic)', async () => {
    gc();
    await new Promise(r => setTimeout(r, 50));
    gc();

    const localWindow = new Window({
      settings: {
        disableJavaScriptEvaluation: true,
        disableJavaScriptFileLoading: true,
        disableCSSFileLoading: true,
        disableIframePageLoading: true,
        disableComputedStyleRendering: true,
      },
    });

    const samples = [];
    const samplePoints = [1, 10, 50, 100, 250, 500, 1000, 2000];

    for (let i = 1; i <= ITERATIONS; i++) {
      const document = new localWindow.DOMParser().parseFromString(RICH_HTML, 'text/html');
      document.close();

      if (samplePoints.includes(i)) {
        samples.push({ iteration: i, heapMB: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) });
      }
    }

    localWindow.happyDOM.close();

    console.log('\nHeap growth per DOMParser (single window, no GC between iterations):');
    console.log('Iteration | Heap (MB)');
    console.log('----------|----------');
    for (const s of samples) {
      console.log(`${String(s.iteration).padStart(9)} | ${s.heapMB}`);
    }
  });

  it('heap growth per DOMParser on single window with large doc (diagnostic)', async () => {
    gc();
    await new Promise(r => setTimeout(r, 50));
    gc();

    const localWindow = new Window({
      settings: {
        disableJavaScriptEvaluation: true,
        disableJavaScriptFileLoading: true,
        disableCSSFileLoading: true,
        disableIframePageLoading: true,
        disableComputedStyleRendering: true,
      },
    });

    const largeIterations = 500;
    const samples = [];
    const samplePoints = [1, 10, 50, 100, 250, 500];

    for (let i = 1; i <= largeIterations; i++) {
      const document = new localWindow.DOMParser().parseFromString(LARGE_HTML, 'text/html');
      document.close();

      if (samplePoints.includes(i)) {
        samples.push({ iteration: i, heapMB: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) });
      }
    }

    localWindow.happyDOM.close();

    console.log('\nHeap growth per DOMParser with large doc (single window, no GC between iterations):');
    console.log('Iteration | Heap (MB)');
    console.log('----------|----------');
    for (const s of samples) {
      console.log(`${String(s.iteration).padStart(9)} | ${s.heapMB}`);
    }
  });

  it('heap growth per DOMParser with large doc + removeChild (diagnostic)', async () => {
    gc();
    await new Promise(r => setTimeout(r, 50));
    gc();

    const localWindow = new Window({
      settings: {
        disableJavaScriptEvaluation: true,
        disableJavaScriptFileLoading: true,
        disableCSSFileLoading: true,
        disableIframePageLoading: true,
        disableComputedStyleRendering: true,
      },
    });

    const largeIterations = 500;
    const samples = [];
    const samplePoints = [1, 10, 50, 100, 250, 500];

    for (let i = 1; i <= largeIterations; i++) {
      const document = new localWindow.DOMParser().parseFromString(LARGE_HTML, 'text/html');
      while (document.body.firstChild) {
        document.body.removeChild(document.body.firstChild);
      }
      document.close();

      if (samplePoints.includes(i)) {
        samples.push({ iteration: i, heapMB: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) });
      }
    }

    localWindow.happyDOM.close();

    console.log('\nHeap growth per DOMParser with large doc + removeChild (single window, no GC between iterations):');
    console.log('Iteration | Heap (MB)');
    console.log('----------|----------');
    for (const s of samples) {
      console.log(`${String(s.iteration).padStart(9)} | ${s.heapMB}`);
    }
  });
});
