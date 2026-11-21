import { afterEach, describe, expect, it } from 'vitest';

import { $content, $projects } from '../stores/accessors';
import type { Project, ProjectId } from '../stores/proxies/project';

const projectId = 'awaitedproject' as ProjectId;

describe('accessor awaiter', () => {
  afterEach(() => {
    $projects.currentProjectId = null;
    delete $projects.value[projectId];
  });

  // `$content` depends on `$project`, which depends on `projects`: the change
  // has to travel up two levels of `_dependencies` to wake the awaiter.
  it('resolves once a change in a root proxy makes the value available', async () => {
    const promise = $content.awaiter();

    $projects.value[projectId] = {
      projectId,
      content: { readingOrder: [] },
    } as unknown as Project;
    $projects.currentProjectId = projectId;

    await expect(promise).resolves.toMatchObject({ readingOrder: [] });
  });

  it('rejects after the timeout the caller asks for', async () => {
    await expect($content.awaiter({ timeout: 10 })).rejects.toThrowError(
      'Awaiter timeout: $content is not available',
    );
  });
});
