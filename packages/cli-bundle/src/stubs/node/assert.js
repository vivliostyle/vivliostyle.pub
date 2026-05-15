// CJS stub for `assert`. rolldown's __toCommonJS helper returns mod["module.exports"]
// when the own property exists, so a CJS require('assert') gets the callable `ok`
// function rather than a plain ESM namespace object. browserify-zlib needs both
// assert(cond) (callable form) and assert.equal(a, b).
function ok(value, message) {
  if (!value) {
    throw message instanceof Error
      ? message
      : new Error(message != null ? String(message) : 'Assertion failed');
  }
}
ok.ok = ok;
ok.fail = function fail(message) {
  throw message instanceof Error
    ? message
    : new Error(String(message ?? 'Failed'));
};
ok.equal = function equal(a, b, message) {
  // biome-ignore lint/suspicious/noDoubleEquals: intentional loose equality for assert.equal
  if (a != b) {
    throw message instanceof Error
      ? message
      : new Error(message != null ? String(message) : `${a} == ${b}`);
  }
};
ok.notEqual = function notEqual(a, b, message) {
  // biome-ignore lint/suspicious/noDoubleEquals: intentional loose equality for assert.notEqual
  if (a == b) {
    throw message instanceof Error
      ? message
      : new Error(message != null ? String(message) : `${a} != ${b}`);
  }
};
ok.strictEqual = function strictEqual(a, b, message) {
  if (a !== b) {
    throw message instanceof Error
      ? message
      : new Error(message != null ? String(message) : `${a} === ${b}`);
  }
};
ok.notStrictEqual = function notStrictEqual(a, b, message) {
  if (a === b) {
    throw message instanceof Error
      ? message
      : new Error(message != null ? String(message) : `${a} !== ${b}`);
  }
};
ok.deepEqual = ok.equal;
ok.notDeepEqual = ok.notEqual;
ok.deepStrictEqual = ok.strictEqual;
ok.notDeepStrictEqual = ok.notStrictEqual;
ok.throws = function throws(fn, _expected, message) {
  try {
    fn();
  } catch (_e) {
    return;
  }
  throw message instanceof Error
    ? message
    : new Error(
        message != null ? String(message) : 'Expected function to throw',
      );
};
ok.doesNotThrow = function doesNotThrow(fn, _expected, message) {
  try {
    fn();
  } catch (e) {
    const err =
      message instanceof Error
        ? message
        : new Error(
            message != null
              ? String(message)
              : 'Expected function not to throw',
          );
    err.cause = e;
    throw err;
  }
};
ok.ifError = function ifError(value) {
  if (value != null && value !== false) {
    throw value instanceof Error ? value : new Error(String(value));
  }
};
ok.match = function match(string, regexp, message) {
  if (!regexp.test(string)) {
    throw message instanceof Error
      ? message
      : new Error(
          message != null ? String(message) : `${string} matched ${regexp}`,
        );
  }
};
ok.doesNotMatch = function doesNotMatch(string, regexp, message) {
  if (regexp.test(string)) {
    throw message instanceof Error
      ? message
      : new Error(
          message != null
            ? String(message)
            : `${string} did not match ${regexp}`,
        );
  }
};
ok.strict = ok;
module.exports = ok;
