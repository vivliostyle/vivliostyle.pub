import type {
  ExtensionViewModule,
  MessageCatalog,
  ViolaExtension,
} from '@v/extension-kit';
import { installedExtensions as discovered } from '#installed-extensions';
import type { ExtensionId } from '../stores/proxies/extension';

export interface InstalledExtension {
  loadExtension: () => Promise<{ default: ViolaExtension }>;
  /** Per-pane view loaders, keyed by the pane path (e.g. `'.'`, `./settings`). */
  loadView: Record<string, () => Promise<ExtensionViewModule>>;
  /** All locales' `messages/*.json`, merged by locale (see the kit). */
  messages: MessageCatalog;
}

// Filled by the `#installed-extensions` virtual module (see `vite.config.ts`):
// every workspace package named `@v/viola-extension-<id>` is installed
// automatically, with `src/extension.ts` as the host contribution and each
// `src/views/<sub>.tsx` as the view for pane `./<sub>` (`index.tsx` provides
// the default pane `.`).
export const installedExtensions: Record<ExtensionId, InstalledExtension> =
  discovered;
