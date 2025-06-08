import { use } from 'react';
import { proxy } from 'valtio';
import { $sandbox } from '../../stores/sandbox';
import { sandboxOrigin } from '../sandbox';

const server = proxy({
  url: undefined as Promise<string> | undefined,
  setupServer: () => {
    server.url ??= (async () => {
      const cli = await $sandbox.cli;
      await cli.setupServer();
      return `${sandboxOrigin}/__vivliostyle-viewer/index.html#src=${sandboxOrigin}/vivliostyle/publication.json&bookMode=true&renderAllPages=true`;
    })();
    return server.url;
  },
});

const PreviewIframe = () => {
  const url = use(server.setupServer());
  return (
    url && (
      <iframe
        title="Preview"
        src={url}
        className="size-full"
        sandbox="allow-same-origin allow-scripts"
      />
    )
  );
};

export const Preview = () => {
  return <PreviewIframe />;
};
