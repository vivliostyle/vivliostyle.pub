importScripts('https://unpkg.com/comlink/dist/umd/comlink.js');

async function handle(url, init) {
  const { pathname } = new URL(url);

  if (pathname === '/test.js') {
    const js = `
const el = document.createElement('h1');
el.textContent = 'Hello from test.js';
document.body.appendChild(el);
    `;
    return [
      js,
      {
        status: 200,
        headers: {
          'Content-Type': 'application/javascript',
          'Content-Length': js.length.toString(),
          'Cross-Origin-Embedder-Policy': 'credentialless',
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Resource-Policy': 'cross-origin',
        },
      },
    ];
  }
  return [
    '',
    {
      status: 404,
      headers: {
        'Content-Type': 'text/plain',
        'Content-Length': '0',
      },
    },
  ];
}

self.addEventListener('message', (event) => {
  if (event.data.command === 'connect') {
    const port = event.ports[0];
    Comlink.expose({ handle }, port);
    const sw = Comlink.wrap(port);
    sw.ready();
  }
});
