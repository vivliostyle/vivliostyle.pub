/**
 * Shared library for Viola extension authors. It provides:
 *   - the host/extension contract (types + {@link defineExtension}) from here, and
 *   - base styles from `@v/viola-extension-kit/styles.css`.
 *
 * UI components come from the `@v/ui` design system, which extensions depend on
 * directly (e.g. `import { Button } from '@v/ui/button'`).
 *
 * An extension is split in two, mirroring VS Code's "extension host" vs
 * "webview" model:
 *   - a host module (the default {@link ViolaExtension} export) that runs in
 *     the host app realm and only contributes metadata, and
 *   - per-pane view modules whose default export is a React component
 *     ({@link ExtensionViewComponent}). The host mounts one inside an isolated
 *     cross-origin iframe; it talks back through {@link ExtensionHostApi}.
 *
 * The host (`@v/viola`) only imports types from here, so its build never pulls
 * in the React/CSS surface.
 */

import type { Remote } from 'comlink';

export type ExtensionSessionStatus =
  | 'initial'
  | 'anonymous'
  | 'authenticated'
  | 'authenticating';

export interface ExtensionSessionUser {
  id: string;
  username: string;
}

export interface ExtensionSessionSnapshot {
  status: ExtensionSessionStatus;
  user: ExtensionSessionUser | null;
  baseUrl: string;
}

/**
 * Stable, locale-independent failure codes thrown by the auth methods of
 * {@link ExtensionHostApi}. The host maps transport/HTTP details to these codes
 * so the view can localize them; richer error shapes would not survive Comlink's
 * default error serialization (only `message` is preserved across the boundary).
 */
export type ExtensionAuthErrorCode =
  | 'invalid_credentials'
  | 'username_taken'
  | 'network'
  | 'unknown';

export type ExtensionSessionListener = (
  snapshot: ExtensionSessionSnapshot,
) => void;

/**
 * Permissions an extension declares in {@link defineExtension}. The host only
 * activates an extension when every declared permission is grantable in the
 * current build, and exposes only the {@link ExtensionHostApi} methods the
 * granted permissions unlock:
 *   - `session:read`  → `getSessionSnapshot`, `subscribeSession`
 *   - `session:write` → `login`, `register`, `logout`
 */
export type ExtensionPermission = 'session:read' | 'session:write';

/**
 * Capabilities the host exposes to an extension view over Comlink.
 *
 * Kept intentionally flat (no nested namespaces): Comlink types a non-function
 * property as `Promise<that object>`, so `host.session.login()` would not
 * type-check — only top-level methods are proxied cleanly.
 *
 * Every method is declared here, but each is gated by the {@link
 * ExtensionPermission} shown above; calling one whose permission the extension
 * did not declare rejects at runtime with an error naming the missing
 * permission. `getLocale` needs no permission.
 */
export interface ExtensionHostApi {
  getSessionSnapshot(): ExtensionSessionSnapshot;
  subscribeSession(listener: ExtensionSessionListener): () => void;
  login(username: string, password: string): Promise<void>;
  register(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
  getLocale(): string;
}

/** The host API as seen from inside the iframe (Comlink-proxied). */
export type RemoteExtensionHostApi = Remote<ExtensionHostApi>;

/** Props the host passes to a pane's view component. */
export interface ExtensionMountContext {
  host: RemoteExtensionHostApi;
  locale: string;
}

/**
 * A pane's UI: a React function component rendered with
 * {@link ExtensionMountContext} as props. Typed structurally (rather than as
 * React's `ComponentType`) so the contract stays usable from non-React code;
 * the host narrows it to a real component when rendering.
 */
export type ExtensionViewComponent = (props: ExtensionMountContext) => unknown;

/** Shape of a pane's view module: its default export is the UI component. */
export interface ExtensionViewModule {
  default: ExtensionViewComponent;
}

export interface PaneContribution {
  /**
   * The pane's path within the extension, used as its key everywhere (view
   * loader, permalink, lookups). `'.'` is the extension's default pane; other
   * paths must start with `.` or `/` (e.g. `/settings`, `.settings`).
   */
  path: string;
  title: string | ((locale: string) => string);
  /**
   * How in-app entry points (e.g. menu buttons) present this pane. `'pane'`
   * (default) navigates to the pane's permalink; `'modal'` opens it as a
   * dedicated modal over the current view without changing the route, so the
   * rest of the workspace stays intact. The permalink URL itself always renders
   * the pane in full (the addressable form).
   */
  presentation?: 'pane' | 'modal';
}

export interface PermalinkContribution {
  /**
   * The pane path this permalink exposes. `'.'` or starts with `.` or `/`. The
   * full, addressable URL is generated from the extension id as
   * `-<id>` (for `'.'`) or `-<id><path>`, so it always starts with `-` and
   * cannot shadow a core route.
   */
  path: string;
}

export interface ViolaExtension {
  id: string;
  name: string;
  panes?: PaneContribution[];
  permalinks?: PermalinkContribution[];
  permissions?: ExtensionPermission[];
}

export function defineExtension(extension: ViolaExtension): ViolaExtension {
  return extension;
}
