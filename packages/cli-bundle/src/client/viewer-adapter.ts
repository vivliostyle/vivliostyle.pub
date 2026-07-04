window.addEventListener('message', (event) => {
  const source = event.source as Window | null;
  switch (event.data?.type) {
    case 'print-pdf-query': {
      // Only answer once every page is rendered — the viewer URL sets
      // renderAllPages, so readyState reaches 'complete' when the whole book
      // is typeset. Answering earlier makes the print dialog capture blank
      // pages. Unanswered queries are fine: the host keeps polling.
      const { coreViewer } = window as { coreViewer?: { readyState?: string } };
      if (coreViewer?.readyState === 'complete') {
        source?.postMessage({ type: 'print-pdf-ready' }, event.origin);
      }
      break;
    }
    case 'print-pdf': {
      // window.print() blocks until the print dialog closes, so `done` also
      // tells the host it's safe to restore the pane layout.
      window.print();
      source?.postMessage({ type: 'print-pdf-done' }, event.origin);
      break;
    }
  }
});
