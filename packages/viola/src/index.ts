location.hostname.split('.')[0].startsWith('sandbox-')
  ? import('./iframe/register')
  : import('./main');
