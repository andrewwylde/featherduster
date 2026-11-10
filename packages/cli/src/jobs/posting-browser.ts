import { createServer } from 'node:http';
import { connect, type Socket } from 'node:net';
import type { Browser } from 'playwright';
import { canonicalizeJobUrl } from '@featherduster/core';
import { MAX_POSTING_BYTES, PostingFetchError, postingAddress, type FetchOptions, type PostingFetchResult } from './posting-fetcher.js';
import { extractPosting, PostingExtractionError } from './posting-extractor.js';

// Chromium does its own DNS resolution. Routing callbacks alone do not pin DNS,
// and redirects can escape those callbacks. All browser traffic therefore goes
// through this short-lived HTTPS CONNECT proxy, which validates and pins each
// destination before opening its socket. TLS stays end-to-end with Chromium.
export async function createPostingProxy(options: Pick<FetchOptions, 'resolve'> & { connect?: typeof connect } = {}) {
  const sockets = new Set<Socket>();
  let closed = false, bytes = 0;
  const server = createServer((_req, res) => { res.writeHead(403); res.end(); });
  const track = (socket: Socket) => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
  };
  server.on('connection', track);
  server.on('connect', (req, client, head) => {
    void (async () => {
      try {
        const address = await postingAddress(`https://${req.url}/`, options.resolve);
        if (closed || client.destroyed) return;
        const upstream = (options.connect ?? connect)({ host: address.address, port: 443, family: address.family });
        track(upstream);
        client.on('close', () => upstream.destroy()); upstream.on('close', () => client.destroy());
        upstream.setTimeout(15000, () => upstream.destroy());
        upstream.once('connect', () => {
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head.length) upstream.write(head);
          // Bound total transfer, including scripts and API responses, separately
          // from the extracted HTML limit. No page can stream indefinitely.
          upstream.on('data', chunk => {
            bytes += chunk.length;
            if (bytes > 16 * MAX_POSTING_BYTES) { client.destroy(); upstream.destroy(); }
          });
          client.pipe(upstream); upstream.pipe(client);
        });
      } catch {
        client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      }
    })();
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

let active = 0;
export async function fetchPostingInBrowser(input: string): Promise<PostingFetchResult> {
  // Do not launch Chromium for an invalid/private destination, and bound process
  // count across concurrent intake requests. No persistent profile is used.
  if (active >= 2) throw new PostingFetchError('browser_busy');
  active++;
  let browser: Browser | undefined;
  let proxy: Awaited<ReturnType<typeof createPostingProxy>> | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      void browser?.close().catch(() => {});
      reject(new PostingFetchError('timeout'));
    }, 40000);
  });
  try {
    return await Promise.race([deadline, (async () => {
      await postingAddress(input);
      if (expired) throw new PostingFetchError('timeout');
      proxy = await createPostingProxy();
      if (expired) { await proxy.close(); throw new PostingFetchError('timeout'); }
      const { chromium } = await import('playwright');
      if (expired) throw new PostingFetchError('timeout');
      try {
        browser = await chromium.launch({ headless: false, timeout: 10000,
          proxy: { server: proxy.url, bypass: '<-loopback>' },
          args: ['--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
        });
      } catch { throw new PostingFetchError('browser_unavailable'); }
      if (expired) { await browser.close(); throw new PostingFetchError('timeout'); }
      const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
      let requests = 0;
      await context.route('**/*', async route => {
        const request = route.request();
        try { canonicalizeJobUrl(request.url()); }
        catch { await route.abort(); return; }
        // Rendering a posting never authorizes application submissions, uploads,
        // WebSockets, or non-HTTPS schemes. Images/fonts/media aren't needed.
        if (++requests > 150 || !['GET', 'HEAD'].includes(request.method()) || ['image', 'font', 'media'].includes(request.resourceType())) await route.abort();
        else await route.continue();
      });
      await context.routeWebSocket('**/*', socket => socket.close());
      context.on('page', popup => { if (context.pages().length > 1) void popup.close(); });
      const page = await context.newPage();
      const response = await page.goto(input, { waitUntil: 'domcontentloaded', timeout: 25000 });
      if (!response) throw new PostingFetchError('network_error');
      if (!response.ok()) throw new PostingFetchError('http_error', { status: response.status(), url: response.url() });
      if (!/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(response.headers()['content-type'] ?? '')) throw new PostingFetchError('unsupported_content');
      let html = '', ready = false;
      const renderDeadline = Date.now() + 5000;
      do {
        html = await page.content();
        if (Buffer.byteLength(html) > MAX_POSTING_BYTES) throw new PostingFetchError('too_large');
        try {
          const posting = extractPosting(html, page.url());
          ready = Boolean(posting.role) || (posting.kind === 'discovery' && posting.candidates.length > 0);
        } catch (error) { if (!(error instanceof PostingExtractionError)) throw error; }
        if (!ready) await page.waitForTimeout(100);
      } while (!ready && Date.now() < renderDeadline);
      if (!ready) throw new PostingExtractionError();
      canonicalizeJobUrl(page.url());
      return { original_url: input.trim(), final_url: page.url(), html, retrieved_at: new Date().toISOString() };
    })()]);
  } catch (error) {
    if (error instanceof PostingFetchError || error instanceof PostingExtractionError) throw error;
    throw new PostingFetchError(expired || (error instanceof Error && error.name === 'TimeoutError') ? 'timeout' : 'network_error');
  } finally {
    clearTimeout(timer);
    await browser?.close().catch(() => {});
    await proxy?.close();
    active--;
  }
}
