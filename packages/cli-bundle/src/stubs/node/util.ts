// Re-export everything from unenv's util polyfill: it ships real implementations
// of `format` / `formatWithOptions` / `inspect` / `promisify` / `inherits` /
// `deprecate` / `MIMEType` / `MIMEParams` / `TextDecoder` / `TextEncoder` and
// the legacy type predicates (isArray / isBoolean / isBuffer / ...).
//
// `parseEnv` and `stripVTControlCharacters` are `notImplemented` in unenv but
// referenced statically (vite's logger imports `stripVTControlCharacters`,
// vite's env-file path imports `parseEnv`), so we provide minimal shims.
import unenvUtil from 'unenv/node/util';

export * from 'unenv/node/util';

export const parseEnv = (_content: string): Record<string, string> => ({});

const ansi = new RegExp(
  '[\\u001B\\u009B][[\\]()#;?]*' +
    '(?:(?:(?:(?:;[-a-zA-Z\\d\\/\\#&.:=?%@~_]+)*' +
    '|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/\\#&.:=?%@~_]*)*)?' +
    '(?:\\u0007|\\u001B\\u005C|\\u009C))' +
    '|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?' +
    '[\\dA-PR-TZcf-nq-uy=><~]))',
  'g',
);
export const stripVTControlCharacters = (str: string) => {
  if (typeof str !== 'string') {
    throw new TypeError(
      '[ERR_INVALID_ARG_TYPE]: The "str" argument must be of type string.',
    );
  }
  return str.replace(ansi, '');
};

export default {
  ...unenvUtil,
  parseEnv,
  stripVTControlCharacters,
};
