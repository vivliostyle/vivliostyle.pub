// @ts-expect-error
import util from '../../../node_modules/util';

export default util;
export const {
  // _errnoException,
  // _exceptionWithHostPort,
  _extend,
  callbackify,
  // debug,
  debuglog,
  deprecate,
  format,
  // styleText,
  // formatWithOptions,
  // getCallSite,
  // getCallSites,
  // getSystemErrorMap,
  // getSystemErrorName,
  // getSystemErrorMessage,
  inherits,
  inspect,
  isArray,
  isBoolean,
  isBuffer,
  // isDeepStrictEqual,
  isNull,
  isNullOrUndefined,
  isNumber,
  isString,
  isSymbol,
  isUndefined,
  isRegExp,
  isObject,
  isDate,
  isError,
  isFunction,
  isPrimitive,
  log,
  promisify,
  // stripVTControlCharacters,
  // toUSVString,
  // transferableAbortSignal,
  // transferableAbortController,
  // aborted,
  types,
  // parseEnv,
  // parseArgs,
  // TextDecoder,
  // TextEncoder,
  // MIMEType,
  // MIMEParams,
} = util;

export const TextDecoder = globalThis.TextDecoder;
export const TextEncoder = globalThis.TextEncoder;

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
