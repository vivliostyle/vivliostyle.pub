import * as Comlink from 'comlink';
import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribe, ref as valtioRef } from 'valtio';

import type {
  ExtensionAuthErrorCode,
  ExtensionHostApi,
  ExtensionPermission,
  ExtensionSessionSnapshot,
} from '@v/extension-kit';
import { Loader2 } from '@v/ui/icon';
import { attachExtensionAutoSize } from '../../extensions/iframe-autosize';
import {
  extensionFramePath,
  extensionSandboxOrigin,
} from '../../extensions/sandbox-origin';
import { getLocale } from '../../generated/paraglide/runtime';
import { $cli, $session } from '../../stores/accessors';
import {
  applyBearerSession,
  clearBearerSession,
  login,
  logout,
  register,
  SessionError,
} from '../../stores/actions/session';
import {
  type ExtensionId,
  extensionFrameKey,
  extensionFrames,
  getExtensionPermissions,
  resolvePaneSizing,
  resolvePaneTitle,
} from '../../stores/proxies/extension';
import { createPane } from './util';

interface ExtensionPaneProperty {
  extensionId: ExtensionId;
  panePath: string;
}

declare global {
  interface PanePropertyMap {
    extension: ExtensionPaneProperty;
  }
}

function sessionSnapshot(): ExtensionSessionSnapshot {
  return {
    status: $session.status,
    user: $session.user
      ? { id: $session.user.id, username: $session.user.username }
      : null,
    baseUrl: $session.baseUrl,
  };
}

// Collapse transport/HTTP details into stable codes the sandbox UI localizes.
// Done here (the trust boundary) rather than in `session.ts` so the extra
// `status` field on `SessionError` doesn't need to survive Comlink — only the
// resulting code string crosses the boundary.
function authErrorCode(error: unknown): ExtensionAuthErrorCode {
  if (error instanceof SessionError) {
    if (error.status === 0) return 'network';
    if (error.status === 401) return 'invalid_credentials';
    if (error.status === 409) return 'username_taken';
  }
  return 'unknown';
}

async function runAuth(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    throw new Error(authErrorCode(error));
  }
}

type HostApiMethod<K extends keyof ExtensionHostApi> = {
  permission: ExtensionPermission | null;
  impl: ExtensionHostApi[K];
};

type HostApiRegistry = {
  [K in keyof ExtensionHostApi]: HostApiMethod<K>;
};

const hostApiRegistry: HostApiRegistry = {
  getLocale: {
    permission: null,
    impl: () => getLocale(),
  },
  getSessionSnapshot: {
    permission: 'session:read',
    impl: () => sessionSnapshot(),
  },
  subscribeSession: {
    permission: 'session:read',
    impl: (listener) =>
      Comlink.proxy(subscribe($session, () => listener(sessionSnapshot()))),
  },
  login: {
    permission: 'session:write',
    impl: (username, password) => runAuth(() => login(username, password)),
  },
  register: {
    permission: 'session:write',
    impl: (username, password) => runAuth(() => register(username, password)),
  },
  logout: {
    permission: 'session:write',
    impl: () => runAuth(() => logout()),
  },
  applyBearerSession: {
    permission: 'session:write',
    impl: (token) => runAuth(() => applyBearerSession(token)),
  },
  clearBearerSession: {
    permission: 'session:write',
    impl: () => runAuth(() => clearBearerSession()),
  },
  getViewerUrl: {
    permission: 'viewer:read',
    impl: async () => {
      const cli = await $cli.awaiter();
      return await cli.createViewerUrlPromise();
    },
  },
};

function denyPermission(
  method: keyof ExtensionHostApi,
  permission: ExtensionPermission,
): () => never {
  return () => {
    throw new Error(
      `Permission "${permission}" is required to call "${method}", but this extension was not granted it. Add "${permission}" to the permissions array in defineExtension().`,
    );
  };
}

function createExtensionHostApi(
  permissions: ReadonlySet<ExtensionPermission>,
): ExtensionHostApi {
  const api = {} as Record<keyof ExtensionHostApi, unknown>;
  for (const name of Object.keys(
    hostApiRegistry,
  ) as (keyof ExtensionHostApi)[]) {
    const { permission, impl } = hostApiRegistry[name];
    api[name] =
      permission === null || permissions.has(permission)
        ? impl
        : denyPermission(name, permission);
  }
  return api as ExtensionHostApi;
}

export const Pane = createPane<ExtensionPaneProperty>({
  title: ({ extensionId, panePath }) => (
    <>{resolvePaneTitle(extensionId, panePath, getLocale())}</>
  ),
  content: (props) => <Content {...props} />,
});

function Content({ extensionId, panePath }: ExtensionPaneProperty) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const origin = extensionSandboxOrigin(extensionId);
  const sizing = resolvePaneSizing(extensionId, panePath);

  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      if (event.source !== iframe.contentWindow) return;
      if (event.data?.command !== 'extension-bind') return;
      const [port] = event.ports;
      if (!port) return;
      Comlink.expose(
        createExtensionHostApi(getExtensionPermissions(extensionId)),
        port,
      );
    };
    window.addEventListener('message', onMessage);
    const detachAutoSize =
      sizing === 'content'
        ? attachExtensionAutoSize(iframe, origin)
        : undefined;
    return () => {
      window.removeEventListener('message', onMessage);
      detachAutoSize?.();
    };
  }, [origin, extensionId, sizing]);

  const registerFrame = useCallback(
    (el: HTMLIFrameElement | null) => {
      iframeRef.current = el;
      const key = extensionFrameKey(extensionId, panePath);
      if (el) {
        extensionFrames[key] = valtioRef(el);
      } else {
        delete extensionFrames[key];
      }
    },
    [extensionId, panePath],
  );

  const iframe = (
    <iframe
      ref={registerFrame}
      title={resolvePaneTitle(extensionId, panePath, getLocale())}
      src={`${origin}${extensionFramePath(extensionId, panePath)}`}
      onLoad={() => setLoaded(true)}
      // With `content` sizing the height tracks the content (see
      // iframe-autosize); width fills the pane and the height is capped at the
      // wrapper so taller content scrolls inside the iframe itself.
      className={sizing === 'fill' ? 'size-full' : 'w-full'}
      sandbox="allow-same-origin allow-scripts allow-modals allow-forms"
      allow="cross-origin-isolated"
    />
  );

  // The iframe stays mounted to fire its `load` event, so the spinner overlays
  // it rather than replacing it.
  const spinner = !loaded && (
    <div className="absolute inset-0 grid place-items-center bg-background">
      <Loader2 className="animate-spin size-12 text-gray-300" />
    </div>
  );

  if (sizing === 'fill') {
    return (
      <div className="relative size-full">
        {iframe}
        {spinner}
      </div>
    );
  }
  return (
    <div className="relative size-full overflow-auto overscroll-contain scrollbar-stable">
      {iframe}
      {spinner}
    </div>
  );
}
