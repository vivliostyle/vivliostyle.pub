export * from 'node-stdlib-browser/mock/dns';

// https://github.com/vitejs/vite/blob/335e2155c4d09f73e156667fd061b460224f8199/packages/vite/src/node/utils.ts#L923
export const promises = {
  lookup: () =>
    Promise.resolve({
      address: '127.0.0.1',
      family: 4,
    }),
};
