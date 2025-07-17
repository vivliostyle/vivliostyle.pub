import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import {
  createRequest,
  createResponse,
  type RequestOptions,
} from 'node-mocks-http';

export function createMocks(option: RequestOptions) {
  const req = createRequest(option);
  const res = createResponse({
    eventEmitter: EventEmitter,
    writableStream: Writable,
    req,
  });

  return { req, res };
}
