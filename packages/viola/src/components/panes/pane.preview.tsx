import { use, useRef } from 'react';

import { m } from '../../generated/paraglide/messages';
import { $cli } from '../../stores/accessors';
import { createPane } from './util';

type PreviewPaneProperty = object;

declare global {
  interface PanePropertyMap {
    preview: PreviewPaneProperty;
  }
}

export const Pane = createPane<PreviewPaneProperty>({
  title: () => m.preview_pane_title(),
  content: (props) => <Content {...props} />,
});

function Content(_: PreviewPaneProperty) {
  const cliAwaiter = useRef($cli.awaiter());
  const cli = use(cliAwaiter.current);
  const url = use(cli.createViewerUrlPromise());

  return (
    <iframe
      ref={(el) => cli.viewerIframeRef(el)}
      title={m.preview_iframe_title()}
      src={url}
      className="size-full"
      sandbox="allow-same-origin allow-scripts allow-modals"
      allow="cross-origin-isolated"
    />
  );
}
