const noop = () => {};

export const exec = noop;
export const execFile = noop;
export const execSync = noop;
export const spawn = noop;
export const spawnSync = noop;

export default {
  exec,
  execFile,
  execSync,
  spawn,
  spawnSync,
};
