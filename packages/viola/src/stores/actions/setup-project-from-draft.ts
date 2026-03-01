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

  const root = await navigator.storage.getDirectory();
  const directoryHandle = await root.getDirectoryHandle(projectId, {
    create: true,
  });
  const sandbox = Sandbox.create({ projectId, directoryHandle });
  const cli = await sandbox.cli.createRemotePromise();

  await cli.setupTemplate({
    title: $$draftProject.bibliography.title,
    author: $$draftProject.bibliography.author,
    language: $$draftProject.bibliography.language,
    template: template.source,
    theme: $$draftProject.theme.packageName,
  });
  await sandbox.saveMemoryToFileSystem();
  await sandbox.initializeProjectFiles({
    themePackageName: $$draftProject.theme.packageName,
    entry: deepClone(sandbox.vivliostyleConfig.entry) as BuildTask['entry'],
  });
  Project.createProjectFromSandbox({ projectId, sandbox });
  $projects.currentProjectId = projectId;
}
