navigator.serviceWorker.register(
  import.meta.env.MODE === 'production' ? '/sw.js' : '/dev-sw.js?dev-sw',
  { type: import.meta.env.MODE === 'production' ? 'classic' : 'module' },
);

if (location.hostname.split('.')[0].startsWith('sandbox-')) {
  navigator.serviceWorker.ready.then(() => {
    location.reload();
  });
} else {
  import('./main');
}
