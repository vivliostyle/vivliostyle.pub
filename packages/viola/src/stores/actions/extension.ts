import { invariant } from 'outvariant';

import type { ExtensionPermission } from '@v/extension-kit';
import { installedExtensions } from '../../extensions/installed';
import { generateId } from '../../libs/generate-id';
import { $extensions, $ui } from '../accessors';
import {
  type ExtensionId,
  findPermalink,
  registerExtension,
  unregisterExtension,
} from '../proxies/extension';

const cloudPermissions = new Set<ExtensionPermission>([
  'session:read',
  'session:write',
]);

// Session permissions back the API server, so they can only be granted when the
// build has one. A user-controlled "granted permissions" set could be consulted
// here later.
function isPermissionGrantable(permission: ExtensionPermission): boolean {
  return cloudPermissions.has(permission) ? __CLOUD_ENABLED__ : true;
}

export async function activateExtension(id: ExtensionId): Promise<void> {
  if ($extensions[id]) {
    return;
  }
  const entry = installedExtensions[id];
  if (!entry) {
    return;
  }
  const mod = await entry.loadExtension();
  invariant(
    mod.default.id === id,
    'Extension id "%s" does not match its package name @v/viola-extension-%s',
    mod.default.id,
    id,
  );
  const permissions = mod.default.permissions ?? [];
  if (!permissions.every(isPermissionGrantable)) {
    return;
  }
  // A concurrent activation may have registered it while we awaited the import.
  if (!$extensions[id]) {
    registerExtension(mod.default, entry.messages);
  }
}

export function deactivateExtension(id: ExtensionId): void {
  unregisterExtension(id);
  $ui.tabs = $ui.tabs.filter(
    (tab) => !(tab.type === 'extension' && tab.extensionId === id),
  );
  if (
    $ui.dedicatedModal?.type === 'extension' &&
    $ui.dedicatedModal.extensionId === id
  ) {
    $ui.dedicatedModal = null;
  }
}

// Resolves a permalink slug to an extension pane tab, activating extensions
// first. Returns false when the slug matches no permalink so the caller can
// redirect.
export async function openPermalink(slug: string): Promise<boolean> {
  await ensureExtensionsActivated();
  const permalink = findPermalink(slug);
  if (!permalink) {
    return false;
  }
  if (
    $ui.tabs.some(
      (tab) =>
        tab.type === 'extension' &&
        tab.extensionId === permalink.extensionId &&
        tab.panePath === permalink.panePath,
    )
  ) {
    return true;
  }
  $ui.tabs = [
    ...$ui.tabs.filter((tab) => tab.type === 'edit').slice(0, 1),
    {
      id: generateId(),
      type: 'extension',
      extensionId: permalink.extensionId,
      panePath: permalink.panePath,
    },
  ];
  return true;
}

let activation: Promise<void> | undefined;

export function ensureExtensionsActivated(): Promise<void> {
  if (!activation) {
    activation = Promise.all(
      Object.keys(installedExtensions).map((id) =>
        activateExtension(id as ExtensionId),
      ),
    ).then(() => undefined);
  }
  return activation;
}
