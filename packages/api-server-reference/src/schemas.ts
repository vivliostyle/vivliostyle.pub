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

export const SignInRequestSchema = v.object({
  username: v.string(),
  password: v.string(),
});
export type SignInRequest = v.InferOutput<typeof SignInRequestSchema>;

export const SignInResponseSchema = v.object({
  token: v.string(),
  user: UserSchema,
});
export type SignInResponse = v.InferOutput<typeof SignInResponseSchema>;

export const AuthorizeRequestSchema = v.object({
  response_type: v.optional(v.literal('code'), 'code'),
  client_id: v.string(),
  redirect_uri: v.pipe(v.string(), v.url()),
  scope: v.optional(v.string()),
  state: v.optional(v.string()),
  code_challenge: v.string(),
  code_challenge_method: v.optional(v.literal('S256'), 'S256'),
});
export type AuthorizeRequest = v.InferOutput<typeof AuthorizeRequestSchema>;

export const AuthorizeResponseSchema = v.object({
  redirect: v.boolean(),
  url: v.string(),
});
export type AuthorizeResponse = v.InferOutput<typeof AuthorizeResponseSchema>;

export const TokenRequestSchema = v.variant('grant_type', [
  v.object({
    grant_type: v.literal('authorization_code'),
    code: v.string(),
    code_verifier: v.string(),
    redirect_uri: v.pipe(v.string(), v.url()),
    client_id: v.string(),
  }),
  v.object({
    grant_type: v.literal('refresh_token'),
    refresh_token: v.string(),
    client_id: v.string(),
  }),
]);
export type TokenRequest = v.InferOutput<typeof TokenRequestSchema>;

export const TokenResponseSchema = v.object({
  access_token: v.string(),
  token_type: v.literal('Bearer'),
  expires_in: v.number(),
  refresh_token: v.string(),
  scope: v.optional(v.string()),
});
export type TokenResponse = v.InferOutput<typeof TokenResponseSchema>;

export const RevokeRequestSchema = v.object({
  token: v.string(),
  token_type_hint: v.optional(v.picklist(['access_token', 'refresh_token'])),
  client_id: v.string(),
});
export type RevokeRequest = v.InferOutput<typeof RevokeRequestSchema>;

export const UserInfoSchema = v.object({
  sub: v.string(),
  name: v.string(),
});
export type UserInfo = v.InferOutput<typeof UserInfoSchema>;

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
  // SHA-256 hex of the file content. Lets a client diff its local copy against
  // the server and upload only the files that actually changed. Optional so a
  // backend that cannot derive it cheaply may omit it.
  hash: v.optional(v.string()),
  // Short-lived URL for fetching the bytes directly from the underlying blob
  // store, bypassing this API. Present only when the listing was requested with
  // `download=true`, and only for backends that can mint one.
  downloadUrl: v.optional(v.string()),
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
