import * as Comlink from 'comlink';
import { invariant } from 'outvariant';
import type { ComponentType } from 'react';

import type {
  ExtensionHostApi,
  ExtensionMountContext,
  ExtensionViewModule,
} from '@v/viola-extension-kit';
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
  const [{ StrictMode, createElement }, { createRoot }, viewModule] =
    await Promise.all([
      import('react'),
      import('react-dom/client'),
      loadView(),
    ]);

  const root = createRoot(document.body);
  const renderView = (module: ExtensionViewModule) => {
    const Pane = module.default as ComponentType<ExtensionMountContext>;
    root.render(
      createElement(StrictMode, null, createElement(Pane, { host, locale })),
    );
  };
  renderView(viewModule);
  reportExtensionContentSize();

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
