import { ScopeProvider, useMolecule } from 'bunshi/react';
import { useId } from 'react';
import { useSnapshot } from 'valtio';

import { m } from '../../generated/paraglide/messages';
import { ProjectDetailForm } from './new-project/project-detail-form';
import {
  NewProjectPaneScope,
  TemplateStoreMolecule,
} from './new-project/store';
import { TemplateSelectForm } from './new-project/template-select-form';
import { createPane, PaneContainer, ScrollOverflow } from './util';

type NewProjectPaneProps = object;

declare global {
  interface PanePropertyMap {
    'new-project': NewProjectPaneProps;
  }
}

export const Pane = createPane<NewProjectPaneProps>({
  title: () => m.new_project_pane_title(),
  content: (props) => (
    <ScrollOverflow>
      <PaneContainer>
        <ScopeProvider scope={NewProjectPaneScope} value={useId()}>
          <Content {...props} />
        </ScopeProvider>
      </PaneContainer>
    </ScrollOverflow>
  ),
});

function Content(_: NewProjectPaneProps) {
  const { templateStoreProxy } = useMolecule(TemplateStoreMolecule);
  const snap = useSnapshot(templateStoreProxy);

  return (
    <div className="grid gap-8">
      <TemplateSelectForm />
      {snap.selected && <ProjectDetailForm />}
    </div>
  );
}
