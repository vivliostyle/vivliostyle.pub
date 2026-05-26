import type { Hono } from 'hono';
import { type GenerateSpecOptions, generateSpecs } from 'hono-openapi';

export function openApiDocumentation(): GenerateSpecOptions['documentation'] {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Vivliostyle Pub Sync API',
      version: '0.1.0',
      description:
        'Open API for Vivliostyle Pub project sync, files, attachments, and OAuth 2.1 authentication. Generated from the reference implementation (@v/api-server-reference); do not edit by hand.',
    },
    servers: [{ url: '/', description: 'Relative to the server origin' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
    },
    tags: [
      { name: 'auth', description: 'OAuth 2.1 + PKCE authentication' },
      { name: 'projects', description: 'Project metadata' },
      { name: 'files', description: 'Direct file access' },
      {
        name: 'attachments',
        description: 'Content-addressed binary attachments',
      },
      { name: 'sync', description: 'Yjs document sync (HTTP fallback)' },
      { name: 'capabilities', description: 'Server capability discovery' },
    ],
  };
}

export function generateSpec(app: Hono) {
  return generateSpecs(app, { documentation: openApiDocumentation() });
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
