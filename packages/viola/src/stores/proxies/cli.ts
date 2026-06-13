import * as Comlink from 'comlink';
import { proxy, ref } from 'valtio';

import type { Sandbox } from './sandbox';

export type RemoteCli = Comlink.Remote<typeof import('@v/cli-bundle')>;

export class Cli {
  protected static remoteMap = new Map<string, RemoteCli>();

  static create(sandbox: Sandbox) {
    return proxy(new Cli(sandbox));
  }

  protected sandbox: Sandbox;
  protected remoteDeferred: PromiseWithResolvers<RemoteCli> | undefined;
  protected lazyViewerUrlPromise: Promise<string> | undefined;

  protected constructor(sandbox: Sandbox) {
    this.sandbox = ref(sandbox);
  }

  createRemotePromise(): Promise<RemoteCli> {
    const existing = Cli.remoteMap.get(this.sandbox.iframeOrigin);
    if (existing) {
      return Promise.resolve(existing);
    }
    this.remoteDeferred ??= ref(Promise.withResolvers<RemoteCli>());
    return this.remoteDeferred.promise;
  }

  createViewerUrlPromise() {
    this.lazyViewerUrlPromise ??= (async () => {
      const remote = await this.createRemotePromise();
      await remote.setupServer();
      return `${this.sandbox.iframeOrigin}/__vivliostyle-viewer/index.html#src=${this.sandbox.iframeOrigin}/vivliostyle/publication.json&bookMode=true&renderAllPages=true`;
    })();
    return this.lazyViewerUrlPromise;
  }

  createRemoteResolver() {
    return {
      resolve: (value: RemoteCli) => {
        Cli.remoteMap.set(this.sandbox.iframeOrigin, value);
        this.remoteDeferred?.resolve(value);
        this.remoteDeferred = undefined;
      },
      reset: () => {
        this.disposeRemote();
      },
    };
  }

  protected disposeRemote() {
    const remote = Cli.remoteMap.get(this.sandbox.iframeOrigin);
    if (remote) {
      remote[Comlink.releaseProxy]();
      Cli.remoteMap.delete(this.sandbox.iframeOrigin);
    }
    this.remoteDeferred?.reject(new Error('CLI remote disposed'));
    this.remoteDeferred = undefined;
    this.lazyViewerUrlPromise = undefined;
  }
}
