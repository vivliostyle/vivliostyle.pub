import { Link } from '@tanstack/react-router';
import { invariant } from 'outvariant';
import { useState } from 'react';
import { useSnapshot } from 'valtio';

import { Button } from '@v/ui/button';
import { Cloud, FilePlus, Loader2, Trash2 } from '@v/ui/icon';
import { $projects, $session } from '../../stores/accessors';
import {
  createCloudProject,
  deleteCloudProject,
} from '../../stores/actions/cloud-project';
import { deleteLocalProject } from '../../stores/actions/local-project';
import type { ProjectEntry, ProjectId } from '../../stores/proxies/project';
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

function DeleteProjectButton({
  ariaLabel,
  confirmMessage,
  onDelete,
}: {
  ariaLabel: string;
  confirmMessage: string;
  onDelete: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async (e: React.MouseEvent) => {
    // Nested inside the navigation Link; stop the click from opening the project.
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(confirmMessage)) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
    } catch {
      setError('Failed to delete project.');
      setDeleting(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClick}
        disabled={deleting}
        aria-label={ariaLabel}
      >
        {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
      </Button>
      {error && (
        <p className="text-xs text-destructive mt-1" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function LocalProjectListItem({ entry }: { entry: ProjectEntry }) {
  return (
    <li className="rounded-md border border-input hover:bg-accent transition-colors">
      <Link
        to="/projects/$projectId"
        params={{ projectId: entry.projectId }}
        className="block px-4 py-3 flex items-start gap-3"
      >
        <div className="flex-1 min-w-0">
          <div className="font-medium">{entry.title || 'Untitled project'}</div>
          {entry.author && (
            <div className="text-sm text-muted-foreground">{entry.author}</div>
          )}
          <div className="text-xs text-muted-foreground mt-1 break-all">
            {entry.projectId}
          </div>
        </div>
        <DeleteProjectButton
          ariaLabel="Delete local project"
          confirmMessage={`Delete local project "${entry.title || 'Untitled'}"? This cannot be undone.`}
          onDelete={() => deleteLocalProject(entry.projectId as ProjectId)}
        />
      </Link>
    </li>
  );
}

function CloudProjectListItem({ entry }: { entry: ProjectEntry }) {
  return (
    <li className="rounded-md border border-input hover:bg-accent transition-colors">
      <Link
        to="/projects/$projectId"
        params={{ projectId: entry.projectId }}
        className="block px-4 py-3 flex items-start gap-3"
      >
        <Cloud className="size-4 mt-1 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium">{entry.title || 'Untitled project'}</div>
          {entry.author && (
            <div className="text-sm text-muted-foreground">{entry.author}</div>
          )}
          <div className="text-xs text-muted-foreground mt-1 break-all">
            {entry.projectId}
          </div>
        </div>
        <DeleteProjectButton
          ariaLabel="Delete cloud project"
          confirmMessage={`Delete cloud project "${entry.title || 'Untitled'}"? This cannot be undone.`}
          onDelete={() => deleteCloudProject(entry.projectId)}
        />
      </Link>
    </li>
  );
}

function CreateCloudProjectButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      await createCloudProject({});
    } catch {
      setError('Failed to create cloud project.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-1">
      <Button
        type="button"
        variant="outline"
        onClick={onCreate}
        disabled={busy}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Cloud />}
        Create an empty cloud project
      </Button>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Content(_: StartPaneProperty) {
  const projectsSnap = useSnapshot($projects);
  const sessionSnap = useSnapshot($session);
  const entries = Object.values(projectsSnap.entries) as ProjectEntry[];
  const localEntries = entries.filter((e) => e.source === 'local');
  const remoteEntries = entries.filter((e) => e.source === 'remote');

  return (
    <div className="grid gap-8">
      <section className="grid gap-3">
        <h3 className="text-sm font-semibold text-muted-foreground">
          Local projects
        </h3>
        {localEntries.length > 0 ? (
          <ul className="grid gap-2">
            {localEntries.map((entry) => {
              invariant(entry.projectId, 'projectId is required');
              return (
                <LocalProjectListItem key={entry.projectId} entry={entry} />
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No local projects yet.
          </p>
        )}
        <Button asChild>
          <Link to="/new-project">
            <FilePlus />
            Create a new project
          </Link>
        </Button>
      </section>

      {sessionSnap.status === 'authenticated' && (
        <section className="grid gap-3">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Cloud projects
          </h3>
          {remoteEntries.length > 0 ? (
            <ul className="grid gap-2">
              {remoteEntries.map((entry) => (
                <CloudProjectListItem key={entry.projectId} entry={entry} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No cloud projects yet.
            </p>
          )}
          <CreateCloudProjectButton />
        </section>
      )}

      {sessionSnap.status !== 'authenticated' &&
        sessionSnap.status !== 'initial' && (
          <p className="text-xs text-muted-foreground">
            <Link to="/settings/account" className="hover:underline">
              Sign in
            </Link>{' '}
            to sync projects with the cloud.
          </p>
        )}
    </div>
  );
}
