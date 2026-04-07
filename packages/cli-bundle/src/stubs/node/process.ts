import api from '../../../node_modules/node-stdlib-browser/esm/proxy/process';

export * from '../../../node_modules/node-stdlib-browser/esm/proxy/process';

export const stderr = {};
export const stdout = {};
export const version = `v${__nodeVersion__}`;
export const versions = {
  node: __nodeVersion__,
};
export const env = {
  NODE_ENV: 'development',
  DEBUG: true,
};

export default {
  ...api,
  stderr,
  stdout,
  version,
  versions,
  env,
};
