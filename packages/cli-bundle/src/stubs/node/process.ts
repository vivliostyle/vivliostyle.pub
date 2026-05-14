import api from '../../../node_modules/node-stdlib-browser/esm/proxy/process';

export * from '../../../node_modules/node-stdlib-browser/esm/proxy/process';

export const stderr = {};
export const stdin = {};
export const stdout = {};
export const platform = 'linux';
// vite's bundled `chunks/node.js` has fs-walking helpers that do
// `process.versions.node.split(".")` to gate behavior on a node version, so
// `versions.node` has to be a real string. emnapi *also* reads it and would
// then think we're running in Node — see `patchEmnapiEnvDetectionPlugin` in
// rolldown.config.ts, which forces `ENVIRONMENT_IS_NODE = false` in the
// emnapi files so the browser code path keeps winning.
export const versions = {
  node: '24.11.1',
};
export const env = {
  NODE_ENV: 'development',
};

export default {
  ...api,
  stderr,
  stdin,
  stdout,
  platform,
  versions,
  env,
};
