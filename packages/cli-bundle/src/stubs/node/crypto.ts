// @ts-expect-error
import api, { createHash } from 'crypto-browserify';

// @ts-expect-error
export * from 'crypto-browserify';

export const getRandomValues = <T extends ArrayBufferView | null>(array: T) =>
  globalThis.crypto.getRandomValues(array);
export const randomUUID = () => globalThis.crypto.randomUUID();

// `crypto.hash(algorithm, data, encoding?)` is a single-shot synchronous API
// added in Node 21. crypto-browserify only exposes the streaming `createHash`,
// so vite 8 (which calls `crypto.hash` for content addressing) blows up. Build
// it on top of `createHash` here.
type Encoding = 'hex' | 'base64' | 'base64url' | 'binary';
export const hash = (
  algorithm: string,
  data: string | ArrayBufferView,
  encoding: Encoding = 'hex',
) => createHash(algorithm).update(data).digest(encoding);

export default {
  ...api,
  getRandomValues,
  randomUUID,
  hash,
};
