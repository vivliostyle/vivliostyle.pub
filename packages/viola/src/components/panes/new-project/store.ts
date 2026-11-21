import { createScope, molecule, use } from 'bunshi';
import { invariant } from 'outvariant';
import { proxy } from 'valtio';

import { $draftProject } from '../../../stores/accessors';
import {
  type OfficialTemplateId,
  officialTemplates,
} from '../../../stores/catalog';

export const NewProjectPaneScope = createScope(undefined);

export const TemplateStoreMolecule = molecule(() => {
  use(NewProjectPaneScope);

  const templateStoreProxy = proxy({
    selected: undefined as string | undefined,
    installTemplatePromise: undefined as Promise<void> | undefined,

    selectTemplate(value: string) {
      const project = $draftProject.valueOrThrow();
      const template = officialTemplates[value as OfficialTemplateId];
      invariant(template, 'Template not found: %s', value);
      this.selected = value;
      this.installTemplatePromise = (async () => {
        const sandbox = await project.sandboxPromise;
        const cli = await sandbox.cli.createRemotePromise();
        await cli.setupTemplate({
          title: 'Title',
          author: 'Author',
          language: 'en',
          template: template.source,
          theme: false,
        });
      })().catch((error: unknown) => {
        // Leaving the pane discards the draft, which rejects the pending setup.
        if ($draftProject.value() === project) {
          throw error;
        }
      });
      return this.installTemplatePromise;
    },
  });

  return { templateStoreProxy };
});
