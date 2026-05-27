import createClient, {
  type Client,
  defaultBodySerializer,
  type Middleware,
} from 'openapi-fetch';

import type { paths } from './schema';

export type { paths } from './schema';

type Operation<P extends keyof paths, M extends keyof paths[P]> = paths[P][M];
type Ok200<T> = T extends {
  responses: { 200: { content: { 'application/json': infer J } } };
}
  ? J
  : never;
type Ok201<T> = T extends {
  responses: { 201: { content: { 'application/json': infer J } } };
}
  ? J
  : never;

export type Capabilities = Ok200<
  Operation<'/.well-known/vivliostyle-pub', 'get'>
>;
export type ProjectRecord = Ok200<Operation<'/projects/{id}', 'get'>>;
export type ProjectList = Ok200<Operation<'/projects', 'get'>>;
export type FileEntry = Ok200<
  Operation<'/projects/{id}/files', 'get'>
>['files'][number];
export type TokenResponse = Ok200<Operation<'/oauth/token', 'post'>>;
export type AttachmentResult = Ok201<
  Operation<'/projects/{id}/attachments/{sha256}', 'put'>
>;

export type AccessTokenProvider = () =>
  | string
  | null
  | undefined
  | Promise<string | null | undefined>;

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken?: AccessTokenProvider;
  fetch?: typeof globalThis.fetch;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function encodeFilePath(filePath: string): string {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Typed client for the Vivliostyle Pub sync API. JSON endpoints go through the
 * generated openapi-fetch `client`; the binary file/attachment/sync endpoints
 * go through the parallel `authedClient`, which is the same `Client<paths>`
 * shape but configured with a `Uint8Array`-aware `bodySerializer` and a
 * `/`-preserving `pathSerializer` (needed because the API's `{path}` parameter
 * holds hierarchical file paths). Both clients share the bearer-token
 * middleware so every authenticated call carries the same `Authorization`
 * header.
 */
export class ApiClient {
  readonly baseUrl: string;
  readonly client: Client<paths>;
  readonly authedClient: Client<paths>;
  private readonly getAccessToken?: AccessTokenProvider;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.getAccessToken = options.getAccessToken;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);

    const bearerMiddleware: Middleware = {
      onRequest: async ({ request }) => {
        const token = await this.getAccessToken?.();
        if (token) {
          request.headers.set('Authorization', `Bearer ${token}`);
        }
        return request;
      },
    };

    this.client = createClient<paths>({
      baseUrl: this.baseUrl,
      fetch: this.fetchImpl,
    });
    this.client.use(bearerMiddleware);

    this.authedClient = createClient<paths>({
      baseUrl: this.baseUrl,
      fetch: this.fetchImpl,
      // Pass `Uint8Array` bodies through as a standalone `ArrayBuffer` (so
      // `fetch` accepts them as `BodyInit` regardless of the caller's buffer
      // ownership); fall back to openapi-fetch's default JSON-or-FormData
      // handling for anything else.
      bodySerializer: (body: unknown) => {
        if (body instanceof Uint8Array) {
          const copy = new Uint8Array(body.byteLength);
          copy.set(body);
          return copy.buffer;
        }
        return defaultBodySerializer(body);
      },
      // openapi-fetch's default `pathSerializer` calls `encodeURIComponent`
      // on the entire value, which turns `/` into `%2F` and breaks
      // hierarchical `{path}` params like `images/a b.png`. Encode per
      // segment instead.
      pathSerializer: (pathname, pathParams) => {
        return pathname.replace(/\{([^{}]+)\}/g, (_match, name: string) => {
          const value = pathParams[name];
          if (value === undefined || value === null) return '';
          return String(value).split('/').map(encodeURIComponent).join('/');
        });
      },
    });
    this.authedClient.use(bearerMiddleware);
  }

  async capabilities(): Promise<Capabilities> {
    const { data, error, response } = await this.client.GET(
      '/.well-known/vivliostyle-pub',
    );
    if (!response.ok || !data) {
      throw new ApiError('Failed to read capabilities', response.status, error);
    }
    return data;
  }

  async listProjects(): Promise<ProjectRecord[]> {
    const { data, error, response } = await this.client.GET('/projects');
    if (!response.ok || !data) {
      throw new ApiError('Failed to list projects', response.status, error);
    }
    return data.projects;
  }

  async createProject(input: {
    title?: string;
    author?: string;
    language?: string;
  }): Promise<ProjectRecord> {
    const { data, error, response } = await this.client.POST('/projects', {
      body: input,
    });
    if (!response.ok || !data) {
      throw new ApiError('Failed to create project', response.status, error);
    }
    return data;
  }

  async deleteProject(projectId: string): Promise<void> {
    const { error, response } = await this.client.DELETE('/projects/{id}', {
      params: { path: { id: projectId } },
    });
    if (!response.ok) {
      throw new ApiError('Failed to delete project', response.status, error);
    }
  }

  async listFiles(projectId: string): Promise<FileEntry[]> {
    const { data, error, response } = await this.client.GET(
      '/projects/{id}/files',
      { params: { path: { id: projectId } } },
    );
    if (!response.ok || !data) {
      throw new ApiError('Failed to list files', response.status, error);
    }
    return data.files;
  }

  async readFile(
    projectId: string,
    filePath: string,
  ): Promise<Uint8Array | null> {
    const { data, error, response } = await this.authedClient.GET(
      '/projects/{id}/files/{path}',
      {
        params: { path: { id: projectId, path: filePath } },
        parseAs: 'arrayBuffer',
      },
    );
    if (response.status === 404) {
      return null;
    }
    if (!data) {
      throw new ApiError('Failed to read file', response.status, error);
    }
    return new Uint8Array(data);
  }

  async writeFile(
    projectId: string,
    filePath: string,
    data: Uint8Array,
    contentType = 'application/octet-stream',
  ): Promise<void> {
    const { error, response } = await this.authedClient.PUT(
      '/projects/{id}/files/{path}',
      {
        params: { path: { id: projectId, path: filePath } },
        body: data,
        headers: { 'Content-Type': contentType },
      },
    );
    if (!response.ok) {
      throw new ApiError('Failed to write file', response.status, error);
    }
  }

  async deleteFile(projectId: string, filePath: string): Promise<void> {
    const { error, response } = await this.authedClient.DELETE(
      '/projects/{id}/files/{path}',
      { params: { path: { id: projectId, path: filePath } } },
    );
    if (!response.ok && response.status !== 404) {
      throw new ApiError('Failed to delete file', response.status, error);
    }
  }

  async getAttachment(
    projectId: string,
    sha256: string,
  ): Promise<Uint8Array | null> {
    const { data, error, response } = await this.authedClient.GET(
      '/projects/{id}/attachments/{sha256}',
      {
        params: { path: { id: projectId, sha256 } },
        parseAs: 'arrayBuffer',
      },
    );
    if (response.status === 404) {
      return null;
    }
    if (!data) {
      throw new ApiError('Failed to read attachment', response.status, error);
    }
    return new Uint8Array(data);
  }

  async putAttachment(
    projectId: string,
    sha256: string,
    data: Uint8Array,
  ): Promise<AttachmentResult> {
    const {
      data: result,
      error,
      response,
    } = await this.authedClient.PUT('/projects/{id}/attachments/{sha256}', {
      params: { path: { id: projectId, sha256 } },
      body: data,
      // Override openapi-fetch's default `application/json` since our
      // `bodySerializer` is shipping the raw bytes.
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    if (!result) {
      throw new ApiError('Failed to upload attachment', response.status, error);
    }
    return result;
  }

  /** Fetch the Yjs update the client is missing for the given state vector. */
  async syncPull(
    projectId: string,
    filename: string,
    stateVector?: Uint8Array,
  ): Promise<Uint8Array> {
    const { data, error, response } = await this.authedClient.GET(
      '/projects/{id}/sync/{path}',
      {
        params: {
          path: { id: projectId, path: filename },
          query: stateVector ? { sv: toBase64Url(stateVector) } : undefined,
        },
        parseAs: 'arrayBuffer',
      },
    );
    if (!data) {
      throw new ApiError('Failed to pull sync state', response.status, error);
    }
    return new Uint8Array(data);
  }

  /** Apply a Yjs update on the server and receive the merged diff in return. */
  async syncPush(
    projectId: string,
    filename: string,
    update: Uint8Array,
    stateVector?: Uint8Array,
  ): Promise<Uint8Array> {
    const { data, error, response } = await this.authedClient.POST(
      '/projects/{id}/sync/{path}',
      {
        params: {
          path: { id: projectId, path: filename },
          query: stateVector ? { sv: toBase64Url(stateVector) } : undefined,
        },
        body: update,
        headers: { 'Content-Type': 'application/octet-stream' },
        parseAs: 'arrayBuffer',
      },
    );
    if (!data) {
      throw new ApiError('Failed to push sync state', response.status, error);
    }
    return new Uint8Array(data);
  }

  /** WebSocket URL for realtime sync (token passed as query parameter). */
  syncWebSocketUrl(
    projectId: string,
    filename: string,
    accessToken: string,
  ): string {
    // `baseUrl` may be a relative path (e.g. `/api`) when the API is mounted
    // on the same origin as the app. `URL` needs an absolute reference in
    // that case, so resolve against the document origin.
    const path = `${this.baseUrl}/projects/${encodeURIComponent(projectId)}/sync-ws/${encodeFilePath(filename)}`;
    const base =
      typeof location !== 'undefined' ? location.origin : 'http://localhost';
    const url = new URL(path, base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('access_token', accessToken);
    return url.toString();
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  return new ApiClient(options);
}
