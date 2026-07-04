window.addEventListener('message', (event) => {
  if (event.data.type === 'print-pdf') {
    window.print();
  }
});

// Top-level print tab flow (issue #64): the host opens the viewer in its own
// tab with a `print` hash parameter because Firefox crashes when printing the
// nested cross-origin isolated iframe. Wait until every page is rendered
// (`renderAllPages` is set on the URL, so readyState only reaches 'complete'
// once the whole book is typeset), then print.
if (new URLSearchParams(location.hash.slice(1)).get('print') === 'true') {
  const interval = setInterval(() => {
    const { coreViewer } = window as { coreViewer?: { readyState?: string } };
    if (coreViewer?.readyState === 'complete') {
      clearInterval(interval);
      window.print();
    }
  }, 250);
}
