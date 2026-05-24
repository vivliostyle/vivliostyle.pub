export async function sha256Hex(data: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Subset of ApiClient used for attachment transfer. */
export interface AttachmentTransport {
  putAttachment(
    projectId: string,
    sha256: string,
    data: Uint8Array,
  ): Promise<{ sha256: string; size: number }>;
  getAttachment(projectId: string, sha256: string): Promise<Uint8Array | null>;
}

/**
 * Uploads binary blobs to content-addressed storage so they never bloat the
 * Yjs document; the document only references the resulting SHA-256.
 */
export class AttachmentUploader {
  constructor(private readonly transport: AttachmentTransport) {}

  async upload(projectId: string, data: Uint8Array): Promise<string> {
    const sha256 = await sha256Hex(data);
    await this.transport.putAttachment(projectId, sha256, data);
    return sha256;
  }

  download(projectId: string, sha256: string): Promise<Uint8Array | null> {
    return this.transport.getAttachment(projectId, sha256);
  }
}
