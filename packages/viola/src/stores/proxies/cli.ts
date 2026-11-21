import * as Comlink from 'comlink';
import { proxy, ref } from 'valtio';

import { stageSearchParams } from '@v/viewer/protocol';
import { appOrigin } from '../../libs/origins';
import type { Sandbox } from './sandbox';

export type RemoteCli = Comlink.Remote<typeof import('@v/cli-bundle')>;

export class Cli {
  static create(sandbox: Sandbox) {
    return proxy(new Cli(sandbox));
  }

  protected sandbox: Sandbox;
  protected remote: RemoteCli | undefined;
  protected remoteDeferred: PromiseWithResolvers<RemoteCli> | undefined;
  protected disposed = false;
  protected lazyViewerUrlPromise: Promise<string> | undefined;
  protected lazyPrintViewerUrlPromise: Promise<string> | undefined;

  protected constructor(sandbox: Sandbox) {
    this.sandbox = ref(sandbox);
  }

  createRemotePromise(): Promise<RemoteCli> {
    if (this.disposed) {
      return Promise.reject(new Error('CLI remote disposed'));
    }
    if (this.remote) {
      return Promise.resolve(this.remote);
    }
    this.remoteDeferred ??= ref(Promise.withResolvers<RemoteCli>());
    return this.remoteDeferred.promise;
  }

  createViewerUrlPromise() {
    this.lazyViewerUrlPromise ??= (async () => {
      const remote = await this.createRemotePromise();
      await remote.setupServer();
      const url = new URL('/_viewer/', this.sandbox.iframeOrigin);
      url.searchParams.set(
        stageSearchParams.src,
        `${this.sandbox.iframeOrigin}/vivliostyle/publication.json`,
      );
      return url.href;
    })();
    return this.lazyViewerUrlPromise;
  }

  // Viewer URL for the top-level print tab, served from the app origin. A
  // top-level tab on the sandbox origin lives in its own storage partition,
  // where the sandbox SW cannot reach the CLI worker over BroadcastChannel;
  // the host SW instead relays requests through the host page (see
  // `serveProjectResource`). The `/p/<projectId>/` prefix routes the request
  // to the tab that owns this project.
  createPrintViewerUrlPromise() {
    this.lazyPrintViewerUrlPromise ??= (async () => {
      const remote = await this.createRemotePromise();
      await remote.setupServer();
      const url = new URL('/_viewer/', appOrigin());
      url.searchParams.set(
        stageSearchParams.src,
        `${appOrigin()}/vivliostyle/p/${this.sandbox.projectId}/publication.json`,
      );
      url.searchParams.set(stageSearchParams.print, 'true');
      return url.href;
    })();
    return this.lazyPrintViewerUrlPromise;
  }

  createRemoteResolver() {
    return {
      resolve: (value: RemoteCli) => {
        this.remote = ref(value);
        this.remoteDeferred?.resolve(value);
        this.remoteDeferred = undefined;
      },
      reset: () => {
        this.releaseRemote();
      },
    };
  }

  dispose() {
    this.disposed = true;
    this.releaseRemote();
  }

  protected releaseRemote() {
    this.remote?.[Comlink.releaseProxy]();
    this.remote = undefined;
    this.remoteDeferred?.reject(new Error('CLI remote disposed'));
    this.remoteDeferred = undefined;
    this.lazyViewerUrlPromise = undefined;
    this.lazyPrintViewerUrlPromise = undefined;
  }
}
