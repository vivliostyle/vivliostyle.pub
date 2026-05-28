import { Link } from '@tanstack/react-router';
import { invariant } from 'outvariant';
import { useState } from 'react';
import { useSnapshot } from 'valtio';

import { Button } from '@v/ui/button';
import { Cloud, FilePlus, Loader2, Trash2 } from '@v/ui/icon';
import { m } from '../../generated/paraglide/messages';
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
  title: () => m.start_pane_title(),
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

  const onClick = async () => {
    if (!window.confirm(confirmMessage)) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
    } catch {
      setError(m.start_delete_error());
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col items-end">
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
    </div>
  );
}

// The delete button is a sibling of the Link rather than a child because
// HTML5 forbids interactive descendants of `<a>` (button-in-anchor confuses
// assistive tech and is re-parsed unpredictably by some browsers).
function LocalProjectListItem({ entry }: { entry: ProjectEntry }) {
  return (
    <li className="rounded-md border border-input hover:bg-accent transition-colors flex items-start gap-3 pr-3">
      <Link
        to="/projects/$projectId"
        params={{ projectId: entry.projectId }}
        className="flex-1 min-w-0 px-4 py-3"
      >
        <div className="font-medium">
          {entry.title || m.start_untitled_project()}
        </div>
        {entry.author && (
          <div className="text-sm text-muted-foreground">{entry.author}</div>
        )}
        <div className="text-xs text-muted-foreground mt-1 break-all">
          {entry.projectId}
        </div>
      </Link>
      <div className="py-3">
        <DeleteProjectButton
          ariaLabel={m.start_delete_local_aria()}
          confirmMessage={m.start_delete_local_confirm({
            title: entry.title || m.common_untitled(),
          })}
          onDelete={() => deleteLocalProject(entry.projectId as ProjectId)}
        />
      </div>
    </li>
  );
}

function CloudProjectListItem({ entry }: { entry: ProjectEntry }) {
  return (
    <li className="rounded-md border border-input hover:bg-accent transition-colors flex items-start gap-3 pr-3">
      <Link
        to="/projects/$projectId"
        params={{ projectId: entry.projectId }}
        className="flex-1 min-w-0 px-4 py-3 flex items-start gap-3"
      >
        <Cloud className="size-4 mt-1 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium">
            {entry.title || m.start_untitled_project()}
          </div>
          {entry.author && (
            <div className="text-sm text-muted-foreground">{entry.author}</div>
          )}
          <div className="text-xs text-muted-foreground mt-1 break-all">
            {entry.projectId}
          </div>
        </div>
      </Link>
      <div className="py-3">
        <DeleteProjectButton
          ariaLabel={m.start_delete_cloud_aria()}
          confirmMessage={m.start_delete_cloud_confirm({
            title: entry.title || m.common_untitled(),
          })}
          onDelete={() => deleteCloudProject(entry.projectId)}
        />
      </div>
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
      setError(m.start_create_cloud_error());
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
        {m.start_create_cloud_button()}
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
          {m.start_local_projects_heading()}
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
            {m.start_no_local_projects()}
          </p>
        )}
        <Button asChild>
          <Link to="/new-project">
            <FilePlus />
            {m.start_create_new_project()}
          </Link>
        </Button>
      </section>

      {__CLOUD_ENABLED__ && sessionSnap.status === 'authenticated' && (
        <section className="grid gap-3">
          <h3 className="text-sm font-semibold text-muted-foreground">
            {m.start_cloud_projects_heading()}
          </h3>
          {remoteEntries.length > 0 ? (
            <ul className="grid gap-2">
              {remoteEntries.map((entry) => (
                <CloudProjectListItem key={entry.projectId} entry={entry} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {m.start_no_cloud_projects()}
            </p>
          )}
          <CreateCloudProjectButton />
        </section>
      )}

      {__CLOUD_ENABLED__ &&
        sessionSnap.status !== 'authenticated' &&
        sessionSnap.status !== 'initial' && (
          <p className="text-xs text-muted-foreground">
            <Link to="/settings/account" className="hover:underline">
              {m.start_sign_in_link()}
            </Link>
            {m.start_sign_in_to_sync_suffix()}
          </p>
        )}
    </div>
  );
}
