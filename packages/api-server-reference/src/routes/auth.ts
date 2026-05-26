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
import { jsonContent } from '../route-helpers';
import {
  AuthorizeRequestSchema,
  AuthorizeResponseSchema,
  ErrorSchema,
  RefreshRequestSchema,
  RegisterRequestSchema,
  TokenRequestSchema,
  type TokenResponse,
  TokenResponseSchema,
  UserSchema,
} from '../schemas';

export function authRoutes({ store, config }: Deps) {
  const app = new Hono<AuthEnv>();

  const issueTokens = (
    userId: string,
    clientId: string,
    scope?: string,
  ): TokenResponse => {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    store.saveAccessToken({
      token: accessToken,
      userId,
      scope,
      expiresAt: Date.now() + config.accessTokenTtlMs,
    });
    store.saveRefreshToken({
      token: refreshToken,
      userId,
      clientId,
      scope,
      expiresAt: Date.now() + config.refreshTokenTtlMs,
    });
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: Math.floor(config.accessTokenTtlMs / 1000),
      refreshToken,
      scope,
    };
  };

  app.post(
    '/auth/register',
    describeRoute({
      tags: ['auth'],
      summary: 'Create a new user account.',
      description:
        'Creates an account with the given username and password. Sign in via `/oauth/authorize` afterwards to obtain access tokens.',
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
    '/oauth/authorize',
    describeRoute({
      tags: ['auth'],
      summary: 'Sign in and receive an authorization code.',
      description:
        'Verifies the username and password and returns a short-lived authorization code. Exchange it for tokens by calling `/oauth/token` with the matching PKCE verifier.',
      responses: {
        200: {
          description: 'Authorization code',
          content: jsonContent(AuthorizeResponseSchema),
        },
        401: {
          description: 'Invalid credentials',
          content: jsonContent(ErrorSchema),
        },
      },
    }),
    validator('json', AuthorizeRequestSchema),
    (c) => {
      const body = c.req.valid('json');
      const user = store.findUserByUsername(body.username);
      if (!user || !verifyPassword(body.password, user.passwordHash)) {
        return c.json({ error: 'invalid_credentials' }, 401);
      }
      const code = randomToken(24);
      store.saveAuthCode({
        code,
        userId: user.id,
        clientId: body.clientId,
        redirectUri: body.redirectUri,
        codeChallenge: body.codeChallenge,
        scope: body.scope,
        expiresAt: Date.now() + config.authCodeTtlMs,
      });
      return c.json(
        { code, state: body.state, redirectUri: body.redirectUri },
        200,
      );
    },
  );

  app.post(
    '/oauth/token',
    describeRoute({
      tags: ['auth'],
      summary:
        'Exchange an authorization code or refresh token for an access token.',
      description:
        'Two grant types are supported: `authorization_code` (after `/oauth/authorize`) and `refresh_token` (to rotate an existing session).',
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
    validator('json', TokenRequestSchema),
    (c) => {
      const body = c.req.valid('json');
      if (body.grantType === 'authorization_code') {
        const authCode = store.takeAuthCode(body.code);
        if (!authCode || authCode.expiresAt < Date.now()) {
          return c.json(
            { error: 'invalid_grant', message: 'code invalid or expired' },
            400,
          );
        }
        if (
          authCode.clientId !== body.clientId ||
          authCode.redirectUri !== body.redirectUri
        ) {
          return c.json(
            { error: 'invalid_grant', message: 'client/redirect mismatch' },
            400,
          );
        }
        if (!verifyPkce(body.codeVerifier, authCode.codeChallenge)) {
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
      const refresh = store.takeRefreshToken(body.refreshToken);
      if (
        !refresh ||
        refresh.expiresAt < Date.now() ||
        refresh.clientId !== body.clientId
      ) {
        return c.json(
          { error: 'invalid_grant', message: 'refresh token invalid' },
          400,
        );
      }
      return c.json(
        issueTokens(refresh.userId, refresh.clientId, refresh.scope),
        200,
      );
    },
  );

  app.post(
    '/oauth/refresh',
    describeRoute({
      tags: ['auth'],
      summary: 'Renew the access token using a refresh token.',
      description:
        'Returns a new access token and rotates the refresh token. The previous refresh token is invalidated.',
      responses: {
        200: {
          description: 'Tokens',
          content: jsonContent(TokenResponseSchema),
        },
        400: {
          description: 'Invalid refresh token',
          content: jsonContent(ErrorSchema),
        },
      },
    }),
    validator('json', RefreshRequestSchema),
    (c) => {
      const { refreshToken, clientId } = c.req.valid('json');
      const refresh = store.takeRefreshToken(refreshToken);
      if (
        !refresh ||
        refresh.expiresAt < Date.now() ||
        refresh.clientId !== clientId
      ) {
        return c.json({ error: 'invalid_grant' }, 400);
      }
      return c.json(
        issueTokens(refresh.userId, refresh.clientId, refresh.scope),
        200,
      );
    },
  );

  app.delete(
    '/oauth/session',
    describeRoute({
      tags: ['auth'],
      summary: 'Sign out the current user.',
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
    '/oauth/userinfo',
    describeRoute({
      tags: ['auth'],
      summary: 'Get the profile of the signed-in user.',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'User', content: jsonContent(UserSchema) },
        401: { description: 'Unauthorized', content: jsonContent(ErrorSchema) },
      },
    }),
    bearerAuth(store),
    (c) => {
      const user = store.findUserById(c.get('userId'));
      if (!user) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.json({ id: user.id, username: user.username }, 200);
    },
  );

  return app;
}
