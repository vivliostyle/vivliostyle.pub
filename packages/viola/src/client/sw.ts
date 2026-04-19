import { setupSwHost } from './sw-host';
import { setupSwIframe } from './sw-iframe';

location.hostname.split('.')[0].startsWith('sandbox-')
  ? setupSwIframe()
  : setupSwHost();
