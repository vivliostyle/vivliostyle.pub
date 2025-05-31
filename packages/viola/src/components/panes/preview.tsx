import { lazy } from 'react';
import { cliPromise } from '../../stores/sandbox';
import { sandboxOrigin } from '../sandbox';

const PreviewIframe = lazy(async () => {
  const cli = await cliPromise;
  await cli.setupServer();
  return {
    default: () => (
      <iframe
        title="Preview"
        src={`${sandboxOrigin}/__vivliostyle-viewer/index.html#src=${sandboxOrigin}/vivliostyle/publication.json&bookMode=true&renderAllPages=true`}
        className="size-full"
        sandbox="allow-same-origin allow-scripts"
      />
    ),
  };
});

export const Preview = () => {
  return <PreviewIframe />;
};
