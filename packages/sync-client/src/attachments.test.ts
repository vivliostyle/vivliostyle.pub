import { describe, expect, it } from 'vitest';

import {
  type AttachmentTransport,
  AttachmentUploader,
  sha256Hex,
} from './attachments';

describe('sha256Hex', () => {
  it('hashes bytes to a hex digest', async () => {
    // SHA-256("abc")
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('AttachmentUploader', () => {
  it('uploads under the content hash and downloads it back', async () => {
    const store = new Map<string, Uint8Array>();
    const transport: AttachmentTransport = {
      async putAttachment(_projectId, sha256, data) {
        store.set(sha256, data);
        return { sha256, size: data.byteLength };
      },
      async getAttachment(_projectId, sha256) {
        return store.get(sha256) ?? null;
      },
    };
    const uploader = new AttachmentUploader(transport);

    const data = new TextEncoder().encode('cover image bytes');
    const sha = await uploader.upload('p1', data);
    expect(sha).toBe(await sha256Hex(data));
    expect(await uploader.download('p1', sha)).toEqual(data);
    expect(await uploader.download('p1', 'missing')).toBeNull();
  });
});
