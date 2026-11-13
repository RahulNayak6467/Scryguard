import { createServer, type IncomingHttpHeaders } from 'node:http';

export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

export type RespondReply = {
  kind: 'respond';
  status: number;
  headers: Record<string, string>;
  body: string;
  delayMs: number;
};

export type FakeReply =
  RespondReply | { kind: 'hang' } | { kind: 'drop' } | { kind: 'cut'; reply: RespondReply };

export interface FakeServer {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

export const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): RespondReply => ({
  kind: 'respond',
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  body: JSON.stringify(body),
  delayMs: 0,
});

export const text = (
  status: number,
  body: string,
  headers: Record<string, string> = {},
): RespondReply => ({
  kind: 'respond',
  status,
  headers: { 'content-type': 'text/plain; charset=utf-8', ...headers },
  body,
  delayMs: 0,
});

export const slow = (delayMs: number, reply: RespondReply): RespondReply => ({ ...reply, delayMs });

export const hang = (): FakeReply => ({ kind: 'hang' });

export const drop = (): FakeReply => ({ kind: 'drop' });

export const cutBody = (reply: RespondReply): FakeReply => ({ kind: 'cut', reply });

export const startFakeServer = async (
  route: (request: RecordedRequest) => FakeReply,
): Promise<FakeServer> => {
  const requests: RecordedRequest[] = [];
  const timers = new Set<NodeJS.Timeout>();

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const request: RecordedRequest = {
        method: req.method ?? '',
        path: new URL(req.url ?? '/', 'http://fake.local').pathname,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(request);

      let reply: FakeReply;
      try {
        reply = route(request);
      } catch (error) {
        reply = text(500, `Fake server route failed: ${String(error)}`);
      }

      if (reply.kind === 'hang') return;
      if (reply.kind === 'drop') {
        req.socket.destroy();
        return;
      }
      if (reply.kind === 'cut') {
        const full = Buffer.from(reply.reply.body, 'utf8');
        res.writeHead(reply.reply.status, {
          ...reply.reply.headers,
          'content-length': String(full.length),
        });
        res.write(full.subarray(0, Math.floor(full.length / 2)), () => req.socket.destroy());
        return;
      }

      const { status, headers, body, delayMs } = reply;
      const write = () => {
        if (!res.destroyed) res.writeHead(status, headers).end(body);
      };
      if (delayMs === 0) {
        write();
        return;
      }
      const timer = setTimeout(() => {
        timers.delete(timer);
        write();
      }, delayMs);
      timers.add(timer);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Fake server did not bind to a TCP port');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};
