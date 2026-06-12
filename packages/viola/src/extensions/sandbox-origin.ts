import { sandboxOrigin } from '../libs/origins';
import type { ExtensionId } from '../stores/proxies/extension';

// Each extension's UI runs on its own cross-origin sandbox subdomain so it is
// isolated from the host and from other extensions, mirroring how per-project
// sandboxes are derived in `stores/proxies/sandbox.ts`.
export function extensionSandboxOrigin(extensionId: ExtensionId): string {
  return sandboxOrigin(`sandbox-ext-${extensionId}`);
}

// Pane paths are `.`-relative (`.` = the default pane, `./sub` = nested); `.`
// maps to the extension root, so `/extension/<id>/` ↔ `.` and
// `/extension/<id>/sub/` ↔ `./sub`.
export function extensionFramePath(
  extensionId: ExtensionId,
  panePath: string,
): string {
  const sub = panePath.replace(/^\.\/?/, '');
  return `/extension/${extensionId}/${sub ? `${sub}/` : ''}`;
}

export function parseExtensionFramePath(
  pathname: string,
): { extensionId: ExtensionId; panePath: string } | undefined {
  const match = pathname.match(/^\/extension\/([^/]+)(?:\/(.*))?$/);
  if (!match) {
    return undefined;
  }
  const sub = (match[2] ?? '').replace(/\/+$/, '');
  return {
    extensionId: match[1] as ExtensionId,
    panePath: sub === '' ? '.' : `./${sub}`,
  };
}
