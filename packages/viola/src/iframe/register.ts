navigator.serviceWorker.register(
  import.meta.env.MODE === 'production' ? '/sw.js' : '/dev-sw.js?dev-sw',
  { type: import.meta.env.MODE === 'production' ? 'classic' : 'module' },
);
navigator.serviceWorker.ready.then(() => {
  location.reload();
});
