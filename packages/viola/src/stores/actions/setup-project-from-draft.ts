import type { BuildTask } from '@vivliostyle/cli/schema';
import { deepClone } from 'valtio/utils';

import { $draftProject, $projects } from '../accessors';
import { Project, type ProjectId } from '../proxies/project';
import { Sandbox } from '../proxies/sandbox';

export async function setupProjectFromDraft({
  projectId,
  templateValue,
}: {
  projectId: ProjectId;
  templateValue: string;
}) {
  const $$draftProject = $draftProject.valueOrThrow();
  const template =
    Sandbox.officialTemplates[
      templateValue as keyof typeof Sandbox.officialTemplates
    ];

  $projects.currentProjectId = null;
  const sandbox = await Sandbox.createNewSandbox({ projectId });
  const cli = await sandbox.cli.createRemotePromise();
  const themePackageName =
    (await $$draftProject.theme.installPromise)?.packageName ??
    '@vivliostyle/theme-base';

  await cli.setupTemplate({
    title: $$draftProject.bibliography.title,
    author: $$draftProject.bibliography.author,
    language: $$draftProject.bibliography.language,
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

  $projects.currentProjectId = projectId;
}
