import type { BuildTask } from '@vivliostyle/cli/schema';
import { deepClone } from 'valtio/utils';

import {
  buildTreeFromRegistry,
  bundleCss,
  fetchPackageContent,
} from '@v/theme-registry';
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
  const project = Project.createProjectFromSandbox({
    projectId,
    sandboxPromise: Promise.resolve(sandbox),
  });

  const { packageName } = $$draftProject.theme;
  const tree = await buildTreeFromRegistry(packageName);
  await fetchPackageContent(tree);

  const { code } = await bundleCss(`@import "${packageName}"`);
  project.theme.bundledCss = new TextDecoder().decode(code);
  project.theme.packageName = packageName;

  $projects.currentProjectId = projectId;
}
