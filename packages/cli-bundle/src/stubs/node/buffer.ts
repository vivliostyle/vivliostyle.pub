import _buffer from 'buffer/';

export * from 'buffer/';

export const isUtf8 = (value: unknown): boolean => {
  const { Buffer } = _buffer;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    if (Buffer.isBuffer(value)) {
      decoder.decode(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      );
    } else if (value instanceof ArrayBuffer) {
      decoder.decode(new Uint8Array(value));
    } else if (ArrayBuffer.isView(value)) {
      decoder.decode(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      );
    } else {
      return false;
    }
    return true;
  } catch {
    return false;
  }
};

export default { ..._buffer, isUtf8 };
