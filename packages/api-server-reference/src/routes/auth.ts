import { Hono } from 'hono';
import { describeRoute, validator } from 'hono-openapi';

import { bearerAuth } from '../auth-middleware';
import {
  hashPassword,
  randomToken,
  verifyPassword,
  verifyPkce,
} from '../crypto';
import type { AuthEnv, Deps } from '../deps';
import { jsonContent } from '../http-helpers';
import {
  AuthorizeRequestSchema,
  AuthorizeResponseSchema,
  ErrorSchema,
  RegisterRequestSchema,
  RevokeRequestSchema,
  SignInRequestSchema,
  SignInResponseSchema,
  TokenRequestSchema,
  type TokenResponse,
  TokenResponseSchema,
  UserInfoSchema,
  UserSchema,
} from '../schemas';

export function authRoutes({ store, config }: Deps) {
  const app = new Hono<AuthEnv>();

  const issueTokens = (
    userId: string,
    clientId: string,
    scope?: string,
    grantId: string = randomToken(16),
  ): TokenResponse => {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    store.saveAccessToken({
      token: accessToken,
      userId,
      clientId,
      grantId,
      scope,
      expiresAt: Date.now() + config.accessTokenTtlMs,
    });
    store.saveRefreshToken({
      token: refreshToken,
      userId,
      clientId,
      grantId,
      scope,
      expiresAt: Date.now() + config.refreshTokenTtlMs,
    });
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: Math.floor(config.accessTokenTtlMs / 1000),
      refresh_token: refreshToken,
      scope,
    };
  };

  app.post(
    '/auth/register',
    describeRoute({
      tags: ['auth'],
      summary: 'Register',
      description:
        'Creates a new user account; sign in via `/auth/sign-in` afterwards, then `/auth/oauth2/authorize` → `/auth/oauth2/token` to obtain access tokens.',
      responses: {
        201: { description: 'Created', content: jsonContent(UserSchema) },
        409: {
          description: 'Username already taken',
          content: jsonContent(ErrorSchema),
        },
      },
    }),
    validator('json', RegisterRequestSchema),
    (c) => {
      const { username, password } = c.req.valid('json');
      if (store.findUserByUsername(username)) {
        return c.json(
          { error: 'conflict', message: 'username already taken' },
          409,
        );
      }
      const user = store.createUser(username, hashPassword(password));
      return c.json({ id: user.id, username: user.username }, 201);
    },
  );

  app.post(
    '/auth/sign-in',
    describeRoute({
      tags: ['auth'],
      summary: 'Sign in',
      description:
        'Verifies the username and password and starts a session, returning the session token to authorize `/auth/oauth2/authorize`.',
      responses: {
        200: {
          description: 'Session',
          content: jsonContent(SignInResponseSchema),
        },
        401: {
          description: 'Invalid credentials',
          content: jsonContent(ErrorSchema),
        },
      },
    }),
    validator('json', SignInRequestSchema),
    (c) => {
      const { username, password } = c.req.valid('json');
      const user = store.findUserByUsername(username);
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return c.json({ error: 'invalid_credentials' }, 401);
      }
      const token = randomToken();
      store.saveSession({
        token,
        userId: user.id,
        expiresAt: Date.now() + config.sessionTtlMs,
      });
      return c.json(
        { token, user: { id: user.id, username: user.username } },
        200,
      );
    },
  );

  app.get(
    '/auth/oauth2/authorize',
    describeRoute({
      tags: ['auth'],
      summary: 'Authorize',
      description:
        'Issues a short-lived authorization code for the session given in the `Authorization: Bearer <session token>` header (from `/auth/sign-in`), returning the redirect URI carrying the code to exchange via `/auth/oauth2/token` with the matching PKCE verifier.',
      security: [{ sessionAuth: [] }],
      responses: {
        200: {
          description: 'Authorization redirect',
          content: jsonContent(AuthorizeResponseSchema),
        },
        401: {
          description: 'Invalid session',
          content: jsonContent(ErrorSchema),
        },
      },
    }),
    validator('query', AuthorizeRequestSchema),
    (c) => {
      const header = c.req.header('Authorization');
      const sessionToken = header?.startsWith('Bearer ')
        ? header.slice(7)
        : undefined;
      const session = sessionToken
        ? store.findSession(sessionToken)
        : undefined;
      if (!session) {
        return c.json({ error: 'invalid_session' }, 401);
      }
      const query = c.req.valid('query');
      const code = randomToken(24);
      store.saveAuthCode({
        code,
        userId: session.userId,
        clientId: query.client_id,
        redirectUri: query.redirect_uri,
        codeChallenge: query.code_challenge,
        scope: query.scope,
        expiresAt: Date.now() + config.authCodeTtlMs,
      });
      const url = new URL(query.redirect_uri);
      url.searchParams.set('code', code);
      if (query.state) {
        url.searchParams.set('state', query.state);
      }
      return c.json({ redirect: true, url: url.toString() }, 200);
    },
  );

  app.post(
    '/auth/oauth2/token',
    describeRoute({
      tags: ['auth'],
      summary: 'Token',
      description:
        'Exchanges an authorization code (after `/auth/oauth2/authorize`) or a refresh token for an access token. The refresh token is rotated, invalidating the previous one.',
      responses: {
        200: {
          description: 'Tokens',
          content: jsonContent(TokenResponseSchema),
        },
        400: {
          description: 'Invalid grant',
          content: jsonContent(ErrorSchema),
        },
      },
    }),
    validator('form', TokenRequestSchema),
    (c) => {
      const body = c.req.valid('form');
      if (body.grant_type === 'authorization_code') {
        const authCode = store.takeAuthCode(body.code);
        if (!authCode || authCode.expiresAt < Date.now()) {
          return c.json(
            { error: 'invalid_grant', message: 'code invalid or expired' },
            400,
          );
        }
        if (
          authCode.clientId !== body.client_id ||
          authCode.redirectUri !== body.redirect_uri
        ) {
          return c.json(
            { error: 'invalid_grant', message: 'client/redirect mismatch' },
            400,
          );
        }
        if (!verifyPkce(body.code_verifier, authCode.codeChallenge)) {
          return c.json(
            { error: 'invalid_grant', message: 'PKCE verification failed' },
            400,
          );
        }
        return c.json(
          issueTokens(authCode.userId, authCode.clientId, authCode.scope),
          200,
        );
      }
      const refresh = store.takeRefreshToken(body.refresh_token);
      if (
        !refresh ||
        refresh.expiresAt < Date.now() ||
        refresh.clientId !== body.client_id
      ) {
        return c.json(
          { error: 'invalid_grant', message: 'refresh token invalid' },
          400,
        );
      }
      return c.json(
        issueTokens(
          refresh.userId,
          refresh.clientId,
          refresh.scope,
          refresh.grantId,
        ),
        200,
      );
    },
  );

  app.post(
    '/auth/oauth2/revoke',
    describeRoute({
      tags: ['auth'],
      summary: 'Revoke',
      description:
        'Revokes a token (RFC 7009). Revoking a refresh token also drops the access tokens of the same grant. Always responds 200, even for an unknown or already-revoked token.',
      responses: {
        200: { description: 'Revoked' },
      },
    }),
    validator('form', RevokeRequestSchema),
    (c) => {
      const { token, client_id } = c.req.valid('form');
      // Only the client the token was issued to may revoke it (RFC 7009 §2.1);
      // both token types carry their issuing client.
      const grant =
        store.findRefreshToken(token) ?? store.findAccessToken(token);
      if (grant && grant.clientId === client_id) {
        store.revokeGrant(grant.grantId);
      }
      return c.body(null, 200);
    },
  );

  app.delete(
    '/auth/oauth2/session',
    describeRoute({
      tags: ['auth'],
      summary: 'Logout',
      description:
        'Revokes every access and refresh token issued to the signed-in user.',
      security: [{ bearerAuth: [] }],
      responses: {
        204: { description: 'Revoked' },
        401: { description: 'Unauthorized', content: jsonContent(ErrorSchema) },
      },
    }),
    bearerAuth(store),
    (c) => {
      store.revokeUserTokens(c.get('userId'));
      return c.body(null, 204);
    },
  );

  app.get(
    '/auth/oauth2/userinfo',
    describeRoute({
      tags: ['auth'],
      summary: 'User info',
      description: "Returns the signed-in user's OpenID Connect claims.",
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'Claims', content: jsonContent(UserInfoSchema) },
        401: { description: 'Unauthorized', content: jsonContent(ErrorSchema) },
      },
    }),
    bearerAuth(store),
    (c) => {
      const user = store.findUserById(c.get('userId'));
      if (!user) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.json({ sub: user.id, name: user.username }, 200);
    },
  );

  return app;
}
