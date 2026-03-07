import { Link } from '@tanstack/react-router';

import { Button } from '@v/ui/button';
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
      <p className="text-2xl py-8">Start writing your book.</p>
      <Button asChild>
        <Link to="/new-project">Create a new project</Link>
      </Button>
    </div>
  );
}
