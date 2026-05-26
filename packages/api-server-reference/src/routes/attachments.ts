import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';

import { sha256Hex } from '../crypto';
import type { AuthEnv, Deps } from '../deps';
import { binaryContent, jsonContent, toArrayBuffer } from '../route-helpers';
import { AttachmentResultSchema, ErrorSchema } from '../schemas';

export function attachmentRoutes({ store, files }: Deps) {
  const app = new Hono<AuthEnv>();

  const owns = (userId: string, projectId: string) =>
    store.getProject(userId, projectId) !== undefined;

  app.get(
    '/projects/:id/attachments/:sha256',
    describeRoute({
      tags: ['attachments'],
      summary: 'Download an attachment by its SHA-256 hash.',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'Attachment bytes', content: binaryContent },
        404: { description: 'Not found', content: jsonContent(ErrorSchema) },
      },
    }),
    async (c) => {
      const projectId = c.req.param('id');
      if (!owns(c.get('userId'), projectId)) {
        return c.json({ error: 'not_found' }, 404);
      }
      const data = await files.readAttachment(projectId, c.req.param('sha256'));
      if (!data) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.body(toArrayBuffer(data), 200, {
        'Content-Type': 'application/octet-stream',
      });
    },
  );

  app.put(
    '/projects/:id/attachments/:sha256',
    describeRoute({
      tags: ['attachments'],
      summary: 'Upload an attachment.',
      description:
        'The SHA-256 hex digest of the request body must match the `sha256` path parameter; uploads that fail this check are rejected. Uploading the same hash twice is idempotent.',
      security: [{ bearerAuth: [] }],
      requestBody: { content: binaryContent },
      responses: {
        201: {
          description: 'Stored',
          content: jsonContent(AttachmentResultSchema),
        },
        400: {
          description: 'Hash mismatch',
          content: jsonContent(ErrorSchema),
        },
        404: { description: 'Not found', content: jsonContent(ErrorSchema) },
      },
    }),
    async (c) => {
      const projectId = c.req.param('id');
      if (!owns(c.get('userId'), projectId)) {
        return c.json({ error: 'not_found' }, 404);
      }
      const sha256 = c.req.param('sha256');
      const data = new Uint8Array(await c.req.arrayBuffer());
      if (sha256Hex(data) !== sha256) {
        return c.json(
          { error: 'hash_mismatch', message: 'body does not match sha256' },
          400,
        );
      }
      await files.writeAttachment(projectId, sha256, data);
      return c.json({ sha256, size: data.byteLength }, 201);
    },
  );

  return app;
}
