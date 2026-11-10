import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import ipaddr from 'ipaddr.js';
import { canonicalizeJobUrl } from '@featherduster/core';

export const MAX_POSTING_BYTES = 2 * 1024 * 1024;
export type FetchErrorCode = 'invalid_url' | 'blocked_destination' | 'dns_error' | 'redirect_error' | 'timeout' | 'too_large' | 'http_error' | 'unsupported_content' | 'network_error' | 'browser_unavailable' | 'browser_busy';
export class PostingFetchError extends Error {
  readonly status?: number;
  readonly url?: string;
  constructor(readonly code: FetchErrorCode, detail: { status?: number; url?: string } = {}) {
    super(`${code}${detail.status ? ` (HTTP ${detail.status})` : ''}: Unable to retrieve posting. Paste posting text instead.`);
    this.status = detail.status; this.url = detail.url;
  }
}
export interface PostingFetchResult { original_url: string; final_url: string; html: string; retrieved_at: string }
export interface FetchOptions {
  resolve?: (host: string) => Promise<{ address: string; family: number }[]>;
  request?: (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
  timeoutMs?: number;
}
export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === 'unicast' && parsed.toString() !== '168.63.129.16';
  } catch { return false; }
}
// Both transports pin the address they validate, including every redirect or
// browser subrequest. A second unvalidated DNS lookup would permit rebinding.
export async function postingAddress(input: string, resolve: NonNullable<FetchOptions['resolve']> = host => lookup(host, { all: true })) {
  try { canonicalizeJobUrl(input); } catch { throw new PostingFetchError('invalid_url'); }
  const url = new URL(input), host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: { address: string; family: number }[];
  try { addresses = ipaddr.isValid(host) ? [{ address: host, family: ipaddr.parse(host).kind() === 'ipv4' ? 4 : 6 }] : await resolve(host); }
  catch { throw new PostingFetchError('dns_error'); }
  if (!addresses.length) throw new PostingFetchError('dns_error');
  if (addresses.some(a => !isPublicAddress(a.address))) throw new PostingFetchError('blocked_destination');
  return addresses[0]!;
}
export async function fetchPosting(input: string, options: FetchOptions = {}): Promise<PostingFetchResult> {
  let active: ClientRequest | undefined;
  let response: IncomingMessage | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { expired = true; active?.destroy(); response?.destroy(); reject(new PostingFetchError('timeout')); }, Math.min(options.timeoutMs ?? 15000, 15000));
  });
  const work = async (): Promise<PostingFetchResult> => {
    let current = input.trim();
    const seen = new Set<string>();
    for (let hop = 0; hop <= 5; hop++) {
      try { canonicalizeJobUrl(current); } catch { throw new PostingFetchError('invalid_url'); }
      const url = new URL(current); url.hash = '';
      if (seen.has(url.href)) throw new PostingFetchError('redirect_error');
      seen.add(url.href);
      const address = await postingAddress(url.href, options.resolve);
      if (expired) throw new PostingFetchError('timeout');
      const result = await new Promise<{ redirect: string } | { html: string }>((resolve, reject) => {
        const fail = (code: FetchErrorCode, status?: number) => { reject(new PostingFetchError(code, { status, url: url.href })); response?.destroy(); active?.destroy(); };
        active = (options.request ?? httpsRequest)(url, {
          method: 'GET', agent: false, headers: { 'Accept-Encoding': 'identity', Accept: 'text/html, application/xhtml+xml' },
          lookup: (_host, opts, callback) => {
            if ((opts as { all?: boolean }).all) (callback as Function)(null, [address]);
            else callback(null, address.address, address.family);
          },
        }, res => {
          response = res;
          if (expired) { res.destroy(); return; }
          res.on('error', () => fail('network_error'));
          res.on('aborted', () => fail('network_error'));
          const status = res.statusCode ?? 0;
          if ([301, 302, 303, 307, 308].includes(status)) {
            if (!res.headers.location || hop === 5) { fail('redirect_error'); return; }
            resolve({ redirect: res.headers.location }); res.destroy(); return;
          }
          if (status < 200 || status >= 300) { fail('http_error', status); return; }
          if (!/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(res.headers['content-type'] ?? '') || (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')) { fail('unsupported_content'); return; }
          if (Number(res.headers['content-length']) > MAX_POSTING_BYTES) { fail('too_large'); return; }
          const chunks: Buffer[] = []; let size = 0;
          res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_POSTING_BYTES) fail('too_large'); else chunks.push(Buffer.from(chunk)); });
          res.on('end', () => { if (!size) fail('unsupported_content'); else resolve({ html: Buffer.concat(chunks).toString('utf8') }); });
        });
        active.on('error', () => fail('network_error'));
        active.end();
      });
      if ('html' in result) return { original_url: input.trim(), final_url: url.href, html: result.html, retrieved_at: new Date().toISOString() };
      try {
        if (/[\\\u0000-\u0020\u007f]/.test(result.redirect) || /^(?:https:)?\/\/[^/?#]*@/i.test(result.redirect)) throw new Error('Unsafe location');
        current = new URL(result.redirect, url).href;
      } catch { throw new PostingFetchError('redirect_error'); }
    }
    throw new PostingFetchError('redirect_error');
  };
  try { return await Promise.race([work(), deadline]); }
  finally { clearTimeout(timer!); active?.destroy(); response?.destroy(); }
}
