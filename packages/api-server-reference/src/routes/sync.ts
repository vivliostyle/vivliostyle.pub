import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';

import type { AuthEnv, Deps } from '../deps';
import { binaryContent, jsonContent, toArrayBuffer } from '../route-helpers';
import { ErrorSchema } from '../schemas';

/**
 * HTTP fallback for Yjs sync. The realtime path is the WebSocket endpoint
 * wired up in `server.ts`; both operate on the same `DocRegistry` document
 * scoped to (projectId, filename).
 *
 * Each editable file in a project has its own Yjs document so concurrent edits
 * to different files do not contend for the same CRDT. The optional `sv` query
 * parameter is the client's base64url-encoded Yjs state vector; the response
 * is the update the client is missing (or the full state when omitted).
 *
 * Path is mounted under `/sync/` rather than nested inside `/files/` so the
 * `:path{.+}` greedy match used by the file routes does not swallow the
 * trailing `/sync` segment.
 */
export function syncRoutes({ store, docs }: Deps) {
  const app = new Hono<AuthEnv>();

  const owns = (userId: string, projectId: string) =>
    store.getProject(userId, projectId) !== undefined;

  const parseStateVector = (sv: string | undefined): Uint8Array | undefined =>
    sv ? new Uint8Array(Buffer.from(sv, 'base64url')) : undefined;

  app.get(
    '/projects/:id/sync/:path{.+}',
    describeRoute({
      tags: ['sync'],
      summary: 'Pull the latest document updates for a file.',
      description:
        'Returns the Yjs update needed to bring the caller up to date for one file in a project. If the `sv` query parameter is supplied, only the delta missing from that state vector is returned; otherwise the full document state is returned.',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'sv',
          in: 'query',
          required: false,
          description:
            "The client's current Yjs state vector, encoded as base64url. Omit to receive the full document state.",
          schema: { type: 'string' },
        },
      ],
      responses: {
        200: { description: 'Yjs update', content: binaryContent },
        404: { description: 'Not found', content: jsonContent(ErrorSchema) },
      },
    }),
    (c) => {
      const projectId = c.req.param('id');
      const filename = c.req.param('path');
      if (!owns(c.get('userId'), projectId)) {
        return c.json({ error: 'not_found' }, 404);
      }
      try {
        const update = docs.encodeStateAsUpdate(
          projectId,
          filename,
          parseStateVector(c.req.query('sv')),
        );
        return c.body(toArrayBuffer(update), 200, {
          'Content-Type': 'application/octet-stream',
        });
      } catch (err) {
        const sv = c.req.query('sv') ?? '';
        console.warn(
          `[sync] GET invalid_state_vector ${projectId}/${filename}: ${(err as Error).message} (sv="${sv}")`,
        );
        return c.json({ error: 'invalid_state_vector' }, 400);
      }
    },
  );

  app.post(
    '/projects/:id/sync/:path{.+}',
    describeRoute({
      tags: ['sync'],
      summary: "Push a file's local updates and pull remote updates back.",
      description:
        'Applies the Yjs update sent in the request body to the file-scoped document, then returns the update the caller still needs to converge with the server (filtered by the `sv` state vector when supplied). Send an empty body to pull-only.',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'sv',
          in: 'query',
          required: false,
          description:
            "The client's current Yjs state vector, encoded as base64url. Omit to receive the full document state.",
          schema: { type: 'string' },
        },
      ],
      requestBody: { content: binaryContent },
      responses: {
        200: { description: 'Merged Yjs update', content: binaryContent },
        404: { description: 'Not found', content: jsonContent(ErrorSchema) },
      },
    }),
    async (c) => {
      const projectId = c.req.param('id');
      const filename = c.req.param('path');
      if (!owns(c.get('userId'), projectId)) {
        return c.json({ error: 'not_found' }, 404);
      }
      const update = new Uint8Array(await c.req.arrayBuffer());
      if (update.byteLength > 0) {
        try {
          docs.applyUpdate(projectId, filename, update, 'http');
        } catch (err) {
          console.warn(
            `[sync] invalid_update from ${projectId}/${filename}: ${(err as Error).message} (body ${update.byteLength} bytes: ${Array.from(update.slice(0, 8)).join(',')}${update.byteLength > 8 ? ',...' : ''})`,
          );
          return c.json({ error: 'invalid_update' }, 400);
        }
      }
      try {
        const diff = docs.encodeStateAsUpdate(
          projectId,
          filename,
          parseStateVector(c.req.query('sv')),
        );
        return c.body(toArrayBuffer(diff), 200, {
          'Content-Type': 'application/octet-stream',
        });
      } catch (err) {
        const sv = c.req.query('sv') ?? '';
        console.warn(
          `[sync] invalid_state_vector from ${projectId}/${filename}: ${(err as Error).message} (sv="${sv}")`,
        );
        return c.json({ error: 'invalid_state_vector' }, 400);
      }
    },
  );

  return app;
}
