// @ts-ignore
import path from 'path-browserify';

// @ts-ignore
export * from 'path-browserify';

export const win32 = {
  sep: '\\',
  delimiter: ';',
};

export default { ...path, win32 };
