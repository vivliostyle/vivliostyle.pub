import { LANGUAGES } from '@vivliostyle/cli/constants';
import * as Comlink from 'comlink';
import { join, relative } from 'pathe';
import { proxy, ref, subscribe } from 'valtio';
import { deepClone } from 'valtio/utils';

import { setupEditor } from '../../libs/editor';
import { generateId } from '../../libs/generate-id';
import { Content, type ContentId } from './content';
import { Sandbox, SandboxFile } from './sandbox';
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
    const project = proxy(
      new Project({
        projectId,
        sandboxPromise,
      }),
    );
    subscribe(project.bibliography, () => project.handleBibliographyUpdate());
    subscribe(project.toc, () => project.handleTocUpdate());
    subscribe(project.theme, () => project.handleThemeUpdate());

    projects.value[projectId] = project;
    return project;
  }

  protected static createNewProject({ projectId }: { projectId: ProjectId }) {
    const sandboxPromise = Sandbox.createNewSandbox({ projectId });
    const project = proxy(new Project({ projectId, sandboxPromise }));
    subscribe(project.bibliography, () => project.handleBibliographyUpdate());
    subscribe(project.toc, () => project.handleTocUpdate());
    subscribe(project.theme, () => project.handleThemeUpdate());

    projects.value[projectId] = project;
    return project;
  }

  static createDraftProject() {
    return Project.createNewProject({ projectId: draftProjectId });
  }

  projectId: ProjectId;
  content = Content.create(this);
  theme = Theme.create(this);
  sandbox: Sandbox | undefined;
  sandboxPromise: Promise<Sandbox>;
  setupPromise: Promise<void>;
  bibliography = deepClone(initialBibliographyState);
  toc = deepClone(initialTocState);

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

    const readingOrder: ContentId[] = [];
    for (const { filename, format, content } of entryFiles) {
      if (!format) {
        // TODO: handle other formats
        continue;
      }
      const contentId = generateId<ContentId>();
      const editor = await setupEditor({
        projectId: this.projectId,
        contentId,
        filename,
        entryContext,
        initialFile: content,
      });
      const summary =
        editor
          .getText({ blockSeparator: '\n' })
          .split('\n')
          .find((s) => s.trim())
          ?.trim() || '';

      readingOrder.push(contentId);
      this.content.files.set(contentId, {
        format,
        filename,
        summary,
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
      sandbox.vivliostyleConfig.theme[0] in Theme.officialThemes
    ) {
      this.theme.install(sandbox.vivliostyleConfig.theme[0]);
    }
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

export interface ProjectChannel {
  serve: (url: string, init: RequestInit) => Promise<[BodyInit, ResponseInit]>;
}

const channel = new BroadcastChannel('host:project');
Comlink.expose(
  {
    async serve(url: string, _init: RequestInit) {
      const { pathname } = new URL(url);
      const project =
        projects.currentProjectId && projects.value[projects.currentProjectId];
      if (!project) {
        return ['', { status: 404 }];
      }
      const sandbox = await project.sandboxPromise;
      const entryContext = sandbox.vivliostyleConfig.entryContext || '';
      const filename = join(entryContext, relative('/vivliostyle', pathname));
      const content = sandbox.files[filename];
      if (!content) {
        return ['', { status: 404 }];
      }
      const contentType = content.type || 'application/octet-stream';
      return [
        await content.buffer(),
        {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'no-store',
          },
        },
      ];
    },
  } satisfies ProjectChannel,
  channel,
);
