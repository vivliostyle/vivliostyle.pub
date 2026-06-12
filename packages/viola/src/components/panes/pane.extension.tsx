import * as Comlink from 'comlink';
import { useEffect, useRef } from 'react';
import { subscribe } from 'valtio';

import type {
  ExtensionAuthErrorCode,
  ExtensionHostApi,
  ExtensionPermission,
  ExtensionSessionSnapshot,
} from '@v/viola-extension-kit';
import { attachExtensionAutoSize } from '../../extensions/iframe-autosize';
import {
  extensionFramePath,
  extensionSandboxOrigin,
} from '../../extensions/sandbox-origin';
import { getLocale } from '../../generated/paraglide/runtime';
import { $session } from '../../stores/accessors';
import {
  login,
  logout,
  register,
  SessionError,
} from '../../stores/actions/session';
import {
  type ExtensionId,
  getExtensionPermissions,
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
    const detachAutoSize = attachExtensionAutoSize(iframe, origin);
    return () => {
      window.removeEventListener('message', onMessage);
      detachAutoSize();
    };
  }, [origin, extensionId]);

  return (
    <div className="size-full overflow-auto overscroll-contain scrollbar-stable">
      <iframe
        ref={iframeRef}
        title={resolvePaneTitle(extensionId, panePath, getLocale())}
        src={`${origin}${extensionFramePath(extensionId, panePath)}`}
        // Height tracks the content (see iframe-autosize); width fills the pane
        // and the height is capped at the wrapper so taller content scrolls
        // inside the iframe itself.
        className="w-full"
        sandbox="allow-same-origin allow-scripts allow-modals allow-forms"
        allow="cross-origin-isolated"
      />
    </div>
  );
}
