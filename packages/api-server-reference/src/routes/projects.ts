import { Hono } from 'hono';
import { describeRoute, validator } from 'hono-openapi';

import type { AuthEnv, Deps } from '../deps';
import { jsonContent } from '../http-helpers';
import {
  ErrorSchema,
  ProjectInputSchema,
  ProjectListSchema,
  ProjectRecordSchema,
} from '../schemas';

export function projectRoutes({ store, files }: Deps) {
  const app = new Hono<AuthEnv>();

  app.get(
    '/projects',
    describeRoute({
      tags: ['projects'],
      summary: 'List projects',
      description: 'Returns all projects owned by the authenticated user.',
      security: [{ bearerAuth: [] }],
      responses: {
        200: {
          description: 'Projects',
          content: jsonContent(ProjectListSchema),
        },
      },
    }),
    (c) => c.json({ projects: store.listProjects(c.get('userId')) }, 200),
  );

  app.post(
    '/projects',
    describeRoute({
      tags: ['projects'],
      summary: 'Create project',
      description: 'Creates a new project owned by the authenticated user.',
      security: [{ bearerAuth: [] }],
      responses: {
        201: {
          description: 'Created',
          content: jsonContent(ProjectRecordSchema),
        },
      },
    }),
    validator('json', ProjectInputSchema),
    (c) => {
      const project = store.createProject(c.get('userId'), c.req.valid('json'));
      return c.json(project, 201);
    },
  );

  app.get(
    '/projects/:id',
    describeRoute({
      tags: ['projects'],
      summary: 'Get project',
      description: "Returns the project's metadata.",
      security: [{ bearerAuth: [] }],
      responses: {
        200: {
          description: 'Project',
          content: jsonContent(ProjectRecordSchema),
        },
        404: { description: 'Not found', content: jsonContent(ErrorSchema) },
      },
    }),
    (c) => {
      const project = store.getProject(c.get('userId'), c.req.param('id'));
      if (!project) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.json(project, 200);
    },
  );

  app.put(
    '/projects/:id',
    describeRoute({
      tags: ['projects'],
      summary: 'Update project',
      description: "Replaces the project's metadata with the request body.",
      security: [{ bearerAuth: [] }],
      responses: {
        200: {
          description: 'Updated',
          content: jsonContent(ProjectRecordSchema),
        },
        404: { description: 'Not found', content: jsonContent(ErrorSchema) },
      },
    }),
    validator('json', ProjectInputSchema),
    (c) => {
      const project = store.updateProject(
        c.get('userId'),
        c.req.param('id'),
        c.req.valid('json'),
      );
      if (!project) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.json(project, 200);
    },
  );

  app.delete(
    '/projects/:id',
    describeRoute({
      tags: ['projects'],
      summary: 'Delete project',
      description:
        'Removes the project along with all of its files and document state.',
      security: [{ bearerAuth: [] }],
      responses: {
        204: { description: 'Deleted' },
        404: { description: 'Not found', content: jsonContent(ErrorSchema) },
      },
    }),
    async (c) => {
      const projectId = c.req.param('id');
      const ok = store.removeProject(c.get('userId'), projectId);
      if (!ok) {
        return c.json({ error: 'not_found' }, 404);
      }
      await files.removeProject(projectId);
      return c.body(null, 204);
    },
  );

  return app;
}
