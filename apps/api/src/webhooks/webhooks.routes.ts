import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { requireRequestContext } from '../http/request-id.middleware.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '@scryguard/shared';
import * as z from 'zod';
import { parseRequest } from '../http/validation.js';

const pullRequestEventSchema = z.object({
  action: z.string(),
  pull_request: z.object({
    number: z.number().int().positive(),
  }),
  repository: z.object({
    full_name: z.string().min(1),
  }),
  installation: z.object({
    id: z.number().int().positive(),
  }),
});

const REVIEWED_ACTIONS = new Set(['opened', 'synchronize', 'reopened']);
const actionSchema = z.object({ action: z.string() });

const invalidSignature = () =>
  new AppError({
    kind: 'unauthenticated',
    code: 'INVALID_WEBHOOK_SIGNATURE',
    message: 'Webhook signature is invalid',
  });

export const createWebhooksRoutes = (webhookSecret: string, maxRequestSize: number) => {
  const router = Router();

  router.post(
    '/',
    express.raw({ type: 'application/json', limit: maxRequestSize }),
    (req: Request, res: Response, next: NextFunction) => {
      const rawBody: unknown = req.body;
      if (!Buffer.isBuffer(rawBody)) {
        next(
          new AppError({
            kind: 'unsupported_media_type',
            code: 'UNSUPPORTED_MEDIA_TYPE',
            message: 'Webhook body must be application/json',
          }),
        );

        return;
      }
      const signature = req.get('X-Hub-Signature-256');
      if (signature === undefined) {
        next(invalidSignature());
        return;
      }
      const prefix = 'sha256=';

      if (!signature.startsWith(prefix)) {
        next(invalidSignature());
        return;
      }

      const receivedSignature = signature.slice(prefix.length);

      const expectedSignature = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

      const expected = Buffer.from(expectedSignature);
      const received = Buffer.from(receivedSignature);

      if (expected.byteLength !== received.byteLength) {
        next(invalidSignature());

        return;
      }

      const signaturesMatch = timingSafeEqual(expected, received);

      if (!signaturesMatch) {
        next(invalidSignature());

        return;
      }

      const eventType = req.get('X-GitHub-Event');
      if (eventType === undefined) {
        next(
          new AppError({
            kind: 'invalid_input',
            code: 'MISSING_WEBHOOK_EVENT',
            message: 'X-GitHub-Event header is missing',
          }),
        );

        return;
      }

      if (eventType !== 'pull_request') {
        requireRequestContext(req).logger.info(
          {
            event: 'webhook_received',
            deliveryId: req.get('X-GitHub-Delivery'),
            githubEvent: eventType,
            outcome: 'ignored',
          },
          'Webhook ignored',
        );
        return res.sendStatus(204);
      }

      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(rawBody.toString('utf-8'));
      } catch {
        next(
          new AppError({
            kind: 'invalid_input',
            code: 'INVALID_JSON',
            message: 'Webhook body is not valid JSON',
          }),
        );

        return;
      }

      const { action } = parseRequest(actionSchema, parsedBody);
      if (!REVIEWED_ACTIONS.has(action)) {
        requireRequestContext(req).logger.info(
          {
            event: 'webhook_received',
            deliveryId: req.get('X-GitHub-Delivery'),
            githubEvent: eventType,
            action,
            outcome: 'ignored',
          },
          'Webhook ignored',
        );
        return res.sendStatus(204);
      }

      const payload = parseRequest(pullRequestEventSchema, parsedBody);

      requireRequestContext(req).logger.info(
        {
          event: 'webhook_received',
          deliveryId: req.get('X-GitHub-Delivery'),
          githubEvent: eventType,
          action,
          repository: payload.repository.full_name,
          prNumber: payload.pull_request.number,
          installationId: payload.installation.id,
          outcome: 'accepted',
        },
        'Webhook accepted for review',
      );

      return res.sendStatus(202);
    },
  );

  return router;
};
