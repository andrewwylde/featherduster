import { expect, it, vi } from 'vitest';
import http from 'node:http';
import { fetchCapturedResource } from '../../../scripts/automatic-resume-http.mjs';

it('closes fixture connections across child-process boundaries while retaining headers and payloads', async () => {
  const requests: { method?: string; connection?: string; token?: string; body: string }[] = [];
  const server = http.createServer(async (request, response) => {
    let body = ''; for await (const part of request) body += part;
    requests.push({ method: request.method, connection: request.headers.connection, token: request.headers['x-fixture-token'] as string, body });
    response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ received: true }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    const response = await fetchCapturedResource(origin, '/mutation', { method: 'POST', headers: { connection: 'keep-alive', 'x-fixture-token': 'owned-host' }, body: '{"intent":"once"}' });
    expect(await response.json()).toEqual({ received: true });
    expect(requests).toEqual([{ method: 'POST', connection: 'close', token: 'owned-host', body: '{"intent":"once"}' }]);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

it('does not replay a mutation after a real connection reset and retains the endpoint in diagnostics', async () => {
  let writes = 0;
  const server = http.createServer(async (request) => {
    for await (const _part of request) { /* consume the request before dropping its ambiguous response */ }
    writes++; request.socket.resetAndDestroy();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    await expect(fetchCapturedResource(origin, '/approval', { method: 'POST', body: '{"key":"same-intent"}' })).rejects.toThrow(/POST .*\/approval failed .*request not replayed/);
    expect(writes).toBe(1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

it('rejects substitution of a different deployment before sending a request', async () => {
  const fetcher = vi.fn();
  await expect(fetchCapturedResource('http://127.0.0.1:49100', 'http://127.0.0.1:49101/identity', {}, fetcher)).rejects.toThrow(/Captured loopback origin/);
  expect(fetcher).not.toHaveBeenCalled();
});
