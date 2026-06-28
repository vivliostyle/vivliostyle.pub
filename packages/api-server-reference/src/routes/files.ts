import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';

import { signDownloadToken, verifyDownloadToken } from '../crypto';
import type { AuthEnv, Deps } from '../deps';
import { binaryContent, jsonContent, toArrayBuffer } from '../http-helpers';
import { ErrorSchema, type FileEntry, FileListSchema } from '../schemas';

function encodeFilePath(filePath: string): string {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

// Field name carrying the paths to delete in a batch request; chosen so it
// cannot collide with a real file path (which never starts with `$`).
const BATCH_DELETE_FIELD = '$delete';

export function fileRoutes({ store, files, docs, config }: Deps) {
  const app = new Hono<AuthEnv>();

  const owns = (userId: string, projectId: string) =>
    store.getProject(userId, projectId) !== undefined;

  // The reference server has no separate object store to offload egress to, so
  // it mints a short-lived HMAC-signed URL to its own unauthenticated download
  // route. This mirrors the wire contract an R2-backed server fulfils with a
  // presigned URL: the client fetches the bytes without a bearer token, and
  // access is scoped to one file for `downloadUrlTtlMs`.
  const buildDownloadUrl = (
    c: { req: { url: string } },
    projectId: string,
    filePath: string,
  ): string => {
    const expiresAt = Date.now() + config.downloadUrlTtlMs;
    const sig = signDownloadToken(
      config.downloadUrlSecret,
      projectId,
      filePath,
      expiresAt,
    );
    const origin = new URL(c.req.url).origin;
    const query = `exp=${expiresAt}&sig=${encodeURIComponent(sig)}`;
    return `${origin}/files-download/${encodeURIComponent(projectId)}/${encodeFilePath(filePath)}?${query}`;
  };

  app.get(
    '/projects/:id/files',
    describeRoute({
      tags: ['files'],
      summary: 'List files',
      description:
        'Returns every file currently stored in the project, each with a SHA-256 `hash` of its content. Pass `download=true` to also receive a short-lived `downloadUrl` for fetching each file directly, bypassing this API.',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'download',
          in: 'query',
          required: false,
          description:
            'When `true`, include a short-lived direct-download URL on every entry.',
          schema: { type: 'boolean' },
        },
      ],
      responses: {
        200: { description: 'Files', content: jsonContent(FileListSchema) },
        404: { description: 'Not found', content: jsonContent(ErrorSchema) },
      },
    }),
    async (c) => {
      const projectId = c.req.param('id');
      if (!owns(c.get('userId'), projectId)) {
        return c.json({ error: 'not_found' }, 404);
      }
      const entries = await files.listFiles(projectId);
      if (c.req.query('download') === 'true') {
        for (const entry of entries) {
          entry.downloadUrl = buildDownloadUrl(c, projectId, entry.path);
        }
      }
      return c.json({ files: entries }, 200);
    },
  );

  app.post(
    '/projects/:id/files',
    describeRoute({
      tags: ['files'],
      summary: 'Write files (batch)',
      description:
        'Creates or replaces multiple files and deletes others in a single request, to avoid one round-trip per file. Send `multipart/form-data` where each file part is named by its project-relative path, and each form field named `$delete` carries one path to remove. Returns the resulting entries (with hashes) for the written files.',
      security: [{ bearerAuth: [] }],
      requestBody: {
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              properties: {
                $delete: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Project-relative paths to delete.',
                },
              },
              additionalProperties: { type: 'string', format: 'binary' },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Written files',
          content: jsonContent(FileListSchema),
        },
        404: { description: 'Not found', content: jsonContent(ErrorSchema) },
      },
    }),
    async (c) => {
      const projectId = c.req.param('id');
      if (!owns(c.get('userId'), projectId)) {
        return c.json({ error: 'not_found' }, 404);
      }
      const form = await c.req.formData();
      const written: FileEntry[] = [];
      for (const [name, value] of form.entries()) {
        if (name === BATCH_DELETE_FIELD || typeof value === 'string') {
          continue;
        }
        const data = new Uint8Array(await value.arrayBuffer());
        written.push(await files.writeFile(projectId, name, data));
      }
      for (const path of form.getAll(BATCH_DELETE_FIELD)) {
        if (typeof path !== 'string') continue;
        if (await files.removeFile(projectId, path)) {
          store.deleteDocState(projectId, path);
          docs.evict(projectId, path);
        }
      }
      return c.json({ files: written }, 200);
    },
  );

  // Unauthenticated: the signed `exp`/`sig` query pair scopes access to a single
  // file for a short window, standing in for an object-store presigned URL.
  app.get(
    '/files-download/:id/:path{.+}',
    describeRoute({
      tags: ['files'],
      summary: 'Download a file via a signed URL',
      description:
        "Returns the file's raw bytes for a URL minted by the file listing's `download=true` mode. Authorized by the `exp`/`sig` query pair rather than a bearer token.",
      responses: {
        200: { description: 'File contents', content: binaryContent },
        403: {
          description: 'Invalid signature',
          content: jsonContent(ErrorSchema),
        },
        404: { description: 'Not found', content: jsonContent(ErrorSchema) },
      },
    }),
    async (c) => {
      const projectId = c.req.param('id');
      const filePath = c.req.param('path');
      const expiresAt = Number(c.req.query('exp'));
      const sig = c.req.query('sig') ?? '';
      if (
        !verifyDownloadToken(
          config.downloadUrlSecret,
          projectId,
          filePath,
          expiresAt,
          sig,
        )
      ) {
        return c.json({ error: 'forbidden' }, 403);
      }
      const file = await files.readFile(projectId, filePath);
      if (!file) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.body(toArrayBuffer(file.data), 200, {
        'Content-Type': file.contentType,
      });
    },
  );

  app.get(
    '/projects/:id/files/:path{.+}',
    describeRoute({
      tags: ['files'],
      summary: 'Read file',
      description: "Returns the file's raw bytes.",
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'File contents', content: binaryContent },
        404: { description: 'Not found', content: jsonContent(ErrorSchema) },
      },
    }),
    async (c) => {
      const projectId = c.req.param('id');
      if (!owns(c.get('userId'), projectId)) {
        return c.json({ error: 'not_found' }, 404);
      }
      const file = await files.readFile(projectId, c.req.param('path'));
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
      summary: 'Write file',
      description: 'Creates or replaces the file at the given path.',
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
      await files.writeFile(projectId, c.req.param('path'), data);
      return c.body(null, 204);
    },
  );

  app.delete(
    '/projects/:id/files/:path{.+}',
    describeRoute({
      tags: ['files'],
      summary: 'Delete file',
      description: 'Removes the file and drops its associated CRDT state.',
      security: [{ bearerAuth: [] }],
      responses: {
        204: { description: 'Deleted' },
        404: { description: 'Not found', content: jsonContent(ErrorSchema) },
      },
    }),
    async (c) => {
      const projectId = c.req.param('id');
      if (!owns(c.get('userId'), projectId)) {
        return c.json({ error: 'not_found' }, 404);
      }
      const filename = c.req.param('path');
      if (!(await files.removeFile(projectId, filename))) {
        return c.json({ error: 'not_found' }, 404);
      }
      // The CRDT for this path is no longer relevant; drop it so a later
      // re-creation of the same path does not inherit the deleted history.
      store.deleteDocState(projectId, filename);
      docs.evict(projectId, filename);
      return c.body(null, 204);
    },
  );

  return app;
}
