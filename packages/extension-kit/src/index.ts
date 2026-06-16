/**
 * Shared library for Viola extension authors. It provides:
 *   - the host/extension contract (types + {@link defineExtension}) from here, and
 *   - base styles from `@v/extension-kit/styles.css`.
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
 * The host discovers extensions by workspace package name: every
 * `@v/viola-extension-<id>` package is installed automatically, with
 * `src/extension.ts` as the host module and `src/views/<sub>.tsx` as the view
 * for pane `./<sub>` (`index.tsx` is the default pane `.`).
 *
 * Localization needs no build step: an extension ships `messages/<locale>.json`
 * (inlang message format), the host reads them directly, and a view receives a
 * locale-bound translator ({@link ExtensionTranslate}) on its mount context.
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
 *   - `session:write` → `login`, `register`, `logout`, `applyBearerSession`,
 *                       `clearBearerSession`
 *   - `viewer:read`   → `getViewerUrl`
 */
export type ExtensionPermission =
  | 'session:read'
  | 'session:write'
  | 'viewer:read';

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
  applyBearerSession(token: string): Promise<void>;
  clearBearerSession(): Promise<void>;
  getLocale(): string;
  getViewerUrl(): Promise<string>;
}

/** The host API as seen from inside the iframe (Comlink-proxied). */
export type RemoteExtensionHostApi = Remote<ExtensionHostApi>;

/**
 * An extension's `messages/<locale>.json` files, merged by locale:
 * `catalog[locale][key]`. Read by the host directly from the package — no
 * compile step.
 */
export type MessageCatalog = Record<string, Record<string, string>>;

/** Looks up a message for the active locale, falling back to the base locale
 * and finally the key itself. */
export type ExtensionTranslate = (key: string) => string;

export function translate(
  catalog: MessageCatalog,
  locale: string,
  key: string,
  baseLocale = 'en',
): string {
  return catalog[locale]?.[key] ?? catalog[baseLocale]?.[key] ?? key;
}

/** Props the host passes to a pane's view component. */
export interface ExtensionMountContext {
  host: RemoteExtensionHostApi;
  locale: string;
  /** Translator bound to {@link ExtensionMountContext.locale}. */
  t: ExtensionTranslate;
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
   * loader, permalink, lookups). `'.'` is the extension's default pane (backed
   * by `src/views/index.tsx`); a sub-pane is `'./<name>'`, backed by
   * `src/views/<name>.tsx`.
   */
  path: string;
  /**
   * The pane's title, given as a message key resolved against the extension's
   * `messages/` catalog for the active locale. A string that matches no message
   * is shown verbatim.
   */
  title: string;
  /**
   * How in-app entry points (e.g. menu buttons) present this pane. `'pane'`
   * (default) navigates to the pane's permalink; `'modal'` opens it as a
   * dedicated modal over the current view without changing the route, so the
   * rest of the workspace stays intact. The permalink URL itself always renders
   * the pane in full (the addressable form).
   */
  presentation?: 'pane' | 'modal';
  /**
   * How the view iframe is sized. `'content'` (default) tracks the rendered
   * content's height and scrolls when it exceeds the pane; `'fill'` stretches
   * the iframe to the pane itself, for views that manage their own viewport
   * (e.g. an embedded viewer).
   */
  sizing?: 'content' | 'fill';
}

export interface PermalinkContribution {
  /**
   * The pane path this permalink exposes: `'.'` (the default pane) or
   * `'./<name>'`. The host serves it under `/extension/<slug>`, where the slug
   * is the extension id for `'.'` or `<id><path>` for a sub-pane, so a
   * permalink can never shadow a core route.
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
