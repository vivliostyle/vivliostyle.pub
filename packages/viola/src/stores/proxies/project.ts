import { LANGUAGES } from '@vivliostyle/cli/constants';
import { join } from 'pathe';
import { proxy, ref, subscribe } from 'valtio';
import { deepClone } from 'valtio/utils';

import {
  type EditorSyncContext,
  getEditorSummary,
  setupEditor,
} from '../../libs/editor';
import { generateId } from '../../libs/generate-id';
import { SandboxFile } from '../../libs/sandbox/file';
import { officialThemes } from '../catalog';
import { Content, type ContentId } from './content';
import { Sandbox } from './sandbox';
import { session } from './session';
import { Theme } from './theme';

function detectBrowserLanguage(): string {
  const lang = navigator.language;
  if (lang in LANGUAGES) return lang;
  const base = lang.split('-')[0];
  if (base in LANGUAGES) return base;
  return 'en';
}

declare const projectIdBrand: unique symbol;
export type ProjectId = string & { [projectIdBrand]: never };

export const draftProjectId: ProjectId = 'draft' as ProjectId;

const initialBibliographyState = {
  title: '',
  author: '',
  language: undefined as string | undefined,
};

const initialTocState = {
  enabled: false,
  title: '',
  sectionDepth: 0,
};

export type ProjectSource = 'local' | 'remote';

export interface ProjectEntry {
  projectId: ProjectId;
  source: ProjectSource;
  title?: string;
  author?: string;
  updatedAt?: number;
}

export const projects = proxy({
  value: {} as Record<ProjectId, Project>,
  entries: {} as Record<ProjectId, ProjectEntry>,
  currentProjectId: null as ProjectId | null,
});

export class Project {
  static createProjectFromSandbox({
    projectId,
    sandboxPromise,
  }: {
    projectId: ProjectId;
    sandboxPromise: Promise<Sandbox>;
  }) {
    return Project.register(new Project({ projectId, sandboxPromise }));
  }

  // Outlives the draft's removal from `projects.value`, so the next draft can
  // wait until this one has finished tearing down.
  protected static draft: Project | undefined;

  static createDraftProject() {
    const previousDisposal = Project.disposeDraftProject();
    // Both drafts share one OPFS directory, so the old draft's pending writes
    // must land before the new sandbox wipes it.
    const sandboxPromise = (async () => {
      await previousDisposal;
      return Sandbox.createNewSandbox({ projectId: draftProjectId });
    })();
    Project.draft = Project.register(
      new Project({ projectId: draftProjectId, sandboxPromise }),
    );
    return Project.draft;
  }

  static disposeDraftProject() {
    return Project.draft?.dispose();
  }

  protected static register(instance: Project) {
    const project = proxy(instance);
    project.unsubscribe = project.subscribeConfigSync();
    projects.value[project.projectId] = project;
    return project;
  }

  projectId: ProjectId;
  content = Content.create(this);
  theme = Theme.create(this);
  sandbox: Sandbox | undefined;
  sandboxPromise: Promise<Sandbox>;
  setupPromise: Promise<void>;
  bibliography = deepClone(initialBibliographyState);
  toc = deepClone(initialTocState);

  protected unsubscribe = () => {};
  protected disposePromise: Promise<void> | undefined;

  protected constructor({
    projectId,
    sandboxPromise,
  }: { projectId: ProjectId; sandboxPromise: Promise<Sandbox> }) {
    this.projectId = projectId;
    this.sandboxPromise = sandboxPromise;
    this.setupPromise = (async () => {
      const sandbox = await sandboxPromise;
      this.sandbox = sandbox;
      await this.restoreProjectFromFileSystem();
      this.bibliography.title = sandbox.vivliostyleConfig.title || '';
      this.bibliography.author = sandbox.vivliostyleConfig.author || '';
      this.bibliography.language =
        sandbox.vivliostyleConfig.language ?? detectBrowserLanguage();
      this.toc.enabled = Boolean(sandbox.vivliostyleConfig.toc);
      if (typeof sandbox.vivliostyleConfig.toc === 'object') {
        this.toc.title = sandbox.vivliostyleConfig.toc.title || '';
        this.toc.sectionDepth = sandbox.vivliostyleConfig.toc.sectionDepth || 0;
      }
    })();
  }

