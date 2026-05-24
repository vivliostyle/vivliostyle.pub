import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createApp, generateSpec } from '@v/api-server-reference';

const outPath = fileURLToPath(new URL('../src/openapi.json', import.meta.url));

const { app } = createApp();
const spec = await generateSpec(app);

writeFileSync(outPath, `${JSON.stringify(spec, null, 2)}\n`);
console.log(`Wrote OpenAPI spec to ${outPath}`);
