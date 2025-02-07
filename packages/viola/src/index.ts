location.hostname === import.meta.env.VITE_SANDBOX_HOSTNAME
  ? import('./iframe')
  : import('./main');
