const request = async (baseUrl: string, path: string, init: RequestInit): Promise<void> => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(2_000),
  });

  if (!response.ok) {
    throw new Error(
      `Toxiproxy ${init.method ?? 'GET'} ${path} failed with ${String(response.status)}`,
    );
  }
};

export const resetToxiproxy = (baseUrl: string): Promise<void> =>
  request(baseUrl, '/reset', { method: 'POST' });

export const stallResponses = (baseUrl: string, proxy: string): Promise<void> =>
  request(baseUrl, `/proxies/${proxy}/toxics`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'stall',
      type: 'timeout',
      stream: 'downstream',
      toxicity: 1,
      attributes: { timeout: 0 },
    }),
  });
