import { use } from 'react';
import { useSnapshot } from 'valtio';

import { $cli } from '../../stores/accessors';
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

function Content(_: PreviewPaneProperty) {
  const cliSnap = useSnapshot($cli).valueOrThrow();
  const url = use(cliSnap.createViewerUrlPromise());

  return (
    <iframe
      ref={(el) => cliSnap.viewerIframeRef(el)}
      title="Preview"
      src={url}
      className="size-full"
      sandbox="allow-same-origin allow-scripts allow-modals"
    />
  );
}
