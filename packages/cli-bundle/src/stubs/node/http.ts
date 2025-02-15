// @ts-expect-error
import api from 'stream-http';

// @ts-expect-error
export * from 'stream-http';

const noop = () => {};
export const createServer = () => {
  return {
    on: noop,
    listen: noop,
  };
};

export class Server {}

export default {
  ...api,
  createServer,
  Server,
};
