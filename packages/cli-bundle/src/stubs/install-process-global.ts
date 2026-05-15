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
import unenvProcess from 'unenv/node/process';

const root = new Function('return globalThis')() as typeof globalThis;

if (!root.process) {
  // @ts-ignore — unenv Process is structurally compatible with NodeJS.Process
  root.process = unenvProcess;
}
