import * as z from 'zod';
import {
  json,
  startFakeServer,
  text,
  type FakeReply,
  type FakeServer,
  type RecordedRequest,
  type RespondReply,
} from './fake-http-server.js';

export type GitHubRoute =
  'createInstallationToken' | 'getPullRequestDiff' | 'createCheckRun' | 'updateCheckRun';

export interface FakeCheckRun {
  id: number;
  repository: string;
  name: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  output: unknown;
}

export interface FakeGitHub extends FakeServer {
  enqueue: (route: GitHubRoute, ...replies: FakeReply[]) => void;
  issueToken: () => string;
  checkRuns: () => FakeCheckRun[];
}

export const SAMPLE_DIFF = [
  'diff --git a/src/sum.ts b/src/sum.ts',
  'index 3b18e51..a1c2d3f 100644',
  '--- a/src/sum.ts',
  '+++ b/src/sum.ts',
  '@@ -1,3 +1,3 @@',
  ' export const sum = (a: number, b: number) => {',
  '-  return a + b;',
  '+  return a - b;',
  ' };',
  '',
].join('\n');

const githubError = (status: number, message: string, headers: Record<string, string> = {}) =>
  json(
    status,
    { message, documentation_url: 'https://docs.github.com/rest', status: String(status) },
    headers,
  );

export const githubReplies = {
  unauthorized: (): RespondReply => githubError(401, 'Bad credentials'),
  notFound: (): RespondReply => githubError(404, 'Not Found'),
  unprocessable: (): RespondReply => githubError(422, 'Validation Failed'),
  rateLimited: (resetEpochSeconds = Math.floor(Date.now() / 1000) + 60): RespondReply =>
    githubError(403, 'API rate limit exceeded for installation.', {
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(resetEpochSeconds),
    }),
  secondaryRateLimited: (retryAfterSeconds = 30): RespondReply =>
    githubError(429, 'You have exceeded a secondary rate limit.', {
      'retry-after': String(retryAfterSeconds),
    }),
  serverError: (): RespondReply => githubError(500, 'Server Error'),
};

const ROUTES = [
  {
    name: 'createInstallationToken',
    method: 'POST',
    pattern: /^\/app\/installations\/\d+\/access_tokens$/,
  },
  { name: 'getPullRequestDiff', method: 'GET', pattern: /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+$/ },
  { name: 'createCheckRun', method: 'POST', pattern: /^\/repos\/([^/]+\/[^/]+)\/check-runs$/ },
  {
    name: 'updateCheckRun',
    method: 'PATCH',
    pattern: /^\/repos\/([^/]+\/[^/]+)\/check-runs\/(\d+)$/,
  },
] as const;

const CHECK_RUN_STATUSES = ['queued', 'in_progress', 'completed'] as const;
const CHECK_RUN_CONCLUSIONS = [
  'action_required',
  'cancelled',
  'failure',
  'neutral',
  'success',
  'skipped',
  'timed_out',
] as const;

const createCheckRunSchema = z.object({
  name: z.string().min(1),
  head_sha: z.string().min(1),
  status: z.enum(CHECK_RUN_STATUSES).optional(),
  conclusion: z.enum(CHECK_RUN_CONCLUSIONS).optional(),
  output: z.unknown().optional(),
});

const updateCheckRunSchema = z.object({
  status: z.enum(CHECK_RUN_STATUSES).optional(),
  conclusion: z.enum(CHECK_RUN_CONCLUSIONS).optional(),
  output: z.unknown().optional(),
});

const TOKEN_TTL_MS = 60 * 60 * 1000;

const parseJsonBody = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
};

export const startFakeGitHub = async (options: { diff?: string } = {}): Promise<FakeGitHub> => {
  const diff = options.diff ?? SAMPLE_DIFF;
  const queues = new Map<GitHubRoute, FakeReply[]>();
  const issuedTokens = new Set<string>();
  const checkRuns = new Map<number, FakeCheckRun>();
  let tokenCount = 0;
  let checkRunCount = 0;

  const issueToken = () => {
    tokenCount += 1;
    const token = `ghs_${String(tokenCount).padStart(36, '0')}`;
    issuedTokens.add(token);
    return token;
  };

  const hasIssuedToken = (request: RecordedRequest) => {
    const match = /^(?:token|Bearer) (\S+)$/.exec(request.headers.authorization ?? '');
    return match?.[1] !== undefined && issuedTokens.has(match[1]);
  };

  const defaultReply = (
    route: GitHubRoute,
    request: RecordedRequest,
    params: string[],
  ): FakeReply => {
    if (route === 'createInstallationToken') {
      if (!/^Bearer \S+$/.test(request.headers.authorization ?? '')) {
        return githubReplies.unauthorized();
      }
      return json(201, {
        token: issueToken(),
        expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
      });
    }

    if (!hasIssuedToken(request)) return githubReplies.unauthorized();

    if (route === 'getPullRequestDiff') {
      if (!(request.headers.accept ?? '').includes('application/vnd.github.diff')) {
        return githubError(415, 'This fake only serves the diff media type');
      }
      return text(200, diff, { 'content-type': 'application/vnd.github.diff; charset=utf-8' });
    }

    const repository = params[0] ?? '';

    if (route === 'createCheckRun') {
      const parsed = createCheckRunSchema.safeParse(parseJsonBody(request.body));
      if (!parsed.success) return githubReplies.unprocessable();
      if (parsed.data.status === 'completed' && parsed.data.conclusion === undefined) {
        return githubReplies.unprocessable();
      }
      checkRunCount += 1;
      const checkRun: FakeCheckRun = {
        id: checkRunCount,
        repository,
        name: parsed.data.name,
        head_sha: parsed.data.head_sha,
        status:
          parsed.data.conclusion === undefined ? (parsed.data.status ?? 'queued') : 'completed',
        conclusion: parsed.data.conclusion ?? null,
        output: parsed.data.output ?? null,
      };
      checkRuns.set(checkRun.id, checkRun);
      return json(201, checkRun);
    }

    const existing = checkRuns.get(Number(params[1]));
    if (existing === undefined || existing.repository !== repository) {
      return githubReplies.notFound();
    }
    const parsed = updateCheckRunSchema.safeParse(parseJsonBody(request.body));
    if (!parsed.success) return githubReplies.unprocessable();
    if (parsed.data.status === 'completed' && parsed.data.conclusion === undefined) {
      return githubReplies.unprocessable();
    }
    const updated: FakeCheckRun = {
      ...existing,
      status:
        parsed.data.conclusion === undefined
          ? (parsed.data.status ?? existing.status)
          : 'completed',
      conclusion: parsed.data.conclusion ?? existing.conclusion,
      output: parsed.data.output ?? existing.output,
    };
    checkRuns.set(updated.id, updated);
    return json(200, updated);
  };

  const server = await startFakeServer((request) => {
    for (const route of ROUTES) {
      const match = route.pattern.exec(request.path);
      if (match === null || request.method !== route.method) continue;
      const queued = queues.get(route.name)?.shift();
      return queued ?? defaultReply(route.name, request, match.slice(1));
    }
    return githubReplies.notFound();
  });

  return {
    ...server,
    enqueue: (route, ...replies) => {
      queues.set(route, [...(queues.get(route) ?? []), ...replies]);
    },
    issueToken,
    checkRuns: () => [...checkRuns.values()].map((checkRun) => ({ ...checkRun })),
  };
};
