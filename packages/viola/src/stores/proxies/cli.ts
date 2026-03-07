import * as Comlink from 'comlink';
import { proxy, ref } from 'valtio';

import { awaiter } from '../../libs/awaiter';
import type { Sandbox } from './sandbox';

export type RemoteCli = Comlink.Remote<typeof import('@v/cli-bundle')>;

export class Cli {
  protected static remoteMap = new Map<string, RemoteCli>();

  static create(sandbox: Sandbox) {
    return proxy(new Cli(sandbox));
  }

  viewerIframeElement: HTMLIFrameElement | undefined;

  protected sandbox: Sandbox;
  protected remoteAbortController: AbortController | undefined;
  protected lazyRemotePromise: Promise<RemoteCli> | undefined;
  protected lazyViewerUrlPromise: Promise<string> | undefined;

  protected constructor(sandbox: Sandbox) {
    this.sandbox = ref(sandbox);
  }

  createRemotePromise() {
    this.remoteAbortController ??= ref(new AbortController());
    this.lazyRemotePromise ??= awaiter({
      getter: () => Cli.remoteMap.get(this.sandbox.iframeOrigin),
      name: 'createRemoteResolver',
      abortSignal: this.remoteAbortController.signal,
    });
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

  createRemoteResolver() {
    return {
      resolve: (value: RemoteCli) => {
        Cli.remoteMap.set(this.sandbox.iframeOrigin, value);
        this.remoteAbortController = undefined;
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
    this.remoteAbortController?.abort();
    this.lazyRemotePromise = undefined;
    this.lazyViewerUrlPromise = undefined;
  }

  viewerIframeRef(el: HTMLIFrameElement | null) {
    this.viewerIframeElement = el ? ref(el) : undefined;
  }
}
