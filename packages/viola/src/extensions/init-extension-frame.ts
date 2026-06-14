import * as Comlink from 'comlink';
import { invariant } from 'outvariant';
import type { ComponentType } from 'react';

import {
  type ExtensionHostApi,
  type ExtensionMountContext,
  type ExtensionViewModule,
  translate,
} from '@v/extension-kit';
import { reportExtensionContentSize } from './iframe-autosize';
import { installedExtensions } from './installed';
import { parseExtensionFramePath } from './sandbox-origin';

export async function initExtensionFrame() {
  const parsed = parseExtensionFramePath(location.pathname);
  invariant(parsed, 'Not an extension frame path: %s', location.pathname);
  const { extensionId, panePath } = parsed;

  const installed = installedExtensions[extensionId];
  invariant(installed, 'Unknown extension: %s', extensionId);

  const loadView = installed.loadView[panePath];
  invariant(loadView, 'Unknown pane: %s/%s', extensionId, panePath);

  const channel = new MessageChannel();
  window.parent.postMessage(
    { command: 'extension-bind' },
    `https://${import.meta.env.VITE_APP_HOSTNAME}${location.port ? `:${location.port}` : ''}`,
    [channel.port2],
  );
  const host = Comlink.wrap<ExtensionHostApi>(channel.port1);

  const locale = await host.getLocale();
  const t = (key: string) => translate(installed.messages, locale, key);
  const [
    { StrictMode, createElement },
    { createRoot },
    viewModule,
    extensionModule,
  ] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    loadView(),
    installed.loadExtension(),
  ]);

  // The kit's styles.css keys off this attribute to pin fill panes to the
  // iframe viewport instead of flowing at content height.
  const sizing =
    extensionModule.default.panes?.find((pane) => pane.path === panePath)
      ?.sizing ?? 'content';
  if (sizing === 'fill') {
    document.documentElement.dataset.paneSizing = 'fill';
  }

  const root = createRoot(document.body);
  const renderView = (module: ExtensionViewModule) => {
    const Pane = module.default as ComponentType<ExtensionMountContext>;
    root.render(
      createElement(StrictMode, null, createElement(Pane, { host, locale, t })),
    );
  };
  renderView(viewModule);
  if (sizing === 'content') {
    reportExtensionContentSize();
  }

  // React Fast Refresh doesn't repaint this manually-created root in the isolated
  // iframe (the view self-accepts, so Vite never full-reloads, yet the refresh
  // runtime leaves the root untouched). Re-mount it ourselves on each HMR pass,
  // matching the updated module by component name (stable across edits).
  const viewComponentName = (viewModule.default as { name?: string }).name;
  if (import.meta.hot && viewComponentName) {
    import.meta.hot.on('vite:afterUpdate', ({ updates }) => {
      void (async () => {
        for (const update of updates) {
          if (update.type !== 'js-update') {
            continue;
          }
          const next = await import(
            /* @vite-ignore */ `${update.acceptedPath}?t=${update.timestamp}`
          ).catch(() => undefined);
          if (
            next &&
            typeof next.default === 'function' &&
            next.default.name === viewComponentName
          ) {
            renderView(next as ExtensionViewModule);
            return;
          }
        }
      })();
    });
  }
}
