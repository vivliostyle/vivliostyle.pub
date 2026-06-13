import type {
  ExtensionViewModule,
  ViolaExtension,
} from '@v/viola-extension-kit';
import type { ExtensionId } from '../stores/proxies/extension';

export interface InstalledExtension {
  loadExtension: () => Promise<{ default: ViolaExtension }>;
  /** Per-pane view loaders, keyed by the pane path (e.g. `'.'`, `/settings`). */
  loadView: Record<string, () => Promise<ExtensionViewModule>>;
}

export const installedExtensions: Record<ExtensionId, InstalledExtension> = {
  ['account' as ExtensionId]: {
    loadExtension: () => import('@v/viola-extension-account'),
    loadView: {
      '.': () => import('@v/viola-extension-account/views'),
    },
  },
  ['preview' as ExtensionId]: {
    loadExtension: () => import('@v/viola-extension-preview'),
    loadView: {
      '.': () => import('@v/viola-extension-preview/views'),
    },
  },
};
