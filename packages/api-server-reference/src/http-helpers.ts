import { resolver } from 'hono-openapi';
import type { OpenAPIV3_1 } from 'openapi-types';

type StandardSchema = Parameters<typeof resolver>[0];

export function jsonContent(schema: StandardSchema) {
  return { 'application/json': { schema: resolver(schema) } };
}

const binarySchema: OpenAPIV3_1.SchemaObject = {
  type: 'string',
  format: 'binary',
};

export const binaryContent = {
  'application/octet-stream': { schema: binarySchema },
};

/** Copy into a standalone ArrayBuffer so it can be used as a response body. */
export function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}
