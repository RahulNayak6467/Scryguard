import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { systemClock } from '@scryguard/shared';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { captureLogs, silentLogger } from '../../test/support/capture-logs.js';
import type { ReadinessChecker } from '../health/readiness.js';
import { createApp, MAX_REQUEST_BODY_BYTES } from '../http/app.js';
import { REQUEST_ID_HEADER } from '../http/request-id.middleware.js';

const WEBHOOK_SECRET = 'test-webhook-secret-0123456789abcdef';
const WEBHOOK_PATH = '/webhooks/github';

const ready: ReadinessChecker = () => Promise.resolve({ status: 'ready' });

const createTestApp = (logger = silentLogger()) =>
  createApp({
    logger,
    clock: systemClock,
    checkReadiness: ready,
    isDraining: () => false,
    webhookSecret: WEBHOOK_SECRET,
  });

const hmacHex = (body: Buffer) => createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

const sign = (body: Buffer) => `sha256=${hmacHex(body)}`;

// Indented, so a signature checked over re-serialised JSON instead of the raw bytes fails.
const pullRequestBody = (overrides: Record<string, unknown> = {}) =>
  Buffer.from(
    JSON.stringify(
      {
        action: 'opened',
        pull_request: { number: 42, title: 'pr-title-marker-7f3a' },
        repository: { full_name: 'acme/widgets' },
        installation: { id: 1001 },
        ...overrides,
      },
      null,
      2,
    ),
  );

interface DeliveryOptions {
  readonly body: Buffer;
  readonly signature?: string | undefined;
  readonly event?: string | undefined;
  readonly app?: ReturnType<typeof createTestApp>;
}

const deliver = ({ body, signature, event, app = createTestApp() }: DeliveryOptions) => {
  let req = request(app)
    .post(WEBHOOK_PATH)
    .set('content-type', 'application/json')
    .set('x-github-delivery', 'delivery-1');
  if (signature !== undefined) req = req.set('x-hub-signature-256', signature);
  if (event !== undefined) req = req.set('x-github-event', event);
  // superagent JSON-encodes a Buffer under application/json; a string goes out byte for byte.
  return req.send(body.toString('utf8'));
};

const deliverSigned = (body: Buffer, event = 'pull_request') =>
  deliver({ body, signature: sign(body), event });

const envelope = (response: request.Response, code: string, message: string) => ({
  error: { code, message, requestId: response.headers[REQUEST_ID_HEADER], retryable: false },
});

const expectInvalidSignature = (response: request.Response) => {
  expect(response.status).toBe(401);
  expect(response.body).toEqual(
    envelope(response, 'INVALID_WEBHOOK_SIGNATURE', 'Webhook signature is invalid'),
  );
};

