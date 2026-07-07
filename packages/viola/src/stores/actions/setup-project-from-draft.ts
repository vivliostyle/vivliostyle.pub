import {
  DEFAULT_PROJECT_AUTHOR,
  DEFAULT_PROJECT_TITLE,
} from '@vivliostyle/cli/constants';
import type { BuildTask } from '@vivliostyle/cli/schema';
import { deepClone } from 'valtio/utils';

import { generateProjectId } from '../../libs/generate-id';
import { $draftProject, $projects, $session } from '../accessors';
import { Project, type ProjectEntry, type ProjectId } from '../proxies/project';
import { Sandbox } from '../proxies/sandbox';
import { discoverProjects } from './discover-projects';

export interface SetupProjectFromDraftResult {
  projectId: ProjectId;
  source: 'local' | 'remote';
}

export async function setupProjectFromDraft({
  templateValue,
}: {
  templateValue: string;
}): Promise<SetupProjectFromDraftResult> {
  const $$draftProject = $draftProject.valueOrThrow();
  const template =
    Sandbox.officialTemplates[
      templateValue as keyof typeof Sandbox.officialTemplates
    ];

  $projects.currentProjectId = null;

  const useCloud = $session.status === 'authenticated';

  let projectId: ProjectId;
  let sandbox: Sandbox;
  let source: 'local' | 'remote';

  if (useCloud) {
    const record = await $session.api.createProject({
      title: $$draftProject.bibliography.title || undefined,
      author: $$draftProject.bibliography.author || undefined,
      language: $$draftProject.bibliography.language || undefined,
    });
    projectId = record.id as ProjectId;
    source = 'remote';
    try {
      sandbox = await Sandbox.createNewRemoteSandbox({
        projectId,
        api: $session.api,
      });
    } catch (err) {
      // The remote record exists but we never produced a local handle for
      // it, so roll it back to avoid leaving the user with an orphaned
      // cloud project from a transient client failure.
      await $session.api.deleteProject(projectId).catch(() => {});
      throw err;
    }
    // Seeded eagerly so the start pane reflects the new project before the
    // template install (and the trailing `discoverProjects()`) finishes.
    const entry: ProjectEntry = {
      projectId,
      source: 'remote',
      title: record.title,
      author: record.author,
      updatedAt: record.updatedAt,
    };
    $projects.entries[projectId] = entry;
  } else {
    projectId = generateProjectId();
    source = 'local';
    sandbox = await Sandbox.createNewSandbox({ projectId });
    const entry: ProjectEntry = {
      projectId,
      source: 'local',
      title: $$draftProject.bibliography.title || undefined,
      author: $$draftProject.bibliography.author || undefined,
      updatedAt: Date.now(),
    };
    $projects.entries[projectId] = entry;
  }

  try {
    const cli = await sandbox.cli.createRemotePromise();
    const themePackageName =
      (await $$draftProject.theme.installPromise)?.packageName ??
      '@vivliostyle/theme-base';

    // Empty values would send `vivliostyle create` into its interactive
    // prompts, which never resolve inside the worker.
    await cli.setupTemplate({
      title: $$draftProject.bibliography.title || DEFAULT_PROJECT_TITLE,
      author: $$draftProject.bibliography.author || DEFAULT_PROJECT_AUTHOR,
      language: $$draftProject.bibliography.language || 'en',
      template: template.source,
      theme: themePackageName,
    });
    await sandbox.saveMemoryToFileSystem();
    await sandbox.initializeProjectFiles({
      themePackageName,
      entry: deepClone(sandbox.vivliostyleConfig.entry) as BuildTask['entry'],
    });
    const project = Project.createProjectFromSandbox({
      projectId,
      sandboxPromise: Promise.resolve(sandbox),
    });
    await Promise.all([
      project.setupPromise,
      project.theme.install(themePackageName),
    ]);
  } catch (err) {
    if (useCloud) {
      await $session.api.deleteProject(projectId).catch(() => {});
      delete $projects.entries[projectId];
    }
    throw err;
  }

  $projects.currentProjectId = projectId;
  await discoverProjects();

  return { projectId, source };
}
