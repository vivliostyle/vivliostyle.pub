export class SandboxFile {
  public type: string;
  public bytes: Promise<Uint8Array>;

  constructor(file: File);
  constructor(type: string, bytes: Uint8Array);
  constructor(type: string, text: string);
  constructor(
    ...args:
      | [file: File]
      | [type: string, bytes: Uint8Array]
      | [type: string, text: string]
  ) {
    if (args.length === 1) {
      this.type = args[0].type;
      this.bytes = args[0].bytes();
    } else {
      this.type = args[0];
      this.bytes =
        typeof args[1] === 'string'
          ? Promise.resolve(new TextEncoder().encode(args[1]))
          : Promise.resolve(args[1]);
    }
  }

  text() {
    return this.bytes.then((bytes) => new TextDecoder().decode(bytes));
  }

  buffer() {
    return this.bytes.then(
      (bytes) =>
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
    );
  }

  blob() {
    return this.buffer().then((buffer) => {
      return new Blob([buffer], { type: this.type });
    });
  }
}