  protected async restoreProjectFromFileSystem() {
    const sandbox = await this.sandboxPromise;
    const entryContext = sandbox.vivliostyleConfig.entryContext || '';
    const entryFiles = [sandbox.vivliostyleConfig.entry]
      .flat()
      .flatMap((it) => {
        const entry = typeof it === 'string' ? { path: it } : it;
        if (!entry.path) {
          return [];
        }
        const filename = join(entryContext, entry.path);
        const format = entry.path.endsWith('.md')
          ? ('markdown' as const)
          : undefined;
        const content = sandbox.files[filename];
        if (!content) {
          return [];
        }
        return { filename, format, content };
      });

    const sync = this.resolveEditorSyncContext();
    const readingOrder: ContentId[] = [];
    for (const { filename, format, content } of entryFiles) {
      if (!format) {
        // TODO: handle other formats
        continue;
      }
      const contentId = generateId<ContentId>();
      const editor = await this.setupContentEditor({
        contentId,
        filename,
        entryContext,
        initialFile: content,
        sync,
      });

      readingOrder.push(contentId);
      this.content.files.set(contentId, {
        format,
        filename,
        summary: getEditorSummary(editor),
        editor: ref(editor),
      });
    }
    this.content.readingOrder = readingOrder;
    const styleCss = sandbox.files['style.css'];
    if (styleCss) {
      this.theme.customCss = await styleCss.text();
    } else {
      this.theme.customCss = '';
      sandbox.files['style.css'] = ref(new SandboxFile('text/css', ''));
    }
    if (
      Array.isArray(sandbox.vivliostyleConfig.theme) &&
      sandbox.vivliostyleConfig.theme[0] in officialThemes
    ) {
      this.theme.install(sandbox.vivliostyleConfig.theme[0]);
    }
  }

  async setupContentEditor({
    contentId,
    filename,
    entryContext,
    initialFile,
    sync,
  }: {
    contentId: ContentId;
    filename: string;
    entryContext: string;
    initialFile?: SandboxFile;
    sync?: EditorSyncContext;
  }) {
    const sandbox = await this.sandboxPromise;
    return setupEditor({
      projectId: this.projectId,
      filename,
      entryContext,
      initialFile,
      sync,
      onSave: (content) => this.saveContentFile(contentId, content),
      writeFile: (path, file) => {
        sandbox.files[path] = ref(file);
      },
    });
  }

  saveContentFile(
    contentId: ContentId,
    { markdown, summary }: { markdown: string; summary: string },
  ) {
    // Looked up on every save: the file may have been renamed or removed.
    const file = this.content.files.get(contentId);
    if (!file || !this.sandbox) {
      return;
    }
    file.summary = summary;
    this.sandbox.files[file.filename] = ref(
      new SandboxFile('text/markdown', markdown),
    );
  }

  dispose(): Promise<void> {
    this.disposePromise ??= this.teardown();
    return this.disposePromise;
  }

  protected async teardown() {
    if (projects.value[this.projectId] === this) {
      delete projects.value[this.projectId];
    }
    this.unsubscribe();
    // Setup may still be creating editors; let it settle so none escape.
    await this.setupPromise.catch(() => {});
    for (const file of this.content.files.values()) {
      file.editor.destroy();
    }
    const sandbox = await this.sandboxPromise.catch(() => undefined);
    await sandbox?.dispose();
  }

  protected subscribeConfigSync() {
    const unsubscribes = [
      subscribe(this.bibliography, () => this.handleBibliographyUpdate()),
      subscribe(this.toc, () => this.handleTocUpdate()),
      subscribe(this.theme, () => this.handleThemeUpdate()),
    ];
    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  }

  protected resolveEditorSyncContext(): EditorSyncContext | undefined {
    if (!__CLOUD_ENABLED__) {
      return undefined;
    }
    if (projects.entries[this.projectId]?.source !== 'remote') {
      return undefined;
    }
    return { api: session.api, auth: session.auth };
  }

  protected async handleBibliographyUpdate() {
    const sandbox = await this.sandboxPromise;
    sandbox.updateVivliostyleConfig((config) => {
      config.title = this.bibliography.title || undefined;
      config.author = this.bibliography.author || undefined;
      config.language = this.bibliography.language || undefined;
    });
  }

  protected async handleTocUpdate() {
    const sandbox = await this.sandboxPromise;
    sandbox.updateVivliostyleConfig((config) => {
      config.toc = this.toc.enabled
        ? {
            title: this.toc.title || undefined,
            sectionDepth: this.toc.sectionDepth || undefined,
          }
        : undefined;
    });
  }

  protected async handleThemeUpdate() {
    const sandbox = await this.sandboxPromise;
    const installedTheme = await this.theme.installPromise;
    if (!installedTheme?.packageName) {
      return;
    }
    sandbox.updateVivliostyleConfig((config) => {
      config.theme = [installedTheme.packageName, './style.css'];
    });
  }
}
