import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import {
  type RequestOptions,
  createRequest,
  createResponse,
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
