import { proxy, ref, subscribe } from 'valtio';
import { deepClone } from 'valtio/utils';

import { setupProject } from './actions/setup-project';
import { Content } from './content';
import { Sandbox } from './sandbox';
import { Theme } from './theme';

declare const projectIdBrand: unique symbol;
export type ProjectId = string & { [projectIdBrand]: never };

export const draftProjectId: ProjectId = '__draft' as ProjectId;

const initialBibliographyState = {
  title: '',
  author: '',
};

const initialTocState = {
  enabled: false,
  title: '',
  sectionDepth: 0,
};

export const projects = proxy({
  value: {} as Record<ProjectId, Project>,
  currentProjectId: null as ProjectId | null,
});

export class Project {
  static addNewProject(projectId: ProjectId) {
    const project = proxy(new Project(projectId));
    subscribe(project.bibliography, () => project.handleBibliographyUpdate());
    subscribe(project.toc, () => project.handleTocUpdate());

    projects.value[projectId] = project;
    projects.currentProjectId = projectId;
    return project;
  }

  projectId: ProjectId;
  content = Content.create(this);
  theme = Theme.create(this);
  sandbox: Sandbox | undefined;
  sandboxPromise = this.setupSandbox();
  setupPromise: Promise<void>;
  bibliography = deepClone(initialBibliographyState);
  toc = deepClone(initialTocState);

  protected constructor(projectId: ProjectId) {
    this.projectId = projectId;
    this.setupPromise = (async () => {
      const sandbox = await this.sandboxPromise;
      await setupProject();
      this.bibliography.title = sandbox.vivliostyleConfig.title || '';
      this.bibliography.author = sandbox.vivliostyleConfig.author || '';
      this.toc.enabled = Boolean(sandbox.vivliostyleConfig.toc);
      if (typeof sandbox.vivliostyleConfig.toc === 'object') {
        this.toc.title = sandbox.vivliostyleConfig.toc.title || '';
        this.toc.sectionDepth = sandbox.vivliostyleConfig.toc.sectionDepth || 0;
      }
    })();
  }

  protected async setupSandbox() {
    const root = await navigator.storage.getDirectory();
    const directoryHandle = await root.getDirectoryHandle(this.projectId, {
      create: true,
    });
    const sandbox = proxy(Sandbox.create(this, ref(directoryHandle)));
    try {
      await sandbox.loadFromFileSystem();
    } catch (error) {
      console.warn(error);
      // Not exist or invalid project file
      await root.removeEntry(this.projectId, { recursive: true });
      sandbox.projectDirectoryHandle = ref(
        await root.getDirectoryHandle(this.projectId, { create: true }),
      );
      await sandbox.initializeProjectFiles();
    }
    this.sandbox = sandbox;
    return sandbox;
  }

  protected async handleBibliographyUpdate() {
    const sandbox = await this.sandboxPromise;
    sandbox.updateVivliostyleConfig((config) => {
      config.title = this.bibliography.title || undefined;
      config.author = this.bibliography.author || undefined;
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
}

Project.addNewProject('alpha-v1' as ProjectId);
