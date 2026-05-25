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
import type { ProjectEntry } from '../../stores/proxies/project';
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

function LocalProjectListItem({ entry }: { entry: ProjectEntry }) {
  return (
    <li>
      <Link
        to="/projects/$projectId"
        params={{ projectId: entry.projectId }}
        className="block w-full text-left rounded-md border border-input px-4 py-3 hover:bg-accent transition-colors"
      >
        <div className="font-medium">{entry.title || 'Untitled project'}</div>
        {entry.author && (
          <div className="text-sm text-muted-foreground">{entry.author}</div>
        )}
        <div className="text-xs text-muted-foreground mt-1 break-all">
          {entry.projectId}
        </div>
      </Link>
    </li>
  );
}

function CloudProjectListItem({ entry }: { entry: ProjectEntry }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDelete = async () => {
    if (
      !window.confirm(
        `Delete cloud project "${entry.title || 'Untitled'}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await deleteCloudProject(entry.projectId);
    } catch {
      setError('Failed to delete project.');
      setDeleting(false);
    }
  };

  return (
    <li className="rounded-md border border-input px-4 py-3 flex items-start gap-3">
      <Cloud className="size-4 mt-1 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-medium">{entry.title || 'Untitled project'}</div>
        {entry.author && (
          <div className="text-sm text-muted-foreground">{entry.author}</div>
        )}
        <div className="text-xs text-muted-foreground mt-1 break-all">
          {entry.projectId}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          File sync for cloud projects is not yet available.
        </p>
        {error && (
          <p className="text-xs text-destructive mt-1" role="alert">
            {error}
          </p>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onDelete}
        disabled={deleting}
        aria-label="Delete cloud project"
      >
        {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
      </Button>
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
        sessionSnap.status !== 'initializing' && (
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
