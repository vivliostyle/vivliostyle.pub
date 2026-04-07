const noop = () => {};

export const exec = noop;
export const execFile = noop;
export const execSync = noop;

export default {
  exec,
  execFile,
  execSync,
};
