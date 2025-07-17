import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getProjectRoot() {
  // Consider git subtree projects
  if (fs.existsSync(path.join(__dirname, '../../../pnpm-workspace.yaml'))) {
    return path.resolve(__dirname, '../../..');
  }
  return path.resolve(__dirname, '../..');
}
