window.addEventListener('message', (event) => {
  const source = event.source as Window | null;
  switch (event.data?.type) {
    case 'print-pdf-query': {
      // readyState reaches 'complete' once every page is rendered (the URL
      // sets renderAllPages); answering earlier would print blank pages.
      const { coreViewer } = window as { coreViewer?: { readyState?: string } };
      if (coreViewer?.readyState === 'complete') {
        source?.postMessage({ type: 'print-pdf-ready' }, event.origin);
      }
      break;
    }
    case 'print-pdf': {
      // window.print() blocks until the print dialog closes.
      window.print();
      source?.postMessage({ type: 'print-pdf-done' }, event.origin);
      break;
    }
  }
});
