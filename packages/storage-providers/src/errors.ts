export class StorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageError';
  }
}

export class StorageNotFoundError extends StorageError {
  constructor(path: string, options?: { cause?: unknown }) {
    super(`Not found: ${path}`, options);
    this.name = 'StorageNotFoundError';
  }
}

export class StorageConflictError extends StorageError {
  constructor(path: string, options?: { cause?: unknown }) {
    super(`Conflict: ${path}`, options);
    this.name = 'StorageConflictError';
  }
}

export class StorageQuotaError extends StorageError {
  constructor(
    message = 'Storage quota exceeded',
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'StorageQuotaError';
  }
}
