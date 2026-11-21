import { join, relative } from 'pathe';

import { $projects } from '../stores/accessors';

export interface ProjectServeRequest {
  type: 'vs:project-serve';
  id: string;
  url: string;
  init: RequestInit;
}

export interface ProjectServeResponse {
  type: 'vs:project-serve-result';
  id: string;
  result: ConstructorParameters<typeof Response>;
}

// Requests may address a specific project as `/vivliostyle/p/<projectId>/...`
// (the print tab does); the owning tab strips the prefix before serving.
const projectPathRe = /^\/vivliostyle\/p\/([a-z0-9]+)(\/.*)$/;

// Returns null when this tab is not responsible for the request, so another
// tab's relay can answer instead.
async function serveProjectResource(
  url: string,
  init: RequestInit,
): Promise<ConstructorParameters<typeof Response> | null> {
  const target = new URL(url);
  const project =
    $projects.currentProjectId && $projects.value[$projects.currentProjectId];
  if (!project) {
    return null;
  }
  const prefixed = target.pathname.match(projectPathRe);
  if (prefixed) {
    if (prefixed[1] !== $projects.currentProjectId) {
      return null;
    }
    target.pathname = `/vivliostyle${prefixed[2]}`;
  }
  const sandbox = await project.sandboxPromise;
  if (target.pathname.startsWith('/vivliostyle/')) {
    const entryContext = sandbox.vivliostyleConfig.entryContext || '';
    const filename = join(
      entryContext,
      relative('/vivliostyle', target.pathname),
    );
    const content = sandbox.files[filename];
    if (content) {
      const contentType = content.type || 'application/octet-stream';
      return [
        await content.buffer(),
        {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'no-store',
          },
        },
      ];
    }
  }
  // Vite-generated resources (publication.json, entry HTML) exist only in
  // the CLI worker. The host-origin print tab reaches them through this relay
  // because a sandbox-origin top-level tab would sit in another storage
  // partition and could not see the worker.
  try {
    const cli = await sandbox.cli.createRemotePromise();
    return await cli.serve(target.href, init);
  } catch {
    return ['', { status: 404 }];
  }
}

// Hand-rolled RPC instead of Comlink: every tab shares this BroadcastChannel,
// and Comlink.expose would make all of them answer every request — a tab
// without the project instantly wins the race with a 404. Here tabs stay
// silent unless they own the requested project.
export function startProjectRelay(): () => void {
  const channel = new BroadcastChannel('host:project');
  channel.addEventListener('message', async (event: MessageEvent) => {
    const data = event.data as Partial<ProjectServeRequest> | undefined;
    if (data?.type !== 'vs:project-serve' || !data.id || !data.url) {
      return;
    }
    try {
      const result = await serveProjectResource(data.url, data.init ?? {});
      if (!result) {
        return;
      }
      channel.postMessage({
        type: 'vs:project-serve-result',
        id: data.id,
        result,
      } satisfies ProjectServeResponse);
    } catch {
      // No reply; the service worker times the request out.
    }
  });
  return () => channel.close();
}
