import { describe, expect, it } from 'vitest';

import { createApp, generateSpec } from '@v/api-server-reference';
import openapiSpec from './openapi.json' with { type: 'json' };

describe('openapi.json', () => {
  it('is a valid OpenAPI 3.1 document', () => {
    expect(openapiSpec.openapi).toBe('3.1.0');
    expect(openapiSpec.info?.title).toBeTruthy();
    expect(Object.keys(openapiSpec.paths ?? {}).length).toBeGreaterThan(0);
    expect(openapiSpec.components?.securitySchemes?.bearerAuth).toBeDefined();
  });

  it('matches the spec generated from the reference implementation (no drift)', async () => {
    const { app } = createApp();
    const fresh = await generateSpec(app);
    // Normalize the same way the committed file was written (JSON.stringify).
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(openapiSpec);
  });
});
