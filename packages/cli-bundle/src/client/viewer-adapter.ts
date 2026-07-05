// Opened as a top-level print tab by the host (#64). readyState reaches
// 'complete' only once every page is rendered (the URL sets renderAllPages),
// and window.print() blocks while the dialog is open. The tab stays
// script-closable despite the COOP swap, because the navigation replaced the
// single about:blank history entry.
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
