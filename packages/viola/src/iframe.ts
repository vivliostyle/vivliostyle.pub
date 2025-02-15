await navigator.serviceWorker.register(
  import.meta.env.MODE === 'production' ? '/sw.js' : '/dev-sw.js?dev-sw',
  { type: import.meta.env.MODE === 'production' ? 'classic' : 'module' },
);

const cliWorker = new Worker('/@worker/cli.js');
const channel = new MessageChannel();
navigator.serviceWorker.controller?.postMessage({ command: 'connect' }, [
  channel.port2,
]);
cliWorker.postMessage({ command: 'connect' }, [channel.port1]);

if (location.hostname === import.meta.env.VITE_SANDBOX_HOSTNAME) {
  window.addEventListener('message', (event) => {
    if (event.origin === location.origin && event.data?.command === 'reload') {
      location.reload();
    }
  });

  if (location.search === '?retry') {
    navigator.serviceWorker.ready.then(() => {
      window.parent.postMessage({ command: 'reload' }, location.origin);
    });
  } else {
    window.parent.postMessage(
      { command: 'retry' },
      `https://${import.meta.env.VITE_APP_HOSTNAME}${location.port ? `:${location.port}` : ''}`,
    );
    // const style = document.createElement('style');
    // style.textContent =
    //   'html,body{margin:0;padding:0;height:100%;}iframe{display:block;width:100%;height:100%;border:0;}';
    // document.head.appendChild(style);
    const iframe = document.createElement('iframe');
    const url = new URL(location.href);
    url.search = '?retry';
    iframe.src = url.href;
    document.body.appendChild(iframe);
  }
}
