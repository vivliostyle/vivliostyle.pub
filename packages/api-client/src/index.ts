import createClient, { type Client } from 'openapi-fetch';

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

/** Copy into a standalone ArrayBuffer so it is a valid `fetch` body. */
function toRequestBody(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

/**
 * Typed client for the Vivliostyle Pub sync API. JSON endpoints go through the
 * generated openapi-fetch `client`; the binary file/attachment/sync endpoints
 * use plain authenticated `fetch` because octet-stream bodies are awkward to
 * express through openapi-fetch.
 */
export class ApiClient {
  readonly baseUrl: string;
  readonly client: Client<paths>;
  private readonly getAccessToken?: AccessTokenProvider;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.getAccessToken = options.getAccessToken;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.client = createClient<paths>({
      baseUrl: this.baseUrl,
      fetch: this.fetchImpl,
    });
    this.client.use({
      onRequest: async ({ request }) => {
        const token = await this.getAccessToken?.();
        if (token) {
          request.headers.set('Authorization', `Bearer ${token}`);
        }
        return request;
      },
    });
  }

  private async authedFetch(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const token = await this.getAccessToken?.();
    const headers = new Headers(init.headers);
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    return this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });
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
    if (error) {
      throw new ApiError('Failed to delete project', response.status, error);
    }
  }

  async listFiles(projectId: string): Promise<FileEntry[]> {
    const { data, error, response } = await this.client.GET(
      '/projects/{id}/files',
      { params: { path: { id: projectId } } },
    );
    if (error || !data) {
      throw new ApiError('Failed to list files', response.status, error);
    }
    return data.files;
  }

  async readFile(
    projectId: string,
    filePath: string,
  ): Promise<Uint8Array | null> {
    const res = await this.authedFetch(
      `/projects/${encodeURIComponent(projectId)}/files/${encodeFilePath(filePath)}`,
    );
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new ApiError('Failed to read file', res.status);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  async writeFile(
    projectId: string,
    filePath: string,
    data: Uint8Array,
    contentType = 'application/octet-stream',
  ): Promise<void> {
    const res = await this.authedFetch(
      `/projects/${encodeURIComponent(projectId)}/files/${encodeFilePath(filePath)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: toRequestBody(data),
      },
    );
    if (!res.ok) {
      throw new ApiError('Failed to write file', res.status);
    }
  }

  async deleteFile(projectId: string, filePath: string): Promise<void> {
    const res = await this.authedFetch(
      `/projects/${encodeURIComponent(projectId)}/files/${encodeFilePath(filePath)}`,
      { method: 'DELETE' },
    );
    if (!res.ok && res.status !== 404) {
      throw new ApiError('Failed to delete file', res.status);
    }
  }

  async getAttachment(
    projectId: string,
    sha256: string,
  ): Promise<Uint8Array | null> {
    const res = await this.authedFetch(
      `/projects/${encodeURIComponent(projectId)}/attachments/${sha256}`,
    );
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new ApiError('Failed to read attachment', res.status);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  async putAttachment(
    projectId: string,
    sha256: string,
    data: Uint8Array,
  ): Promise<AttachmentResult> {
    const res = await this.authedFetch(
      `/projects/${encodeURIComponent(projectId)}/attachments/${sha256}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: toRequestBody(data),
      },
    );
    if (!res.ok) {
      throw new ApiError('Failed to upload attachment', res.status);
    }
    return (await res.json()) as AttachmentResult;
  }

  /** Fetch the Yjs update the client is missing for the given state vector. */
  async syncPull(
    projectId: string,
    stateVector?: Uint8Array,
  ): Promise<Uint8Array> {
    const query = stateVector ? `?sv=${toBase64Url(stateVector)}` : '';
    const res = await this.authedFetch(
      `/projects/${encodeURIComponent(projectId)}/sync${query}`,
    );
    if (!res.ok) {
      throw new ApiError('Failed to pull sync state', res.status);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Apply a Yjs update on the server and receive the merged diff in return. */
  async syncPush(
    projectId: string,
    update: Uint8Array,
    stateVector?: Uint8Array,
  ): Promise<Uint8Array> {
    const query = stateVector ? `?sv=${toBase64Url(stateVector)}` : '';
    const res = await this.authedFetch(
      `/projects/${encodeURIComponent(projectId)}/sync${query}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: toRequestBody(update),
      },
    );
    if (!res.ok) {
      throw new ApiError('Failed to push sync state', res.status);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  /** WebSocket URL for realtime sync (token passed as query parameter). */
  syncWebSocketUrl(projectId: string, accessToken: string): string {
    const url = new URL(
      `${this.baseUrl}/projects/${encodeURIComponent(projectId)}/sync/ws`,
    );
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('access_token', accessToken);
    return url.toString();
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  return new ApiClient(options);
}
