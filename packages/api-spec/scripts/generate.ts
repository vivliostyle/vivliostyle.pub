import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';

import { createApp, generateSpec } from '@v/api-server-reference';

const outPath = fileURLToPath(new URL('../src/openapi.yaml', import.meta.url));

const { app } = createApp();
const spec = await generateSpec(app);

writeFileSync(outPath, stringify(spec));
console.log(`Wrote OpenAPI spec to ${outPath}`);
