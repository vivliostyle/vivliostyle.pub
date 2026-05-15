// Re-export everything from unenv's crypto polyfill: it ships real
// implementations of `subtle` / `getRandomValues` / `randomUUID` / `randomBytes`
// / `webcrypto` (all backed by Web Crypto), and lazy-throwing stubs for the
// algorithms we don't reach (createCipheriv / createSign / pbkdf2 / etc.).
//
// vite 8 needs synchronous `createHash` and `hash` (used by content addressing
// during request transforms). unenv stubs both as `notImplemented`, so route
// those two calls to `create-hash` — a tiny dependency (~30KB tree of
// `sha.js` + `md5.js` + `ripemd160` + `cipher-base`) without the elliptic /
// bn.js / asn1.js baggage of the full `crypto-browserify` package.

// @ts-expect-error: create-hash has no types
import _createHash from 'create-hash';
import unenvCrypto from 'unenv/node/crypto';

export * from 'unenv/node/crypto';

type Encoding = 'hex' | 'base64' | 'base64url' | 'binary' | 'latin1';

export const createHash = (algorithm: string) => _createHash(algorithm);

export const hash = (
  algorithm: string,
  data: string | ArrayBufferView,
  encoding: Encoding = 'hex',
) => createHash(algorithm).update(data).digest(encoding);

export default {
  ...unenvCrypto,
  createHash,
  hash,
};
