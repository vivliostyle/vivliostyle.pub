import { invariant } from 'outvariant';
import { proxy, ref } from 'valtio';

import {
  type ExtensionPermission,
  type MessageCatalog,
  type PaneContribution,
  translate,
  type ViolaExtension,
} from '@v/extension-kit';

declare const extensionIdBrand: unique symbol;
export type ExtensionId = string & { [extensionIdBrand]: never };

export interface RegisteredExtension {
  id: ExtensionId;
  name: string;
  panes: Record<string, PaneContribution>;
  /** Permalink slug (under `/extension/`) → pane path, e.g. `account` → `.`. */
  permalinks: Record<string, string>;
  permissions: ReadonlySet<ExtensionPermission>;
  /** All locales' messages, used to resolve pane titles (see {@link resolvePaneTitle}). */
  messages: MessageCatalog;
}

// Reactive set of active extensions. Keyed by the id string (so callers can
// probe a known extension by literal, e.g. `$extensions.account`); the canonical
// branded id lives on each value. Activation/deactivation mutates membership so
// subscribed UI re-renders; each value is wrapped in `ref()` so valtio leaves
// the contributed values un-proxied.
export const extensions = proxy<Record<string, RegisteredExtension>>({});

export interface ResolvedPermalink {
  extensionId: ExtensionId;
  panePath: string;
  slug: string;
}

// Permalinks are served under the shared `/extension/` route; each extension owns a
// slug derived from its id. `.` is the extension's default pane.
export function resolvePanePermalink(
  extensionId: ExtensionId,
  panePath: string,
): string {
  return panePath === '.' ? extensionId : `${extensionId}${panePath}`;
}

export function registerExtension(
  extension: ViolaExtension,
  messages: MessageCatalog,
): void {
  invariant(
    /^[a-z0-9-]+$/.test(extension.id),
    'Extension id must be a lowercase DNS label: %s',
    extension.id,
  );
  invariant(
    !extensions[extension.id],
    'Extension already registered: %s',
    extension.id,
  );

  const id = extension.id as ExtensionId;
  const panes: Record<string, PaneContribution> = {};
  for (const pane of extension.panes ?? []) {
    panes[pane.path] = pane;
  }
  const permalinks: Record<string, string> = {};
  for (const permalink of extension.permalinks ?? []) {
    invariant(
      permalink.path.startsWith('.') || permalink.path.startsWith('/'),
      'Extension permalink path must start with "." or "/": %s',
      permalink.path,
    );
    permalinks[resolvePanePermalink(id, permalink.path)] = permalink.path;
  }
  extensions[id] = ref({
    id,
    name: extension.name,
    panes,
    permalinks,
    permissions: new Set(extension.permissions ?? []),
    messages,
  });
}

export function unregisterExtension(extensionId: ExtensionId): void {
  delete extensions[extensionId];
}

export function resolvePaneTitle(
  extensionId: ExtensionId,
  panePath: string,
  locale: string,
): string {
  const ext = extensions[extensionId];
  const pane = ext?.panes[panePath];
  if (!ext || !pane) {
    return '';
  }
  return translate(ext.messages, locale, pane.title);
}

export function getExtensionPermissions(
  extensionId: ExtensionId,
): ReadonlySet<ExtensionPermission> {
  return extensions[extensionId]?.permissions ?? new Set();
}

export function resolvePanePresentation(
  extensionId: ExtensionId,
  panePath: string,
): 'pane' | 'modal' {
  return extensions[extensionId]?.panes[panePath]?.presentation ?? 'pane';
}

export function resolvePaneSizing(
  extensionId: ExtensionId,
  panePath: string,
): 'content' | 'fill' {
  return extensions[extensionId]?.panes[panePath]?.sizing ?? 'content';
}

// Mounted view iframes. Host-side actions that need to message a view (e.g.
// `printPdf`) look the element up here and wait reactively for it to mount;
// elements are `ref()`d so valtio leaves the DOM nodes un-proxied.
export const extensionFrames = proxy<Record<string, HTMLIFrameElement>>({});

export function extensionFrameKey(
  extensionId: ExtensionId,
  panePath: string,
): string {
  return `${extensionId}:${panePath}`;
}

export function findPermalink(slug: string): ResolvedPermalink | undefined {
  for (const ext of Object.values(extensions)) {
    const panePath = ext.permalinks[slug];
    if (panePath !== undefined) {
      return { extensionId: ext.id, panePath, slug };
    }
  }
  return undefined;
}
