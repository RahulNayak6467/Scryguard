import { afterEach, describe, expect, it } from 'vitest';
import * as z from 'zod';
import { drop, hang, slow } from '../support/fake-http-server.js';
import {
  githubReplies,
  SAMPLE_DIFF,
  startFakeGitHub,
  type FakeGitHub,
} from '../support/fake-github.js';
import { modelReplies, startFakeModel, type FakeModel } from '../support/fake-model.js';

const servers: { close: () => Promise<void> }[] = [];

const github = async (options?: { diff?: string }): Promise<FakeGitHub> => {
  const fake = await startFakeGitHub(options);
  servers.push(fake);
  return fake;
};

const model = async (options?: { content?: string }): Promise<FakeModel> => {
  const fake = await startFakeModel(options);
  servers.push(fake);
  return fake;
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const tokenResponseSchema = z.object({
  token: z.string().regex(/^ghs_\w{36}$/),
  expires_at: z.iso.datetime(),
});
const checkRunResponseSchema = z.object({ id: z.number().int().positive() });
const completionResponseSchema = z.object({
  choices: z.tuple([
    z.object({ message: z.object({ content: z.string() }), finish_reason: z.string() }),
  ]),
});

const createInstallationToken = async (fake: FakeGitHub): Promise<string> => {
  const response = await fetch(`${fake.url}/app/installations/42/access_tokens`, {
    method: 'POST',
    headers: { authorization: 'Bearer fake.app.jwt' },
  });
  expect(response.status).toBe(201);
  return tokenResponseSchema.parse(await response.json()).token;
};

const createCheckRun = (fake: FakeGitHub, token: string, body: unknown) =>
  fetch(`${fake.url}/repos/octo/playground/check-runs`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const chat = (
  fake: FakeModel,
  body: unknown = { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
) =>
  fetch(`${fake.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const contentOf = async (response: Response): Promise<string> =>
  completionResponseSchema.parse(await response.json()).choices[0].message.content;

describe('fake GitHub API', () => {
  it('issues a token that authorizes a Check Run created in progress and then completed', async () => {
    const fake = await github();
    const token = await createInstallationToken(fake);

    const created = await createCheckRun(fake, token, {
      name: 'Scryguard',
      head_sha: 'abc123',
      status: 'in_progress',
    });
    expect(created.status).toBe(201);
    const { id } = checkRunResponseSchema.parse(await created.json());

    const updated = await fetch(`${fake.url}/repos/octo/playground/check-runs/${id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ conclusion: 'neutral', output: { title: 't', summary: 's' } }),
    });

    expect(updated.status).toBe(200);
    expect(fake.checkRuns()).toEqual([
      {
        id,
        repository: 'octo/playground',
        name: 'Scryguard',
        head_sha: 'abc123',
        status: 'completed',
        conclusion: 'neutral',
        output: { title: 't', summary: 's' },
      },
    ]);
  });

  it('rejects a token it never issued with 401', async () => {
    const fake = await github();

    const response = await createCheckRun(fake, `ghs_${'x'.repeat(36)}`, {
      name: 'Scryguard',
      head_sha: 'abc123',
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ message: 'Bad credentials' });
  });

  it('rejects a token exchange without an app JWT with 401', async () => {
    const fake = await github();

    const response = await fetch(`${fake.url}/app/installations/42/access_tokens`, {
      method: 'POST',
    });

    expect(response.status).toBe(401);
  });

  it('serves the configured diff for the diff media type', async () => {
    const fake = await github({ diff: 'diff --git a/x b/x\n' });

    const response = await fetch(`${fake.url}/repos/octo/playground/pulls/7`, {
      headers: {
        authorization: `token ${fake.issueToken()}`,
        accept: 'application/vnd.github.diff',
      },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('diff --git a/x b/x\n');
  });

  it('serves a sample diff by default', async () => {
    const fake = await github();

    const response = await fetch(`${fake.url}/repos/octo/playground/pulls/7`, {
      headers: {
        authorization: `token ${fake.issueToken()}`,
        accept: 'application/vnd.github.diff',
      },
    });

    expect(await response.text()).toBe(SAMPLE_DIFF);
  });

  it('returns 422 for a Check Run without a head SHA or completed without a conclusion', async () => {
    const fake = await github();
    const token = fake.issueToken();

    const missingSha = await createCheckRun(fake, token, { name: 'Scryguard' });
    const noConclusion = await createCheckRun(fake, token, {
      name: 'Scryguard',
      head_sha: 'abc123',
      status: 'completed',
    });

    expect(missingSha.status).toBe(422);
    expect(noConclusion.status).toBe(422);
    expect(fake.checkRuns()).toEqual([]);
  });

  it('returns 404 when updating a Check Run that does not exist', async () => {
    const fake = await github();

    const response = await fetch(`${fake.url}/repos/octo/playground/check-runs/999`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${fake.issueToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ conclusion: 'neutral' }),
    });

    expect(response.status).toBe(404);
  });

  it('plays a queued failure once, then returns to the normal reply', async () => {
    const fake = await github();
    const token = fake.issueToken();
    fake.enqueue('createCheckRun', githubReplies.unauthorized());

    const first = await createCheckRun(fake, token, { name: 'Scryguard', head_sha: 'abc123' });
    const second = await createCheckRun(fake, token, { name: 'Scryguard', head_sha: 'abc123' });

    expect(first.status).toBe(401);
    expect(second.status).toBe(201);
  });

  it('sends the rate-limit headers GitHub sends', async () => {
    const fake = await github();
    fake.enqueue(
      'createCheckRun',
      githubReplies.rateLimited(1_900_000_000),
      githubReplies.secondaryRateLimited(30),
    );
    const token = fake.issueToken();

    const primary = await createCheckRun(fake, token, { name: 'Scryguard', head_sha: 'abc123' });
    const secondary = await createCheckRun(fake, token, { name: 'Scryguard', head_sha: 'abc123' });

    expect(primary.status).toBe(403);
    expect(primary.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(primary.headers.get('x-ratelimit-reset')).toBe('1900000000');
    expect(secondary.status).toBe(429);
    expect(secondary.headers.get('retry-after')).toBe('30');
  });

  it('records every request it receives', async () => {
    const fake = await github();
    const token = await createInstallationToken(fake);

    await createCheckRun(fake, token, { name: 'Scryguard', head_sha: 'abc123' });

    expect(fake.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST /app/installations/42/access_tokens',
      'POST /repos/octo/playground/check-runs',
    ]);
    expect(JSON.parse(fake.requests[1]?.body ?? '')).toEqual({
      name: 'Scryguard',
      head_sha: 'abc123',
    });
  });
});

