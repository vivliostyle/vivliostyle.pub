import type { ExtensionPermission } from '@v/viola-extension-kit';
import { installedExtensions } from '../../extensions/installed';
import { $extensions, $ui } from '../accessors';
import {
  type ExtensionId,
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
  const permissions = mod.default.permissions ?? [];
  if (!permissions.every(isPermissionGrantable)) {
    return;
  }
  // A concurrent activation may have registered it while we awaited the import.
  if (!$extensions[id]) {
    registerExtension(mod.default);
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
