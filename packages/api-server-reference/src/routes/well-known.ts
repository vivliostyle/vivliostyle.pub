import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';

import type { Deps } from '../deps';
import { jsonContent } from '../route-helpers';
import { CapabilitiesSchema } from '../schemas';

export function wellKnownRoutes({ config }: Deps) {
  const app = new Hono();

  app.get(
    '/.well-known/vivliostyle-pub',
    describeRoute({
      tags: ['capabilities'],
      summary: 'Server capabilities and supported API versions.',
      responses: {
        200: {
          description: 'Capabilities',
          content: jsonContent(CapabilitiesSchema),
        },
      },
    }),
    (c) =>
      c.json(
        {
          name: config.name,
          version: config.version,
          apiVersions: ['1.0'],
          features: { sync: true, attachments: true, oauth: true },
        },
        200,
      ),
  );

  return app;
}
