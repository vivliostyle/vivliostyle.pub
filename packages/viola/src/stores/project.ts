import { proxy, ref, subscribe } from 'valtio';
import { deepClone } from 'valtio/utils';
import { setupProject } from './actions/setup-project';
import { $sandbox } from './sandbox';

const initialBibliographyState = {
  title: '',
  author: '',
};

const initialTocState = {
  enabled: false,
  title: '',
  sectionDepth: 0,
};

export const $project = proxy({
  setupPromise: ref(
    setupProject('alpha-v1').then(() => {
      $project.bibliography.title = $sandbox.vivliostyleConfig.title || '';
      $project.bibliography.author = $sandbox.vivliostyleConfig.author || '';

      $project.toc.enabled = Boolean($sandbox.vivliostyleConfig.toc);
      if (typeof $sandbox.vivliostyleConfig.toc === 'object') {
        $project.toc.title = $sandbox.vivliostyleConfig.toc.title || '';
        $project.toc.sectionDepth =
          $sandbox.vivliostyleConfig.toc.sectionDepth || 0;
      }
    }),
  ),
  bibliography: deepClone(initialBibliographyState),
  toc: deepClone(initialTocState),
});

subscribe($project.bibliography, () => {
  $sandbox.updateVivliostyleConfig((config) => {
    config.title = $project.bibliography.title || undefined;
    config.author = $project.bibliography.author || undefined;
  });
});

subscribe($project.toc, () => {
  $sandbox.updateVivliostyleConfig((config) => {
    config.toc = $project.toc.enabled
      ? {
          title: $project.toc.title || undefined,
          sectionDepth: $project.toc.sectionDepth || undefined,
        }
      : undefined;
  });
});
