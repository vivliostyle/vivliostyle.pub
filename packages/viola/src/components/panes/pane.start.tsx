import { Link } from '@tanstack/react-router';
import { invariant } from 'outvariant';
import { useSnapshot } from 'valtio';

import { Button } from '@v/ui/button';
import { FilePlus } from '@v/ui/icon';
import { $projects } from '../../stores/accessors';
import type { ProjectId } from '../../stores/proxies/project';
import { createPane, PaneContainer, ScrollOverflow } from './util';

type StartPaneProperty = object;

declare global {
  interface PanePropertyMap {
    start: StartPaneProperty;
  }
}

export const Pane = createPane<StartPaneProperty>({
  title: () => 'Open project',
  content: (props) => (
    <ScrollOverflow>
      <PaneContainer>
        <Content {...props} />
      </PaneContainer>
    </ScrollOverflow>
  ),
  hideTitle: true,
});

function ProjectListItem({ projectId }: { projectId: ProjectId }) {
  const projectsSnap = useSnapshot($projects);
  const entry = projectsSnap.entries[projectId];

  return (
    <li>
      <Link
        to="/projects/$projectId"
        params={{ projectId }}
        className="block w-full text-left rounded-md border border-input px-4 py-3 hover:bg-accent transition-colors"
      >
        <div className="font-medium">{entry?.title || 'Untitled project'}</div>
        {entry?.author && (
          <div className="text-sm text-muted-foreground">{entry.author}</div>
        )}
        <div className="text-xs text-muted-foreground mt-1 break-all">
          {projectId}
        </div>
      </Link>
    </li>
  );
}

function Content(_: StartPaneProperty) {
  const projectsSnap = useSnapshot($projects);
  const projectIds = Object.keys(projectsSnap.entries) as ProjectId[];

  return (
    <div className="grid gap-6">
      {projectIds.length > 0 ? (
        <ul className="grid gap-2">
          {projectIds.map((projectId) => {
            invariant(projectId, 'projectId is required');
            return <ProjectListItem key={projectId} projectId={projectId} />;
          })}
        </ul>
      ) : (
        <p className="text-2xl py-8">Start writing your book.</p>
      )}

      <Button asChild>
        <Link to="/new-project">
          <FilePlus />
          Create a new project
        </Link>
      </Button>
    </div>
  );
}
