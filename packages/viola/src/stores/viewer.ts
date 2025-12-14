import { invariant } from 'outvariant';
import { proxy } from 'valtio';

import { $sandbox } from './sandbox';

export const $viewer = proxy({
  url: undefined as Promise<string> | undefined,
  iframeElement: undefined as HTMLIFrameElement | undefined,

  setupServer() {
    this.url ??= (async () => {
      invariant($sandbox.sandboxOrigin, 'sandboxOrigin is not set');
      const cli = await $sandbox.cli;
      await cli.setupServer();
      return `${$sandbox.sandboxOrigin}/__vivliostyle-viewer/index.html#src=${$sandbox.sandboxOrigin}/vivliostyle/publication.json&bookMode=true&renderAllPages=true`;
    })();
    return this.url;
  },
});
