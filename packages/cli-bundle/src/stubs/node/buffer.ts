// Re-export everything from unenv's buffer polyfill (which embeds feross/buffer
// for the actual Buffer class and prefers `globalThis.Buffer` when available).
// `isUtf8` is `notImplemented` in unenv, so override with a real
// TextDecoder-based check.
import unenvBuffer, { Buffer as _Buffer } from 'unenv/node/buffer';

export * from 'unenv/node/buffer';

// Node 15+ added `base64url` encoding to `Buffer.from()` / `.toString()`.
// feross/buffer (what unenv ships) only knows base64/utf8/hex/etc., so vite 8's
// content addressing throws `Unknown encoding: base64url`. Patch Buffer to
// translate `base64url` to/from standard `base64` (URL-safe alphabet ↔ standard
// alphabet, no padding round-trip).
const base64ToBase64Url = (s: string) =>
  s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const base64UrlToBase64 = (s: string) => {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  return pad ? padded + '='.repeat(4 - pad) : padded;
};

// biome-ignore lint/suspicious/noExplicitAny: monkey-patching Buffer overloads
const B = _Buffer as any;
const _from = B.from.bind(B);
B.from = (...args: unknown[]) => {
  if (args[1] === 'base64url' && typeof args[0] === 'string') {
    return _from(base64UrlToBase64(args[0]), 'base64');
  }
  return _from(...args);
};

const _toString = B.prototype.toString;
B.prototype.toString = function patchedToString(
  encoding?: string,
  ...rest: number[]
) {
  if (encoding === 'base64url') {
    return base64ToBase64Url(_toString.call(this, 'base64', ...rest));
  }
  return _toString.call(this, encoding, ...rest);
};

export const isUtf8 = (value: unknown): boolean => {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    if (
      value instanceof Uint8Array ||
      (value && typeof value === 'object' && 'buffer' in value)
    ) {
      const view = value as ArrayBufferView;
      decoder.decode(
        new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
      );
    } else if (value instanceof ArrayBuffer) {
      decoder.decode(new Uint8Array(value));
    } else {
      return false;
    }
    return true;
  } catch {
    return false;
  }
};

export default { ...unenvBuffer, isUtf8 };
