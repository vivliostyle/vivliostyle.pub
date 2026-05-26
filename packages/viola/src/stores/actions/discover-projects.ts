import { OPFSStorageProvider } from '@v/storage-providers';
import { $projects, $session } from '../accessors';
import {
  draftProjectId,
  type ProjectEntry,
  type ProjectId,
} from '../proxies/project';

interface MinimalVivliostyleConfig {
  title?: string;
  author?: string;
}

async function readLocalEntry(
  root: OPFSStorageProvider,
  projectId: ProjectId,
): Promise<ProjectEntry | null> {
  const configPath = `${projectId}/vivliostyle.config.json`;
  let bytes: Uint8Array;
  try {
    bytes = await root.read(configPath);
  } catch {
    return null;
  }
  const stat = await root.stat(configPath);
  let parsed: MinimalVivliostyleConfig = {};
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    // keep parsed as empty object so the entry still surfaces.
  }
  return {
    projectId,
    source: 'local',
    title: parsed.title,
    author: parsed.author,
    updatedAt: stat?.mtimeMs,
  };
}

async function listLocalProjects(): Promise<ProjectEntry[]> {
  const root = await OPFSStorageProvider.open();
  const dirs = await root.list('');
  const entries = await Promise.all(
    dirs
      .filter(
        (entry) => entry.kind === 'directory' && entry.path !== draftProjectId,
      )
      .map((entry) => readLocalEntry(root, entry.path as ProjectId)),
  );
  return entries.filter((e): e is ProjectEntry => e !== null);
}

async function listRemoteProjects(): Promise<ProjectEntry[]> {
  if (!__CLOUD_ENABLED__ || $session.status !== 'authenticated') {
    return [];
  }
  try {
    const records = await $session.api.listProjects();
    return records.map((r) => ({
      projectId: r.id as ProjectId,
      source: 'remote' as const,
      title: r.title,
      author: r.author,
      updatedAt: r.updatedAt,
    }));
  } catch {
    // Remote unreachable: keep local entries only.
    return [];
  }
}

export async function discoverProjects(): Promise<void> {
  const [local, remote] = await Promise.all([
    listLocalProjects(),
    listRemoteProjects(),
  ]);

  const next: Record<ProjectId, ProjectEntry> = {};
  for (const entry of [...local, ...remote]) {
    next[entry.projectId] = entry;
  }

  for (const key in $projects.entries) {
    if (!(key in next)) {
      delete $projects.entries[key as ProjectId];
    }
  }
  for (const projectId in next) {
    $projects.entries[projectId as ProjectId] = next[projectId as ProjectId];
  }
}
