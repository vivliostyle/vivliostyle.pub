import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';

import { createApp, generateSpec } from '@v/api-server-reference';

const specPath = fileURLToPath(new URL('./openapi.yaml', import.meta.url));
const openapiSpec = parse(readFileSync(specPath, 'utf8'));

describe('openapi.yaml', () => {
  it('is a valid OpenAPI 3.1 document', () => {
    expect(openapiSpec.openapi).toBe('3.1.0');
    expect(openapiSpec.info?.title).toBeTruthy();
    expect(Object.keys(openapiSpec.paths ?? {}).length).toBeGreaterThan(0);
    expect(openapiSpec.components?.securitySchemes?.bearerAuth).toBeDefined();
  });

  it('matches the spec generated from the reference implementation (no drift)', async () => {
    const { app } = createApp();
    const fresh = await generateSpec(app);
    // Round-trip through YAML so the comparison matches what the committed
    // file stores (e.g. undefined fields stripped, key ordering preserved).
    expect(parse(stringify(fresh))).toEqual(openapiSpec);
  });
});
