import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';

import type { AuthEnv, Deps } from '../deps';
import { binaryContent, jsonContent, toArrayBuffer } from '../route-helpers';
import { ErrorSchema, FileListSchema } from '../schemas';

export function fileRoutes({ store }: Deps) {
  const app = new Hono<AuthEnv>();

  const owns = (userId: string, projectId: string) =>
    store.getProject(userId, projectId) !== undefined;

  app.get(
    '/projects/:id/files',
    describeRoute({
      tags: ['files'],
      summary: 'List files in a project.',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'Files', content: jsonContent(FileListSchema) },
        404: { description: 'Not found', content: jsonContent(ErrorSchema) },
      },
    }),
    (c) => {
      const projectId = c.req.param('id');
      if (!owns(c.get('userId'), projectId)) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.json({ files: store.listFiles(projectId) }, 200);
    },
  );

  app.get(
    '/projects/:id/files/:path{.+}',
    describeRoute({
      tags: ['files'],
      summary: 'Read a file.',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'File contents', content: binaryContent },
        404: { description: 'Not found', content: jsonContent(ErrorSchema) },
      },
    }),
    (c) => {
      const projectId = c.req.param('id');
      if (!owns(c.get('userId'), projectId)) {
        return c.json({ error: 'not_found' }, 404);
      }
      const file = store.readFile(projectId, c.req.param('path'));
      if (!file) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.body(toArrayBuffer(file.data), 200, {
        'Content-Type': file.contentType,
      });
    },
  );

  app.put(
    '/projects/:id/files/:path{.+}',
    describeRoute({
      tags: ['files'],
      summary: 'Create or replace a file.',
      security: [{ bearerAuth: [] }],
      requestBody: { content: binaryContent },
      responses: {
        204: { description: 'Saved' },
        404: { description: 'Not found', content: jsonContent(ErrorSchema) },
      },
    }),
    async (c) => {
      const projectId = c.req.param('id');
      if (!owns(c.get('userId'), projectId)) {
        return c.json({ error: 'not_found' }, 404);
      }
      const data = new Uint8Array(await c.req.arrayBuffer());
      const contentType =
        c.req.header('Content-Type') ?? 'application/octet-stream';
      store.writeFile(projectId, c.req.param('path'), data, contentType);
      return c.body(null, 204);
    },
  );

  app.delete(
    '/projects/:id/files/:path{.+}',
    describeRoute({
      tags: ['files'],
      summary: 'Delete a file.',
      security: [{ bearerAuth: [] }],
      responses: {
        204: { description: 'Deleted' },
        404: { description: 'Not found', content: jsonContent(ErrorSchema) },
      },
    }),
    (c) => {
      const projectId = c.req.param('id');
      if (!owns(c.get('userId'), projectId)) {
        return c.json({ error: 'not_found' }, 404);
      }
      if (!store.removeFile(projectId, c.req.param('path'))) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.body(null, 204);
    },
  );

  return app;
}
