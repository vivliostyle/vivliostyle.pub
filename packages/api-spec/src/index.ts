import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const specPath = fileURLToPath(new URL('./openapi.yaml', import.meta.url));

/**
 * The OpenAPI 3.1 document for the Vivliostyle Pub sync API.
 *
 * This is a generated artifact. The source of truth is the reference
 * implementation (`@v/api-server-reference`); regenerate with
 * `pnpm --filter @v/api-spec generate`.
 */
export const openapiSpec = parse(readFileSync(specPath, 'utf8'));
export default openapiSpec;
