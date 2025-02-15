const noop = () => {};

export const builtinModules = [];
export const createRequire = noop;

export default {
  builtinModules,
  createRequire,
};
