import { invariant } from 'outvariant';

import type { RemoteCli } from '../proxies/cli';
import type { Project } from '../proxies/project';
import { Sandbox } from '../proxies/sandbox';

/** Template values of the new project pane that refer to the theme's templates. */
export const THEME_TEMPLATE_PREFIX = 'theme:';
const THEME_TEMPLATE_DIR = '/tmp/theme-template';

/**
 * Resolves a template choice to a source for `vivliostyle create`. A template
 * inside the theme package is copied into the worker's file system first,
 * since the CLI in the worker cannot read the package by itself.
 */
export async function resolveTemplateSource({
  templateValue,
  project,
  cli,
}: {
  templateValue: string;
  project: Project;
  cli: RemoteCli;
}): Promise<string> {
  if (!templateValue.startsWith(THEME_TEMPLATE_PREFIX)) {
    const template =
      Sandbox.officialTemplates[
        templateValue as keyof typeof Sandbox.officialTemplates
      ];
    invariant(template, 'Template not found: %s', templateValue);
    return template.source;
  }
  const id = templateValue.slice(THEME_TEMPLATE_PREFIX.length);
  const installed = await project.theme.installPromise;
  const template = installed?.templates.find((t) => t.id === id);
  invariant(template, 'Theme template not found: %s', id);
  const files = await project.theme.loadTemplateFiles(template);
  if (!files) {
    return template.source;
  }
  await cli.rm(THEME_TEMPLATE_DIR, { recursive: true, force: true });
  await cli.fromJSON(files, THEME_TEMPLATE_DIR);
  return THEME_TEMPLATE_DIR;
}
