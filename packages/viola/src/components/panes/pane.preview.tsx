import { use } from 'react';
import { ref } from 'valtio';

import { $project } from '../../stores/project';
import { $viewer } from '../../stores/viewer';
import { createPane } from './util';

type PreviewPaneProperty = object;

declare global {
  interface PanePropertyMap {
    preview: PreviewPaneProperty;
  }
}

export const Pane = createPane<PreviewPaneProperty>({
  title: () => 'Preview',
  content: (props) => <Content {...props} />,
});

const iframeRef = (el: HTMLIFrameElement | null) => {
  $viewer.iframeElement = el ? ref(el) : undefined;
};

function Content(_: PreviewPaneProperty) {
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
}
