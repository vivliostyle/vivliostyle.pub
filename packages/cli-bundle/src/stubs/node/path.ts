// @ts-ignore
import _path from 'path-browserify';

const FunctionPrototypeCall = Function.prototype.call;
// @ts-ignore
function uncurryThis(func) {
  return FunctionPrototypeCall.bind(func);
}
const StringPrototypeCharCodeAt = uncurryThis(String.prototype.charCodeAt);
const StringPrototypeSlice = uncurryThis(String.prototype.slice);

function validateString(path: string, name: string) {
  if (typeof path !== 'string') {
    throw new TypeError(
      `${name} must be a string. Received ${JSON.stringify(path)}`,
    );
  }
}

const CHAR_DOT = 46; /* . */
const CHAR_COLON = 58; /* : */

function isPathSeparator(code: number) {
  return code === 47 /* / */ || code === 92 /* \ */;
}

function isWindowsDeviceRoot(code: number) {
  return (
    (code >= 65 /* A */ && code <= 90) /* Z */ ||
    (code >= 97 /* a */ && code <= 122) /* z */
  );
}

// @ts-ignore
export * from 'path-browserify';

export const win32 = {
  sep: '\\',
  delimiter: ';',
  isAbsolute: (path: string) => {
    validateString(path, 'path');
    const len = path.length;
    if (len === 0) {
      return false;
    }

    const code = StringPrototypeCharCodeAt(path, 0);
    return (
      isPathSeparator(code) ||
      // Possible device root
      (len > 2 &&
        isWindowsDeviceRoot(code) &&
        StringPrototypeCharCodeAt(path, 1) === CHAR_COLON &&
        isPathSeparator(StringPrototypeCharCodeAt(path, 2)))
    );
  },
  parse: (path: string) => {
    validateString(path, 'path');

    const ret = { root: '', dir: '', base: '', ext: '', name: '' };
    if (path.length === 0) {
      return ret;
    }

    const len = path.length;
    let rootEnd = 0;
    let code = StringPrototypeCharCodeAt(path, 0);

    if (len === 1) {
      if (isPathSeparator(code)) {
        // `path` contains just a path separator, exit early to avoid
        // unnecessary work
        ret.root = ret.dir = path;
        return ret;
      }
      ret.base = ret.name = path;
      return ret;
    }
    // Try to match a root
    if (isPathSeparator(code)) {
      // Possible UNC root

      rootEnd = 1;
      if (isPathSeparator(StringPrototypeCharCodeAt(path, 1))) {
        // Matched double path separator at beginning
        let j = 2;
        let last = j;
        // Match 1 or more non-path separators
        while (
          j < len &&
          !isPathSeparator(StringPrototypeCharCodeAt(path, j))
        ) {
          j++;
        }
        if (j < len && j !== last) {
          // Matched!
          last = j;
          // Match 1 or more path separators
          while (
            j < len &&
            isPathSeparator(StringPrototypeCharCodeAt(path, j))
          ) {
            j++;
          }
          if (j < len && j !== last) {
            // Matched!
            last = j;
            // Match 1 or more non-path separators
            while (
              j < len &&
              !isPathSeparator(StringPrototypeCharCodeAt(path, j))
            ) {
              j++;
            }
            if (j === len) {
              // We matched a UNC root only
              rootEnd = j;
            } else if (j !== last) {
              // We matched a UNC root with leftovers
              rootEnd = j + 1;
            }
          }
        }
      }
    } else if (
      isWindowsDeviceRoot(code) &&
      StringPrototypeCharCodeAt(path, 1) === CHAR_COLON
    ) {
      // Possible device root
      if (len <= 2) {
        // `path` contains just a drive root, exit early to avoid
        // unnecessary work
        ret.root = ret.dir = path;
        return ret;
      }
      rootEnd = 2;
      if (isPathSeparator(StringPrototypeCharCodeAt(path, 2))) {
        if (len === 3) {
          // `path` contains just a drive root, exit early to avoid
          // unnecessary work
          ret.root = ret.dir = path;
          return ret;
        }
        rootEnd = 3;
      }
    }
    if (rootEnd > 0) {
      ret.root = StringPrototypeSlice(path, 0, rootEnd);
    }

    let startDot = -1;
    let startPart = rootEnd;
    let end = -1;
    let matchedSlash = true;
    let i = path.length - 1;

    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find
    let preDotState = 0;

    // Get non-dir info
    for (; i >= rootEnd; --i) {
      code = StringPrototypeCharCodeAt(path, i);
      if (isPathSeparator(code)) {
        // If we reached a path separator that was not part of a set of path
        // separators at the end of the string, stop now
        if (!matchedSlash) {
          startPart = i + 1;
          break;
        }
        continue;
      }
      if (end === -1) {
        // We saw the first non-path separator, mark this as the end of our
        // extension
        matchedSlash = false;
        end = i + 1;
      }
      if (code === CHAR_DOT) {
        // If this is our first dot, mark it as the start of our extension
        if (startDot === -1) startDot = i;
        else if (preDotState !== 1) preDotState = 1;
      } else if (startDot !== -1) {
        // We saw a non-dot and non-path separator before our dot, so we should
        // have a good chance at having a non-empty extension
        preDotState = -1;
      }
    }

    if (end !== -1) {
      if (
        startDot === -1 ||
        // We saw a non-dot character immediately before the dot
        preDotState === 0 ||
        // The (right-most) trimmed path component is exactly '..'
        (preDotState === 1 &&
          startDot === end - 1 &&
          startDot === startPart + 1)
      ) {
        ret.base = ret.name = StringPrototypeSlice(path, startPart, end);
      } else {
        ret.name = StringPrototypeSlice(path, startPart, startDot);
        ret.base = StringPrototypeSlice(path, startPart, end);
        ret.ext = StringPrototypeSlice(path, startDot, end);
      }
    }

    // If the directory is the root, use the entire root as the `dir` including
    // the trailing slash if any (`C:\abc` -> `C:\`). Otherwise, strip out the
    // trailing slash (`C:\abc\def` -> `C:\abc`).
    if (startPart > 0 && startPart !== rootEnd) {
      ret.dir = StringPrototypeSlice(path, 0, startPart - 1);
    } else {
      ret.dir = ret.root;
    }

    return ret;
  },
};

export default { ..._path, win32 };
