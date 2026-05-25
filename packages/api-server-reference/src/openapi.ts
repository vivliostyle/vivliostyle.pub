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
