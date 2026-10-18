/** Small fetch wrapper: JSON in/out, readable errors, retries on 429/5xx. */
export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status: number,
    message: string,
  ) {
    super(`${provider} ${status}: ${message}`);
    this.name = 'ProviderError';
  }
}

export async function http<T>(
  provider: string,
  url: string,
  init: RequestInit & { json?: unknown; retries?: number } = {},
): Promise<T> {
  const { json, retries = 2, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (json !== undefined) headers.set('content-type', 'application/json');
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body });
    if (res.ok) {
      const type = res.headers.get('content-type') ?? '';
      return (type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer())) as T;
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < retries) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 500 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, Math.min(wait, 10_000)));
      continue;
    }
    throw new ProviderError(provider, res.status, (await res.text()).slice(0, 500));
  }
}
