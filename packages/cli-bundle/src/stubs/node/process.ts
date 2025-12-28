import api from '../../../node_modules/node-stdlib-browser/esm/proxy/process';

export * from '../../../node_modules/node-stdlib-browser/esm/proxy/process';

export const stderr = {};
export const stdin = {};
export const stdout = {};
export const platform = 'linux';
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
  stdin,
  stdout,
  platform,
  version,
  versions,
  env,
};
