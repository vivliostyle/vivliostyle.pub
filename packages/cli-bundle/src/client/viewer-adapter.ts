// Print tab flow: the host opens the viewer in its own top-level tab with a
// `print` hash parameter (printing from the nested cross-origin isolated
// iframe crashes Firefox, issue #64). Wait until every page is rendered
// (`renderAllPages` is set on the URL, so readyState only reaches 'complete'
// once the whole book is typeset), then print, then close the tab —
// window.print() blocks while the dialog is open. window.close() is allowed
// here despite the COOP browsing-context-group swap severing the opener,
// because the navigation replaced the initial about:blank entry and a
// single-entry top-level context stays script-closable.
if (new URLSearchParams(location.hash.slice(1)).get('print') === 'true') {
  const interval = setInterval(() => {
    const { coreViewer } = window as { coreViewer?: { readyState?: string } };
    if (coreViewer?.readyState === 'complete') {
      clearInterval(interval);
      window.print();
      window.close();
    }
  }, 250);
}