describe('fake model server', () => {
  it('answers in the OpenAI chat completion shape with the configured content', async () => {
    const fake = await model({ content: '{"summary":"ok"}' });

    const response = await chat(fake);

    expect(response.status).toBe(200);
    expect(await contentOf(response)).toBe('{"summary":"ok"}');
  });

  it('plays the broken replies a real model can give', async () => {
    const fake = await model();
    fake.enqueue(modelReplies.malformedJson(), modelReplies.wrongSchema(), modelReplies.refusal());

    const malformed = await contentOf(await chat(fake));
    const wrongShape = await contentOf(await chat(fake));
    const refusal = await contentOf(await chat(fake));

    const parse = (content: string): unknown => JSON.parse(content);
    expect(() => parse(malformed)).toThrow(SyntaxError);
    expect(parse(wrongShape)).toEqual({ unexpected: 'shape' });
    expect(() => parse(refusal)).toThrow(SyntaxError);
  });

  it('marks a truncated answer with finish_reason length', async () => {
    const fake = await model();
    fake.enqueue(modelReplies.truncated());

    const body = completionResponseSchema.parse(await (await chat(fake)).json());

    expect(body.choices[0].finish_reason).toBe('length');
  });

  it('returns 500 for a server error and 400 for a request without messages', async () => {
    const fake = await model();
    fake.enqueue(modelReplies.serverError());

    const failed = await chat(fake);
    const invalid = await chat(fake, { model: 'm', messages: [] });

    expect(failed.status).toBe(500);
    expect(invalid.status).toBe(400);
  });

  it('delays a slow reply by at least the given time', async () => {
    const fake = await model();
    fake.enqueue(slow(150, modelReplies.content('late')));

    const startedAt = performance.now();
    const content = await contentOf(await chat(fake));

    expect(content).toBe('late');
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(140);
  });

  it('never answers a hung request, so the caller times out', async () => {
    const fake = await model();
    fake.enqueue(hang());

    const request = fetch(`${fake.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
      signal: AbortSignal.timeout(100),
    });

    await expect(request).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('drops the connection without a reply', async () => {
    const fake = await model();
    fake.enqueue(drop());

    await expect(chat(fake)).rejects.toThrow(TypeError);
  });

  it('closes promptly while a request is still hanging', async () => {
    const fake = await startFakeModel();
    fake.enqueue(hang());
    const pending = chat(fake).catch((error: unknown) => error);
    await expect.poll(() => fake.requests.length).toBe(1);

    const startedAt = performance.now();
    await fake.close();

    expect(performance.now() - startedAt).toBeLessThan(500);
    expect(await pending).toBeInstanceOf(TypeError);
  });
});
