import * as Comlink from 'comlink';
import { proxy, ref } from 'valtio';

import type { Sandbox } from './sandbox';

export type RemoteCli = Comlink.Remote<typeof import('@v/cli-bundle')>;

export class Cli {
  static create(sandbox: Sandbox) {
    return proxy(new Cli(sandbox));
  }

  viewerIframeElement: HTMLIFrameElement | undefined;

  protected sandbox: Sandbox;
  protected remote: RemoteCli | undefined;
  protected remoteAbortController: AbortController | undefined;
  protected lazyRemotePromise: Promise<RemoteCli> | undefined;
  protected lazyViewerUrlPromise: Promise<string> | undefined;

  protected constructor(sandbox: Sandbox) {
    this.sandbox = ref(sandbox);
  }

  createRemotePromise() {
    this.remoteAbortController ??= ref(new AbortController());
    this.lazyRemotePromise ??= this.getAwaiter();
    return this.lazyRemotePromise;
  }

  createViewerUrlPromise() {
    this.lazyViewerUrlPromise ??= (async () => {
      const remote = await this.createRemotePromise();
      await remote.setupServer();
      return `${this.sandbox.iframeOrigin}/__vivliostyle-viewer/index.html#src=${this.sandbox.iframeOrigin}/vivliostyle/publication.json&bookMode=true&renderAllPages=true`;
    })();
    return this.lazyViewerUrlPromise;
  }

  protected getAwaiter() {
    const cliPromise = new Promise<RemoteCli>((resolve, reject) => {
      const loop = () => {
        if (this.remoteAbortController?.signal.aborted) {
          reject();
        }
        if (this.remote) {
          this.remote.setupServer;
          return resolve(this.remote);
        }
        requestAnimationFrame(loop);
      };
      loop();
    });
    return cliPromise;
  }

  createRemoteResolver() {
    return {
      resolve: (value: RemoteCli) => {
        this.remote = value;
        this.remoteAbortController = undefined;
      },
      reset: () => {
        this.disposeRemote();
      },
    };
  }

  protected disposeRemote() {
    this.remote?.[Comlink.releaseProxy]();
    this.remoteAbortController?.abort();
    this.remote = undefined;
    this.lazyRemotePromise = undefined;
  }

  viewerIframeRef(el: HTMLIFrameElement | null) {
    this.viewerIframeElement = el ? ref(el) : undefined;
  }
}
