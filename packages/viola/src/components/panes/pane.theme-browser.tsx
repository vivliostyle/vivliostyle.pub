import { useEffect, useRef } from 'react';

import { m } from '../../generated/paraglide/messages';
import { getLocale } from '../../generated/paraglide/runtime';
import {
  type PickerInitMessage,
  parsePickerMessage,
  pickerUrl,
  themeSiteOrigin,
} from '../../libs/theme-site';
import { $draftProject, $project, $ui } from '../../stores/accessors';
import type { PaneId } from '../../stores/proxies/ui';
import { createPane, PaneContainer } from './util';

interface ThemeBrowserPaneProperty {
  id?: PaneId;
  /** The project whose theme is chosen: the draft of a new project or the open one. */
  target: 'draft' | 'current';
}

declare global {
  interface PanePropertyMap {
    'theme-browser': ThemeBrowserPaneProperty;
  }
}

export const Pane = createPane<ThemeBrowserPaneProperty>({
  title: () => m.theme_browser_pane_title(),
  content: (props) => (
    <PaneContainer>
      <Content {...props} />
    </PaneContainer>
  ),
});

function closePane(id: PaneId | undefined) {
  if ($ui.dedicatedModal?.type === 'theme-browser') {
    $ui.dedicatedModal = null;
  } else if (id) {
    $ui.tabs = $ui.tabs.filter((tab) => tab.id !== id);
  }
}

function Content({ id, target }: ThemeBrowserPaneProperty) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const locale = getLocale();

  useEffect(() => {
    const project = () =>
      target === 'draft'
        ? $draftProject.valueOrThrow()
        : $project.valueOrThrow();

    const onMessage = async (event: MessageEvent) => {
      const frame = iframeRef.current?.contentWindow;
      // Messages are accepted only from the embedded catalog itself.
      if (
        event.origin !== themeSiteOrigin ||
        !frame ||
        event.source !== frame
      ) {
        return;
      }
      const message = parsePickerMessage(event.data);
      switch (message?.type) {
        case 'vivliostyle-theme-picker:ready': {
          const installed = await project().theme.installPromise;
          const init: PickerInitMessage = {
            type: 'vivliostyle-theme-picker:init',
            protocol: 1,
            locale: locale === 'ja' ? 'ja' : 'en',
            allowTemplate: target === 'draft',
            current: installed?.packageName,
          };
          frame.postMessage(init, themeSiteOrigin);
          break;
        }
        case 'vivliostyle-theme-picker:select': {
          const theme = project().theme;
          theme.requestedTemplateId =
            target === 'draft' ? message.template?.id : undefined;
          theme.install(`${message.theme.name}@^${message.theme.version}`);
          closePane(id);
          break;
        }
        case 'vivliostyle-theme-picker:cancel':
          closePane(id);
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [id, target, locale]);

  return (
    <iframe
      ref={iframeRef}
      src={pickerUrl(locale)}
      title={m.theme_browser_frame_title()}
      // The catalog keeps the selection context in its own session storage.
      sandbox="allow-scripts allow-same-origin allow-forms"
      referrerPolicy="origin"
      className="w-full h-[70vh] rounded-md border"
    />
  );
}
