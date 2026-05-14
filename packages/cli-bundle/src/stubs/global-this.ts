import _process from './node/process';

// Resolve the real global object via `Function`; the bundler-time `inject`
// pass rewrites every literal `globalThis` identifier into the default import
// of *this* file, so writing it directly here would create a self-reference.
const root = new Function('return globalThis')() as typeof globalThis;

// @ts-ignore
root.process = _process;

export default root;
