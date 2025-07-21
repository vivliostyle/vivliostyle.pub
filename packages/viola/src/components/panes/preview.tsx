import { invariant } from 'outvariant';
import { use } from 'react';
import { proxy } from 'valtio';

import { $sandbox } from '../../stores/sandbox';

const server = proxy({
  url: undefined as Promise<string> | undefined,
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

const PreviewIframe = () => {
  const url = use(server.setupServer());
  return (
    <iframe
      title="Preview"
      src={url}
      className="size-full"
      sandbox="allow-same-origin allow-scripts"
    />
  );
};

export const Preview = () => {
  return <PreviewIframe />;
};
