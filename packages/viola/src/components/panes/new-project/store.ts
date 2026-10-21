import { createScope, molecule, use } from 'bunshi';
import { proxy } from 'valtio';

import { $draftProject } from '../../../stores/accessors';
import { resolveTemplateSource } from '../../../stores/actions/resolve-template-source';

export const NewProjectPaneScope = createScope(undefined);

export const TemplateStoreMolecule = molecule(() => {
  use(NewProjectPaneScope);

  const templateStoreProxy = proxy({
    selected: undefined as string | undefined,
    installTemplatePromise: undefined as Promise<void> | undefined,

    selectTemplate(value: string) {
      const project = $draftProject.valueOrThrow();
      this.selected = value;
      this.installTemplatePromise = (async () => {
        const sandbox = await project.sandboxPromise;
        const cli = await sandbox.cli.createRemotePromise();
        await cli.setupTemplate({
          title: 'Title',
          author: 'Author',
          language: 'en',
          template: await resolveTemplateSource({
            templateValue: value,
            project,
            cli,
          }),
          theme: false,
        });
      })();
      return this.installTemplatePromise;
    },
  });

  return { templateStoreProxy };
});
