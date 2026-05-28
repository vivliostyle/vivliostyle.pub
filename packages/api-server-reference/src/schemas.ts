import * as v from 'valibot';

// --- Auth ---

export const RegisterRequestSchema = v.object({
  username: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  password: v.pipe(v.string(), v.minLength(8), v.maxLength(256)),
});
export type RegisterRequest = v.InferOutput<typeof RegisterRequestSchema>;

export const UserSchema = v.object({
  id: v.string(),
  username: v.string(),
});
export type User = v.InferOutput<typeof UserSchema>;

export const AuthorizeRequestSchema = v.object({
  clientId: v.string(),
  redirectUri: v.pipe(v.string(), v.url()),
  codeChallenge: v.string(),
  codeChallengeMethod: v.optional(v.literal('S256'), 'S256'),
  scope: v.optional(v.string()),
  state: v.optional(v.string()),
  username: v.string(),
  password: v.string(),
});
export type AuthorizeRequest = v.InferOutput<typeof AuthorizeRequestSchema>;

export const AuthorizeResponseSchema = v.object({
  code: v.string(),
  state: v.optional(v.string()),
  redirectUri: v.string(),
});
export type AuthorizeResponse = v.InferOutput<typeof AuthorizeResponseSchema>;

export const TokenRequestSchema = v.variant('grantType', [
  v.object({
    grantType: v.literal('authorization_code'),
    code: v.string(),
    codeVerifier: v.string(),
    redirectUri: v.pipe(v.string(), v.url()),
    clientId: v.string(),
  }),
  v.object({
    grantType: v.literal('refresh_token'),
    refreshToken: v.string(),
    clientId: v.string(),
  }),
]);
export type TokenRequest = v.InferOutput<typeof TokenRequestSchema>;

export const TokenResponseSchema = v.object({
  accessToken: v.string(),
  tokenType: v.literal('Bearer'),
  expiresIn: v.number(),
  refreshToken: v.string(),
  scope: v.optional(v.string()),
});
export type TokenResponse = v.InferOutput<typeof TokenResponseSchema>;

export const RefreshRequestSchema = v.object({
  refreshToken: v.string(),
  clientId: v.string(),
});
export type RefreshRequest = v.InferOutput<typeof RefreshRequestSchema>;

// --- Projects ---

export const ProjectInputSchema = v.object({
  title: v.optional(v.string()),
  author: v.optional(v.string()),
  language: v.optional(v.string()),
});
export type ProjectInput = v.InferOutput<typeof ProjectInputSchema>;

export const ProjectRecordSchema = v.object({
  id: v.string(),
  title: v.optional(v.string()),
  author: v.optional(v.string()),
  language: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});
export type ProjectRecord = v.InferOutput<typeof ProjectRecordSchema>;

export const ProjectListSchema = v.object({
  projects: v.array(ProjectRecordSchema),
});
export type ProjectList = v.InferOutput<typeof ProjectListSchema>;

// --- Files ---

export const FileEntrySchema = v.object({
  path: v.string(),
  size: v.number(),
  contentType: v.string(),
  updatedAt: v.number(),
});
export type FileEntry = v.InferOutput<typeof FileEntrySchema>;

export const FileListSchema = v.object({
  files: v.array(FileEntrySchema),
});
export type FileList = v.InferOutput<typeof FileListSchema>;

// --- Attachments ---

export const AttachmentResultSchema = v.object({
  sha256: v.string(),
  size: v.number(),
});
export type AttachmentResult = v.InferOutput<typeof AttachmentResultSchema>;

// --- Capabilities ---

export const CapabilitiesSchema = v.object({
  name: v.string(),
  version: v.string(),
  apiVersions: v.array(v.string()),
  features: v.object({
    sync: v.boolean(),
    attachments: v.boolean(),
    oauth: v.boolean(),
  }),
});
export type Capabilities = v.InferOutput<typeof CapabilitiesSchema>;

// --- Errors ---

export const ErrorSchema = v.object({
  error: v.string(),
  message: v.optional(v.string()),
});
export type ErrorResponse = v.InferOutput<typeof ErrorSchema>;
