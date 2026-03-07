import { invariant } from 'outvariant';
import { proxy } from 'valtio';

import { awaiter } from '../libs/awaiter';
import { draftProjectId, projects } from './proxies/project';
import { sandboxes } from './proxies/sandbox';
import { ui } from './proxies/ui';

export { projects as $projects };
export { sandboxes as $sandboxes };
export { ui as $ui };

function createProxyGetter<S extends unknown[], T>(
  dependencies: S,
  getter: (...args: S) => T,
  message: string,
) {
  const proxied = proxy({
    _dependencies: dependencies,
    value() {
      return getter(...this._dependencies);
    },
    valueOrThrow() {
      const value = this.value();
      invariant(value, message);
      return value;
    },
    awaiter() {
      return awaiter({
        getter: () => this.value(),
        name: message,
      });
    },
  });

  return proxied as Omit<typeof proxied, '_dependencies'>;
}

export const $project = createProxyGetter(
  [projects],
  (projects) =>
    projects.currentProjectId && projects.value[projects.currentProjectId],
  '$project is not available',
);

export const $draftProject = createProxyGetter(
  [projects],
  (projects) => projects.value[draftProjectId],
  '$draftProject is not available',
);

export const $content = createProxyGetter(
  [$project],
  (project) => project.value()?.content,
  '$content is not available',
);

export const $sandbox = createProxyGetter(
  [$project],
  (project) => project.value()?.sandbox,
  '$sandbox is not available',
);

export const $cli = createProxyGetter(
  [$sandbox],
  (sandbox) => sandbox.value()?.cli,
  '$cli is not available',
);

export const $theme = createProxyGetter(
  [$project],
  (project) => project.value()?.theme,
  '$theme is not available',
);
