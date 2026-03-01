import { ScopeProvider } from 'bunshi/react';
import { useId } from 'react';

import { Button } from '@v/ui/button';
import { ProjectDetailForm } from './new-project/project-detail-form';
import { NewProjectPaneScope } from './new-project/store';
import { TemplateSelectForm } from './new-project/template-select-form';
import { createPane, PaneContainer, ScrollOverflow } from './util';

type NewProjectPaneProps = object;

declare global {
  interface PanePropertyMap {
    'new-project': NewProjectPaneProps;
  }
}

export const Pane = createPane<NewProjectPaneProps>({
  title: () => 'Create New Project',
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
  return (
    <div className="grid gap-8">
      <TemplateSelectForm />
      <ProjectDetailForm>
        <Button type="submit">Create Project</Button>
      </ProjectDetailForm>
    </div>
  );
}
