import { Link, useNavigate } from '@tanstack/react-router';
import { invariant } from 'outvariant';
import { useTransition } from 'react';
import { useSnapshot } from 'valtio';

import { Button } from '@v/ui/button';
import { FilePlus } from '@v/ui/icon';
import { $project, $projects } from '../../stores/accessors';
import { openProject } from '../../stores/actions/open-project';
import type { ProjectId } from '../../stores/proxies/project';
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

function ProjectListItem({ projectId }: { projectId: ProjectId }) {
  const projectsSnap = useSnapshot($projects);
  const entry = projectsSnap.entries[projectId];
  const [isPending, startTransition] = useTransition();
  const navigate = useNavigate();

  const handleOpen = () => {
    startTransition(async () => {
      await openProject(projectId);
      const project = $project.valueOrThrow();
      const contentId = project.content.readingOrder[0];
      const file = contentId ? project.content.files.get(contentId) : undefined;
      if (file) {
        navigate({
          to: '/edit/$',
          params: { _splat: file.filename },
          replace: true,
        });
      } else {
        navigate({ to: '/bibliography', replace: true });
      }
    });
  };

  return (
    <li>
      <button
        type="button"
        onClick={handleOpen}
        disabled={isPending}
        className="w-full text-left rounded-md border border-input px-4 py-3 hover:bg-accent transition-colors disabled:opacity-50"
      >
        <div className="font-medium">{entry?.title || 'Untitled project'}</div>
        {entry?.author && (
          <div className="text-sm text-muted-foreground">{entry.author}</div>
        )}
        <div className="text-xs text-muted-foreground mt-1 break-all">
          {projectId}
        </div>
      </button>
    </li>
  );
}

function Content(_: StartPaneProperty) {
  const projectsSnap = useSnapshot($projects);
  const projectIds = Object.keys(projectsSnap.entries) as ProjectId[];

  return (
    <div className="grid gap-6">
      {projectIds.length > 0 ? (
        <>
          <p className="text-2xl pt-4">Open a project</p>
          <ul className="grid gap-2">
            {projectIds.map((projectId) => {
              invariant(projectId, 'projectId is required');
              return <ProjectListItem key={projectId} projectId={projectId} />;
            })}
          </ul>
        </>
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
