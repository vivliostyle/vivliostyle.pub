// @ts-expect-error
import api from 'crypto-browserify';

// @ts-expect-error
export * from 'crypto-browserify';

export const getRandomValues = <T extends ArrayBufferView | null>(array: T) =>
  globalThis.crypto.getRandomValues(array);
export const randomUUID = () => globalThis.crypto.randomUUID();

export default {
  ...api,
  getRandomValues,
  randomUUID,
};
