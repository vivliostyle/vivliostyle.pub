import type { Hono } from 'hono';
import { type GenerateSpecOptions, generateSpecs } from 'hono-openapi';

export function openApiDocumentation(): GenerateSpecOptions['documentation'] {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Vivliostyle Pub Sync API',
      version: '0.1.0',
      description: [
        'The Vivliostyle Pub Sync API lets you sign in, manage your book',
        'projects, and keep their contents synchronized across devices.',
        '',
        '- **Sign in** with OAuth 2.1 + PKCE to obtain a bearer token, then send it as `Authorization: Bearer <token>` on every other call.',
        '- **Manage projects** — list, create, update, or delete the books on your account.',
        '- **Read and write project files** — individual text/source files plus larger binary assets stored as attachments.',
        '- **Sync collaboratively** — exchange document updates with other editors in realtime over WebSocket, or one-shot over HTTP.',
        '',
        'All endpoints except the ones under **auth** and **capabilities** require a valid bearer token.',
      ].join('\n'),
    },
    servers: [
      { url: '/', description: 'Same origin as this documentation page' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Access token obtained from `POST /auth/oauth2/token`. Send it as `Authorization: Bearer <token>`.',
        },
        sessionAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Session token obtained from `POST /auth/sign-in`. Send it as `Authorization: Bearer <token>`.',
        },
      },
    },
    tags: [
      {
        name: 'auth',
        description:
          'Sign in and manage access tokens. Uses OAuth 2.1 with PKCE; the resulting bearer token authorizes every other endpoint.',
      },
      {
        name: 'projects',
        description:
          'Create, list, update, and delete the book projects on your account. Each project is the container for its files, attachments, and collaborative-editing state.',
      },
      {
        name: 'files',
        description:
          'Read and write the source files (Markdown, CSS, configuration, etc.) inside a project.',
      },
      {
        name: 'attachments',
        description:
          'Upload and fetch binary assets — such as images embedded in a book — addressed by their SHA-256 hash. Identical contents are stored only once.',
      },
      {
        name: 'sync',
        description:
          'Exchange collaborative-editing updates for a project. The realtime channel is a WebSocket; these HTTP endpoints provide the same data for clients that cannot keep a socket open. Updates use the Yjs CRDT binary format.',
      },
      {
        name: 'capabilities',
        description:
          'Discover the server name, version, and which optional features it supports.',
      },
    ],
  };
}

export async function generateSpec(app: Hono) {
  const spec = await generateSpecs(app, {
    documentation: openApiDocumentation(),
  });
  // hono-openapi documents every `validator('form', …)` body as
  // `multipart/form-data`, but the OAuth2 endpoints' clients send
  // `application/x-www-form-urlencoded`, so relabel those to match the wire
  // format. The plugin's `media` override option can't be used: in 1.3.0 it
  // mis-parses and yields `application/json`. The batch file-write endpoint is
  // genuine multipart, so this is scoped to `/auth/*` to leave it untouched.
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!path.startsWith('/auth')) continue;
    for (const operation of Object.values(pathItem ?? {})) {
      const content = (
        operation as {
          requestBody?: { content?: Record<string, unknown> };
        }
      )?.requestBody?.content;
      if (content?.['multipart/form-data']) {
        content['application/x-www-form-urlencoded'] =
          content['multipart/form-data'];
        delete content['multipart/form-data'];
      }
    }
  }
  return spec;
}

export interface OpenApiReferencePageOptions {
  /** URL the viewer fetches the spec from. Defaults to `/openapi`. */
  specUrl?: string;
  /** Document `<title>`. Defaults to the spec's `info.title`. */
  title?: string;
}

/**
 * Self-contained HTML page that renders the OpenAPI spec via the Scalar API
 * Reference viewer loaded from a CDN. Kept dependency-free so the reference
 * server can serve docs without bundling a UI; clients hitting the page need
 * outbound access to jsdelivr.
 */
export function openApiReferencePage(
  options: OpenApiReferencePageOptions = {},
): string {
  const specUrl = options.specUrl ?? '/openapi';
  const title = options.title ?? openApiDocumentation().info?.title ?? 'API';
  const escapeHtml = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c] as string,
    );
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <script id="api-reference" data-url="${escapeHtml(specUrl)}"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>
`;
}
