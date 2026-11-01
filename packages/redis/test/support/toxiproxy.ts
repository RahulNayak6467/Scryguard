interface Toxic {
  readonly name: string;
  readonly type: 'latency' | 'timeout';
  readonly stream: 'upstream' | 'downstream';
  readonly attributes: Readonly<Record<string, number>>;
}

const send = async (
  baseUrl: string,
  method: 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<void> => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(2_000),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    throw new Error(`Toxiproxy ${method} ${path} failed with ${String(response.status)}`);
  }
};

export const createToxiproxy = (baseUrl: string) => ({
  reset: (): Promise<void> => send(baseUrl, 'POST', '/reset'),
  addRedisToxic: (toxic: Toxic): Promise<void> =>
    send(baseUrl, 'POST', '/proxies/redis/toxics', toxic),
  removeRedisToxic: (name: string): Promise<void> =>
    send(baseUrl, 'DELETE', `/proxies/redis/toxics/${name}`),
});
