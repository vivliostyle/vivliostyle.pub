// Re-export everything from unenv's http polyfill, but override `createServer`
// and `Server` because vite's `createServer` internally calls `http.createServer`
// only to register listeners — the actual request flow goes through connect's
// `app.handle(req, res)` from our `serve()` wrapper, not a real HTTP listener.
// unenv's `notImplemented` would throw immediately and break setupServer.
import unenvHttp from 'unenv/node/http';

export * from 'unenv/node/http';

class FakeServer {
  listen() {
    return this;
  }
  close() {
    return this;
  }
  on() {
    return this;
  }
  off() {
    return this;
  }
  emit() {
    return false;
  }
  address() {
    return null;
  }
}

export const Server = FakeServer as unknown as typeof unenvHttp.Server;
export const createServer = () =>
  new FakeServer() as unknown as InstanceType<typeof unenvHttp.Server>;

export default {
  ...unenvHttp,
  Server,
  createServer,
};
