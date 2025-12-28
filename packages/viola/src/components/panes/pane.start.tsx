import { Link } from '@tanstack/react-router';

import { createPane, PaneContainer, ScrollOverflow } from './util';

type StartPaneProperty = object;

declare global {
  interface PanePropertyMap {
    start: StartPaneProperty;
  }
}

export const Pane = createPane<StartPaneProperty>({
  title: () => 'Start',
  content: (props) => (
    <ScrollOverflow>
      <PaneContainer>
        <Content {...props} />
      </PaneContainer>
    </ScrollOverflow>
  ),
  hideTitle: true,
});

function Content(_: StartPaneProperty) {
  return (
    <div className="grid gap-4">
      <p>Start writing your book.</p>
      <Link to="/new-project">Create a new project</Link>
    </div>
  );
}