describe('github webhook route', () => {
  describe('signature check', () => {
    it('rejects a delivery without a signature header with 401', async () => {
      const response = await deliver({ body: pullRequestBody(), event: 'pull_request' });

      expectInvalidSignature(response);
    });

    it('rejects a signature without the sha256= prefix with 401', async () => {
      const body = pullRequestBody();

      const response = await deliver({ body, signature: hmacHex(body), event: 'pull_request' });

      expectInvalidSignature(response);
    });

    it('rejects a signature of a different length with 401', async () => {
      const body = pullRequestBody();

      const response = await deliver({
        body,
        signature: `sha256=${hmacHex(body).slice(0, 63)}`,
        event: 'pull_request',
      });

      expectInvalidSignature(response);
    });

    it('rejects a body changed by one byte after signing with 401', async () => {
      const signed = pullRequestBody();
      const tampered = Buffer.from(signed);
      tampered[tampered.indexOf('42')] = '7'.charCodeAt(0);

      const response = await deliver({
        body: tampered,
        signature: sign(signed),
        event: 'pull_request',
      });

      expectInvalidSignature(response);
    });

    it('rejects a 64-character signature that is 65 bytes long with 401, not 500', async () => {
      const response = await deliver({
        body: pullRequestBody(),
        signature: `sha256=${'a'.repeat(63)}é`,
        event: 'pull_request',
      });

      expectInvalidSignature(response);
    });
  });

  describe('event routing', () => {
    it('rejects a signed delivery without X-GitHub-Event with 400', async () => {
      const body = pullRequestBody();

      const response = await deliver({ body, signature: sign(body) });

      expect(response.status).toBe(400);
      expect(response.body).toEqual(
        envelope(response, 'MISSING_WEBHOOK_EVENT', 'X-GitHub-Event header is missing'),
      );
    });

    it.each([
      ['ping', Buffer.from(JSON.stringify({ zen: 'Keep it logically awesome.', hook_id: 1 }))],
      ['push', Buffer.from(JSON.stringify({ ref: 'refs/heads/main' }))],
    ])('ignores a signed %s event with 204 and an empty body', async (event, body) => {
      const response = await deliverSigned(body, event);

      expect(response.status).toBe(204);
      expect(response.text).toBe('');
    });

    it('rejects a signed pull_request body that is not valid JSON with 400', async () => {
      const response = await deliverSigned(Buffer.from('{"action": "opened",'));

      expect(response.status).toBe(400);
      expect(response.body).toEqual(
        envelope(response, 'INVALID_JSON', 'Webhook body is not valid JSON'),
      );
    });

    it('ignores a signed pull_request closed action with 204', async () => {
      const response = await deliverSigned(pullRequestBody({ action: 'closed' }));

      expect(response.status).toBe(204);
      expect(response.text).toBe('');
    });

    it.each(['opened', 'synchronize', 'reopened'])(
      'accepts a signed pull_request %s action with 202',
      async (action) => {
        const response = await deliverSigned(pullRequestBody({ action }));

        expect(response.status).toBe(202);
      },
    );

    it('ignores a signed closed action without installation with 204, before the full schema', async () => {
      const response = await deliverSigned(
        pullRequestBody({ action: 'closed', installation: undefined }),
      );

      expect(response.status).toBe(204);
      expect(response.text).toBe('');
    });

    it('rejects a signed opened action without installation with 400 INVALID_INPUT', async () => {
      const anyMessage: unknown = expect.any(String);

      const response = await deliverSigned(pullRequestBody({ installation: undefined }));

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: {
          code: 'INVALID_INPUT',
          message: 'Request validation failed',
          requestId: response.headers[REQUEST_ID_HEADER],
          retryable: false,
          issues: [{ path: 'installation', message: anyMessage }],
        },
      });
    });
  });

  describe('body size', () => {
    const servers: http.Server[] = [];

    afterEach(async () => {
      for (const server of servers.splice(0)) {
        server.closeAllConnections();
        server.close();
        await once(server, 'close');
      }
    });

    const listen = async () => {
      const server = http.createServer(createTestApp());
      servers.push(server);
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const { port } = server.address() as AddressInfo;
      return port;
    };

    it('rejects a declared Content-Length over the limit with 413', async () => {
      const response = await request(createTestApp())
        .post(WEBHOOK_PATH)
        .set('content-type', 'application/json')
        .set('content-length', String(MAX_REQUEST_BODY_BYTES + 1))
        .set('x-github-event', 'pull_request')
        .send('{}');

      expect(response.status).toBe(413);
      expect(response.body).toEqual(
        envelope(response, 'PAYLOAD_TOO_LARGE', 'Request body is too large'),
      );
    });

    it('accepts a signed 200 kB opened body with 202, above the 100 kB parser default', async () => {
      const body = pullRequestBody({ padding: 'x'.repeat(200 * 1024) });

      const response = await deliverSigned(body);

      expect(body.length).toBeGreaterThan(200 * 1024);
      expect(body.length).toBeLessThan(MAX_REQUEST_BODY_BYTES);
      expect(response.status).toBe(202);
    });

    it('rejects a signed chunked body over the limit with 413', async () => {
      const port = await listen();
      const padding = 'x'.repeat(MAX_REQUEST_BODY_BYTES);
      const body = pullRequestBody({ padding });
      const req = http.request({
        port,
        host: '127.0.0.1',
        method: 'POST',
        path: WEBHOOK_PATH,
        headers: {
          'content-type': 'application/json',
          'transfer-encoding': 'chunked',
          'x-github-event': 'pull_request',
          'x-hub-signature-256': sign(body),
        },
      });
      req.on('error', () => undefined);
      const answer = new Promise<{ status: number | undefined; text: string }>((resolve) => {
        req.once('response', (res: http.IncomingMessage) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () =>
            resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }),
          );
        });
      });

      for (let offset = 0; offset < body.length; offset += 64 * 1024) {
        if (!req.write(body.subarray(offset, offset + 64 * 1024))) await once(req, 'drain');
      }
      req.end();
      const { status, text } = await answer;

      expect(status).toBe(413);
      expect(JSON.parse(text)).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
    });
  });

  describe('logging', () => {
    const secretsIn = (body: Buffer, signature: string) => [
      body.toString('utf8'),
      'pr-title-marker-7f3a',
      signature,
      signature.slice('sha256='.length),
      WEBHOOK_SECRET,
    ];

    it('logs an accepted delivery without the body, signature or secret', async () => {
      const logs = captureLogs();
      const body = pullRequestBody();
      const signature = sign(body);

      const response = await deliver({
        body,
        signature,
        event: 'pull_request',
        app: createTestApp(logs.logger),
      });

      expect(response.status).toBe(202);
      expect(logs.records()).toContainEqual(
        expect.objectContaining({
          event: 'webhook_received',
          deliveryId: 'delivery-1',
          githubEvent: 'pull_request',
          action: 'opened',
          repository: 'acme/widgets',
          prNumber: 42,
          installationId: 1001,
          outcome: 'accepted',
        }),
      );
      for (const leaked of secretsIn(body, signature)) {
        expect(logs.raw()).not.toContain(leaked);
      }
    });

    it('logs a rejected signature without the body, signature or secret', async () => {
      const logs = captureLogs();
      const body = pullRequestBody();
      const signature = `sha256=${createHmac('sha256', 'wrong-secret-0123456789abcdefghij').update(body).digest('hex')}`;

      const response = await deliver({
        body,
        signature,
        event: 'pull_request',
        app: createTestApp(logs.logger),
      });

      expectInvalidSignature(response);
      expect(logs.records()).toContainEqual(
        expect.objectContaining({
          event: 'http_request_completed',
          statusCode: 401,
          errorCode: 'INVALID_WEBHOOK_SIGNATURE',
        }),
      );
      for (const leaked of secretsIn(body, signature)) {
        expect(logs.raw()).not.toContain(leaked);
      }
    });
  });
});
