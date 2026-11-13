import { AppError, type Clock } from '@scryguard/shared';
import type { KeyObject } from 'node:crypto';
import * as z from 'zod';
import { createAppJwt } from './app-jwt.js';

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

const installationTokenResponseSchema = z.object({
  token: z
    .string({ error: 'token must be a string' })
    .min(1, { error: 'token must not be empty' })
    .max(255, { error: 'token is longer than 255 characters' }),
  expires_at: z.iso.datetime({
    error: 'expires_at must be an ISO 8601 date-time',
  }),
});

interface TokenClientDeps {
  baseUrl: string;
  appId: number;
  key: KeyObject;
  clock: Clock;
  timeoutMs: number;
}

export const createTokenClient = ({ baseUrl, appId, key, clock, timeoutMs }: TokenClientDeps) => {
  const cache = new Map<
    number,
    Promise<{
      token: string;
      expiresAtMs: number;
    }>
  >();

  const startExchange = (
    installationId: number,
  ): Promise<{ token: string; expiresAtMs: number }> => {
    const fresh = exchange(installationId);
    cache.set(installationId, fresh);
    fresh.catch(() => cache.delete(installationId));
    return fresh;
  };

  const getToken = async (installationId: number): Promise<string> => {
    const cached = cache.get(installationId);
    if (cached === undefined) {
      return startExchange(installationId).then((f) => f.token);
    }
    const old = await cached;
    const current = cache.get(installationId);
    if (current === undefined) {
      return startExchange(installationId).then((f) => f.token);
    }
    if (current !== cached) {
      return current.then((f) => f.token);
    }
    if (clock.nowMs() > old.expiresAtMs - REFRESH_MARGIN_MS) {
      return startExchange(installationId).then((f) => f.token);
    }
    return cached.then((f) => f.token);
  };
  const exchange = async (
    installationId: number,
  ): Promise<{ token: string; expiresAtMs: number }> => {
    const jwtToken = createAppJwt(appId, key, clock);
    const targetUrl = `${baseUrl}/app/installations/${installationId}/access_tokens`;
    let response: Response;
    let body: unknown;

    try {
      response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwtToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: unknown) {
      if (err instanceof Error && (err.name === 'TypeError' || err.name === 'TimeoutError')) {
        throw new AppError({
          kind: 'upstream_unavailable',
          code: 'GITHUB_DID_NOT_RESPOND',
          message: `GitHub did not answer the token request for installation ${installationId}`,
        });
      } else {
        throw new AppError({
          kind: 'internal',
          code: 'INTERNAL_SERVER_ERROR',
          message: `Unexpected error during the token request for installation ${installationId}`,
          cause: err,
        });
      }
    }

    if (response.status === 401) {
      throw new AppError({
        kind: 'unauthenticated',
        code: 'GITHUB_APP_AUTH_REJECTED',
        message: `GitHub rejected the app JWT for installation ${installationId}`,
      });
    }

    if (response.status === 404) {
      throw new AppError({
        kind: 'not_found',
        code: 'GITHUB_INSTALLATION_NOT_FOUND',
        message: `Installation ${installationId} not found on GitHub`,
      });
    }

    if (response.status === 429) {
      throw new AppError({
        kind: 'upstream_unavailable',
        code: 'GITHUB_RATE_LIMITED',
        message: `GitHub rate-limited the token request for installation ${installationId} (status ${response.status})`,
      });
    }

    if (response.status === 403) {
      const isRateLimited =
        response.headers.get('retry-after') !== null ||
        response.headers.get('x-ratelimit-remaining') === '0';
      if (isRateLimited) {
        throw new AppError({
          kind: 'upstream_unavailable',
          code: 'GITHUB_RATE_LIMITED',
          message: `GitHub rate-limited the token request for installation ${installationId} (status ${response.status})`,
        });
      } else {
        throw new AppError({
          kind: 'internal',
          code: 'GITHUB_INSTALLATION_FORBIDDEN',
          message: `GitHub refused a token for installation ${installationId} (status ${response.status})`,
        });
      }
    }

    if (response.status >= 500) {
      throw new AppError({
        kind: 'upstream_unavailable',
        code: 'GITHUB_INTERNAL_ERROR',
        message: `GitHub returned ${response.status} for the token request for installation ${installationId}`,
      });
    }

    if (response.status !== 201) {
      throw new AppError({
        kind: 'internal',
        code: 'GITHUB_UNEXPECTED_STATUS',
        message: `GitHub returned ${response.status} for the token request for installation ${installationId}`,
      });
    }

    try {
      body = await response.json();
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.name === 'TimeoutError' || err.name === 'TypeError') {
          throw new AppError({
            kind: 'upstream_unavailable',
            code: 'GITHUB_DID_NOT_RESPOND',
            message: `GitHub did not answer the token request for installation ${installationId}`,
          });
        }
      }
      if (err instanceof SyntaxError) {
        throw new AppError({
          kind: 'internal',
          code: 'GITHUB_TOKEN_REPLY_NOT_JSON',
          message: `GitHub token reply for installation ${installationId} was not JSON`,
        });
      } else {
        throw new AppError({
          kind: 'internal',
          code: 'INTERNAL_SERVER_ERROR',
          message: `Unexpected error during parsing of response for installation ${installationId}`,
          cause: err,
        });
      }
    }

    const parsedBody = installationTokenResponseSchema.safeParse(body);

    if (!parsedBody.success) {
      throw new AppError({
        kind: 'internal',
        code: 'GITHUB_TOKEN_REPLY_INVALID',
        message: `GitHub token reply for installation ${installationId} failed validation`,
        cause: parsedBody.error,
      });
    }

    const { token, expires_at } = parsedBody.data;
    const expiresAtMs = Date.parse(expires_at);

    const timeLeft = expiresAtMs - clock.nowMs();
    if (timeLeft < REFRESH_MARGIN_MS) {
      throw new AppError({
        kind: 'internal',
        code: 'GITHUB_TOKEN_EXPIRES_TOO_SOON',
        message: `GitHub token for installation ${installationId} expires in under 5 minutes; check the server clock`,
      });
    }

    return { token, expiresAtMs };
  };

  return { getToken };
};
