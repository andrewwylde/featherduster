import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from 'node:http';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:net';
import { chromium, type Route } from 'playwright';
import { createPostingProxy, fetchPostingInBrowser } from '../src/jobs/posting-browser.js';
import { extractPosting } from '../src/jobs/posting-extractor.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); vi.restoreAllMocks(); });
async function proxy(resolve: NonNullable<Parameters<typeof createPostingProxy>[0]>['resolve']) {
  const connect = vi.fn(() => {
    const socket = new PassThrough();
    Object.assign(socket, { setTimeout: vi.fn() });
    queueMicrotask(() => socket.emit('connect'));
    return socket;
  });
  const server = await createPostingProxy({ resolve, connect: connect as any });
  cleanup.push(server.close);
  return { ...server, connect };
}
function tunnel(server: string, destination: string) {
  return new Promise<number>((resolve, reject) => {
    const req = request(server, { method: 'CONNECT', path: destination });
    req.on('connect', (response, socket) => { resolve(response.statusCode!); socket.destroy(); });
    req.on('error', reject); req.end();
  });
}
describe('browser posting network boundary', () => {
  it.each(['127.0.0.1:443', '[::1]:443', '169.254.169.254:443', 'public.example:444', 'user@public.example:443'])('rejects unsafe CONNECT destination %s', async destination => {
    const p = await proxy(async () => [{ address: '8.8.8.8', family: 4 }]);
    expect(await tunnel(p.url, destination)).toBe(403);
    expect(p.connect).not.toHaveBeenCalled();
  });
  it('rejects mixed DNS and revalidates subsequent connections after a DNS change', async () => {
    const resolve = vi.fn().mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]).mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]);
    const p = await proxy(resolve);
    expect(await tunnel(p.url, 'public.example:443')).toBe(200);
    expect(p.connect).toHaveBeenCalledExactlyOnceWith({ host: '8.8.8.8', port: 443, family: 4 });
    expect(await tunnel(p.url, 'public.example:443')).toBe(403);
    expect(p.connect).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledTimes(2);
  });
  it('rejects DNS errors and does not forward plaintext HTTP', async () => {
    const p = await proxy(async () => { throw new Error('DNS'); });
    expect(await tunnel(p.url, 'public.example:443')).toBe(403);
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(p.url, { path: 'http://public.example/' }, res => { res.resume(); resolve(res.statusCode!); });
      req.on('error', reject); req.end();
    });
    expect(status).toBe(403); expect(p.connect).not.toHaveBeenCalled();
  });
});

function browserFixture(fulfill: (route: Route) => Promise<void>) {
  const launch = chromium.launch.bind(chromium);
  const state = { disconnected: false };
  vi.spyOn(chromium, 'launch').mockImplementation(async options => {
    // The deterministic fixture needs no remote site or desktop window. Keep
    // the production proxy/network policy; only fulfill this one public URL.
    const browser = await launch({ ...options, headless: true });
    browser.on('disconnected', () => { state.disconnected = true; });
    const newContext = browser.newContext.bind(browser);
    vi.spyOn(browser, 'newContext').mockImplementation(async options => {
      const context = await newContext(options), route = context.route.bind(context);
      vi.spyOn(context, 'route').mockImplementation(async (pattern, handler, options) => {
        await route(pattern, handler, options);
        await route('https://8.8.8.8/role', fulfill);
      });
      return context;
    });
    return browser;
  });
  return state;
}
it.each(['Loading...', 'Careers navigation and company information. '.repeat(12), '<h1>Platform Engineer</h1><p>Loading...</p>'])('waits for the actual JS-rendered posting beyond its shell (%s)', async shell => {
  const state = browserFixture(r => r.fulfill({ contentType: 'text/html', body: `<main>${shell}</main><script>setTimeout(() => { document.querySelector('main').innerHTML = '<h1>Platform Engineer</h1><p>${'Build and operate public services. '.repeat(12)}</p>'; }, 750)</script>` }));
  const result = await fetchPostingInBrowser('https://8.8.8.8/role');
  expect(extractPosting(result.html, result.final_url).role).toBe('Platform Engineer');
  expect(extractPosting(result.html, result.final_url).text).toContain('Build and operate public services.');
  expect(result.final_url).toBe('https://8.8.8.8/role');
  expect(state.disconnected).toBe(true);
}, 15000);
it('prevents real Chromium redirects from connecting to a local service', async () => {
  let connections = 0;
  const local = createServer(socket => { connections++; socket.destroy(); });
  await new Promise<void>(resolve => local.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => local.close(() => resolve())));
  const port = (local.address() as { port: number }).port;
  browserFixture(r => r.fulfill({ status: 302, headers: { location: `https://127.0.0.1:${port}/private` } }));
  await expect(fetchPostingInBrowser('https://8.8.8.8/role')).rejects.toThrow();
  expect(connections).toBe(0);
}, 15000);
it('reports an unfinished rendered shell as extraction failure, not network failure', async () => {
  const state = browserFixture(r => r.fulfill({ contentType: 'text/html', body: `<main>${'Careers navigation. '.repeat(20)}</main>` }));
  await expect(fetchPostingInBrowser('https://8.8.8.8/role')).rejects.toMatchObject({ code: 'extraction_failed' });
  expect(state.disconnected).toBe(true);
}, 15000);
