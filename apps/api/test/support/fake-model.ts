import { randomUUID } from 'node:crypto';
import * as z from 'zod';
import {
  json,
  startFakeServer,
  text,
  type FakeReply,
  type FakeServer,
  type RespondReply,
} from './fake-http-server.js';

export interface FakeModel extends FakeServer {
  enqueue: (...replies: FakeReply[]) => void;
}

const COMPLETIONS_PATH = '/v1/chat/completions';

const chatRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(z.object({ role: z.string().min(1), content: z.string() })).min(1),
});

const completion = (content: string, finishReason = 'stop'): RespondReply => {
  const completionTokens = Math.ceil(content.length / 4);
  return json(200, {
    id: `chatcmpl-${randomUUID()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'fake-model',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }],
    usage: {
      prompt_tokens: 12,
      completion_tokens: completionTokens,
      total_tokens: 12 + completionTokens,
    },
  });
};

const modelError = (status: number, message: string, type: string) =>
  json(status, { error: { message, type, param: null, code: null } });

export const modelReplies = {
  content: (content: string): RespondReply => completion(content),
  json: (value: unknown): RespondReply => completion(JSON.stringify(value)),
  malformedJson: (): RespondReply => completion('{"summary": "The change looks'),
  wrongSchema: (): RespondReply => completion(JSON.stringify({ unexpected: 'shape' })),
  refusal: (): RespondReply => completion("I'm sorry, but I can't help with that request."),
  truncated: (): RespondReply => completion('{"summary": "The change', 'length'),
  serverError: (): RespondReply =>
    modelError(500, 'model runner has unexpectedly stopped', 'api_error'),
};

export const startFakeModel = async (options: { content?: string } = {}): Promise<FakeModel> => {
  const content = options.content ?? '{}';
  const queue: FakeReply[] = [];

  const server = await startFakeServer((request) => {
    if (request.method !== 'POST' || request.path !== COMPLETIONS_PATH) {
      return text(404, '404 page not found');
    }

    let body: unknown;
    try {
      body = JSON.parse(request.body);
    } catch {
      return modelError(400, 'invalid character in request body', 'invalid_request_error');
    }
    if (!chatRequestSchema.safeParse(body).success) {
      return modelError(
        400,
        'model and at least one message are required',
        'invalid_request_error',
      );
    }

    return queue.shift() ?? completion(content);
  });

  return {
    ...server,
    enqueue: (...replies) => {
      queue.push(...replies);
    },
  };
};
