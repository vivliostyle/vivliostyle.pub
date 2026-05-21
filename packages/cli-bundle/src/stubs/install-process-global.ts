// Side-effect module: assign unenv's `process` polyfill onto the real global
// object so code that reads `globalThis.process` directly (e.g. `@clack/core`)
// gets a real Process. The bundler-time `inject` pass only rewrites bare
// `process` identifiers, so it doesn't cover `globalThis.process` access.
//
// This lives in its own file (rather than `global-this.ts`) to avoid a
// circular init order: `unenv/node/process` transitively runs an `init_env`
// step that reads `globalThis.process`, and `global-this.ts`'s assignment
// happens AFTER that init runs. Importing this file from `src/index.ts` first
// schedules the `process` global before unenv's env probe.
//
// Vite injects a stub `globalThis.process = { env: { NODE_ENV, ... } }` into
// worker contexts for `process.env.*` access. We need to replace that stub
// with unenv's full polyfill (so `platform`, `cwd()`, etc. exist) while
// preserving any `env` entries the bundler/runtime set up.
import unenvProcess from 'unenv/node/process';

const root = new Function('return globalThis')() as {
  process?: { env?: Record<string, unknown> };
};

if (root.process !== unenvProcess) {
  const existingEnv = root.process?.env;
  root.process = unenvProcess;
  if (existingEnv && typeof existingEnv === 'object') {
    Object.assign(unenvProcess.env, existingEnv);
  }
}
