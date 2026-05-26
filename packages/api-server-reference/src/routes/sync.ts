import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';

import type { AuthEnv, Deps } from '../deps';
import { binaryContent, jsonContent, toArrayBuffer } from '../route-helpers';
import { ErrorSchema } from '../schemas';

/**
 * HTTP fallback for Yjs sync. The realtime path is the WebSocket endpoint wired
 * up in `server.ts`; both operate on the same `DocRegistry` document.
 *
 * The optional `sv` query parameter is the client's base64url-encoded Yjs state
 * vector; the response is the update the client is missing (or the full state
 * when omitted).
 */
export function syncRoutes({ store, docs }: Deps) {
  const app = new Hono<AuthEnv>();

  const owns = (userId: string, projectId: string) =>
    store.getProject(userId, projectId) !== undefined;

  const parseStateVector = (sv: string | undefined): Uint8Array | undefined =>
    sv ? new Uint8Array(Buffer.from(sv, 'base64url')) : undefined;

  app.get(
    '/projects/:id/sync',
    describeRoute({
      tags: ['sync'],
      summary: 'Pull the latest document updates for a project.',
      description:
        'Returns the Yjs update needed to bring the caller up to date. If the `sv` query parameter is supplied, only the delta missing from that state vector is returned; otherwise the full document state is returned.',
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
      if (!owns(c.get('userId'), projectId)) {
        return c.json({ error: 'not_found' }, 404);
      }
      try {
        const update = docs.encodeStateAsUpdate(
          projectId,
          parseStateVector(c.req.query('sv')),
        );
        return c.body(toArrayBuffer(update), 200, {
          'Content-Type': 'application/octet-stream',
        });
      } catch {
        return c.json({ error: 'invalid_state_vector' }, 400);
      }
    },
  );

  app.post(
    '/projects/:id/sync',
    describeRoute({
      tags: ['sync'],
      summary: 'Push local document updates and pull remote updates back.',
      description:
        'Applies the Yjs update sent in the request body, then returns the update the caller still needs to converge with the server (filtered by the `sv` state vector when supplied). Send an empty body to pull-only.',
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
      if (!owns(c.get('userId'), projectId)) {
        return c.json({ error: 'not_found' }, 404);
      }
      const update = new Uint8Array(await c.req.arrayBuffer());
      try {
        if (update.byteLength > 0) {
          docs.applyUpdate(projectId, update, 'http');
        }
        const diff = docs.encodeStateAsUpdate(
          projectId,
          parseStateVector(c.req.query('sv')),
        );
        return c.body(toArrayBuffer(diff), 200, {
          'Content-Type': 'application/octet-stream',
        });
      } catch {
        return c.json({ error: 'invalid_update' }, 400);
      }
    },
  );

  return app;
}
