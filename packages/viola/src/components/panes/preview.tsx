import { use } from 'react';
import { ref } from 'valtio';

import { $project } from '../../stores/project';
import { $viewer } from '../../stores/viewer';

const iframeRef = (el: HTMLIFrameElement | null) => {
  $viewer.iframeElement = el ? ref(el) : undefined;
};

const PreviewIframe = () => {
  use($project.setupPromise);

  const url = use($viewer.setupServer());

  return (
    <iframe
      ref={iframeRef}
      title="Preview"
      src={url}
      className="size-full"
      sandbox="allow-same-origin allow-scripts allow-modals"
    />
  );
};

export const Preview = () => {
  return <PreviewIframe />;
};
