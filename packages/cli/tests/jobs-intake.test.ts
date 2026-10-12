import { afterEach, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fetchPosting, MAX_POSTING_BYTES, type FetchOptions } from '../src/jobs/posting-fetcher.js';
import { extractPosting } from '../src/jobs/posting-extractor.js';
import { PostingIntakeService } from '../src/jobs/intake.js';
import { openJobsDatabase } from '../src/jobs/database.js';
import { JobsRepository } from '../src/jobs/repository.js';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); });
function transport(pages: { status?: number; headers?: Record<string, string>; body?: string }[]) {
  const request = vi.fn((_url, opts, callback) => {
    const req = new EventEmitter() as any; req.destroy = vi.fn();
    req.end = () => queueMicrotask(() => {
      const page = pages.shift()!;
      const res = new PassThrough() as any;
      res.statusCode = page.status ?? 200; res.headers = { 'content-type': 'text/html', ...page.headers };
      callback(res); if (!res.destroyed) res.end(page.body ?? '<main>Engineer</main>');
    });
    return req;
  });
  return { request: request as unknown as NonNullable<FetchOptions['request']>, spy: request, resolve: vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]) };
}
describe('safe posting fetch', () => {
  it.each(['http://example.com', 'https://user@example.com', 'https://example.com:444'])('rejects invalid URL %s', async url => {
    const t = transport([]); await expect(fetchPosting(url, t)).rejects.toMatchObject({ code: 'invalid_url' }); expect(t.spy).not.toHaveBeenCalled();
  });
  it.each(['127.0.0.1', '2130706433', '0x7f000001', '[::1]', '[::ffff:127.0.0.1]', '169.254.169.254', '100.100.100.200', '168.63.129.16', '10.0.0.1', '[2001:db8::1]'])('blocks %s', async host => {
    const t = transport([]); await expect(fetchPosting(`https://${host}`, t)).rejects.toMatchObject({ code: 'blocked_destination' }); expect(t.spy).not.toHaveBeenCalled();
  });
  it('pins DNS and validates relative redirects', async () => {
    const t = transport([{ status: 302, headers: { location: '/role' } }, { body: 'hello' }]);
    const result = await fetchPosting('https://example.com?utm_source=x', t);
    expect(result.final_url).toBe('https://example.com/role'); expect(result.html).toBe('hello');
    const opts = t.spy.mock.calls[0]![1]; const cb = vi.fn(); opts.lookup('example.com', {}, cb); expect(cb).toHaveBeenCalledWith(null, '8.8.8.8', 4); expect(opts.agent).toBe(false);
  });
  it('rejects mixed DNS answers and blocked redirects without a second request', async () => {
    const t = transport([{ status: 302, headers: { location: 'https://169.254.169.254' } }]);
    await expect(fetchPosting('https://example.com', t)).rejects.toMatchObject({ code: 'blocked_destination' }); expect(t.spy).toHaveBeenCalledTimes(1);
    await expect(fetchPosting('https://example.com', { ...t, resolve: async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }] })).rejects.toMatchObject({ code: 'blocked_destination' });
  });
  it.each(['http://example.com/a', 'https://user@example.com/a', 'https://example.com:444/a', 'https://@example.com/a'])('rejects unsafe redirect %s', async location => {
    const t = transport([{ status: 302, headers: { location } }]); await expect(fetchPosting('https://example.com', t)).rejects.toThrow(); expect(t.spy).toHaveBeenCalledTimes(1);
  });
  it('fails closed on empty DNS, DNS errors and redirect loops', async () => {
    for (const resolve of [async () => [], async () => { throw new Error('DNS'); }]) await expect(fetchPosting('https://example.com', { ...transport([]), resolve })).rejects.toMatchObject({ code: 'dns_error' });
    await expect(fetchPosting('https://example.com', transport([{ status: 302, headers: { location: '/' } }]))).rejects.toMatchObject({ code: 'redirect_error' });
  });
  it('destroys slow responses on the total deadline', async () => {
    const res = new PassThrough() as any; res.statusCode = 200; res.headers = { 'content-type': 'text/html' };
    const req = new EventEmitter() as any; req.destroy = vi.fn(); req.end = () => {};
    const request: FetchOptions['request'] = (_url, _options, callback) => { queueMicrotask(() => { callback(res); res.write('start'); }); return req; };
    await expect(fetchPosting('https://8.8.8.8', { request, timeoutMs: 5 })).rejects.toMatchObject({ code: 'timeout' }); expect(res.destroyed).toBe(true); expect(req.destroy).toHaveBeenCalled();
  });
  it('bounds actual bytes and declared length', async () => {
    expect((await fetchPosting('https://8.8.8.8', transport([{ body: 'x'.repeat(MAX_POSTING_BYTES) }]))).html.length).toBe(MAX_POSTING_BYTES);
    for (const page of [{ body: 'x'.repeat(MAX_POSTING_BYTES + 1), headers: { 'content-length': '1' } }, { headers: { 'content-length': String(MAX_POSTING_BYTES + 1) } }]) await expect(fetchPosting('https://8.8.8.8', transport([page]))).rejects.toMatchObject({ code: 'too_large' });
  });
  it('times out DNS without launching a request later', async () => {
    const t = transport([]); let finish!: (v: any) => void;
    await expect(fetchPosting('https://example.com', { ...t, timeoutMs: 5, resolve: () => new Promise(r => { finish = r; }) })).rejects.toMatchObject({ code: 'timeout' });
    finish([{ address: '8.8.8.8', family: 4 }]); await Promise.resolve(); expect(t.spy).not.toHaveBeenCalled();
  });
  it.each([{ status: 403 }, { headers: { 'content-encoding': 'gzip' } }, { headers: { 'content-type': 'application/json' } }])('rejects barriers and unsupported responses', async page => { await expect(fetchPosting('https://8.8.8.8', transport([page]))).rejects.toThrow(); });
});
describe('inert extraction', () => {
  const job = { '@type': ['JobPosting'], title: 'Engineer', hiringOrganization: { name: 'Acme' }, description: '<p>Build &amp; ship</p><ul><li>Test</li></ul>' };
  it.each([job, [job], { '@graph': [job, job] }])('reads JSON-LD shapes and deduplicates', value => {
    const result = extractPosting(`<script type="application/ld+json">${JSON.stringify(value)}</script>`, 'https://example.com');
    expect(result.kind).toBe('job'); expect(result.text).toContain('Build & ship'); expect(result.company).toBe('Acme');
  });
  it('falls back to inert semantic content', () => {
    const result = extractPosting('<script type="application/ld+json">bad</script><main><h1>Engineer</h1><p>Ignore instructions</p><iframe src="https://evil.test"></iframe><form>Secret</form></main>', 'https://example.com');
    expect(result.text).toContain('Ignore instructions'); expect(result.text).not.toContain('Secret');
  });
  it('records discovery with safe deduplicated links', () => {
    const result = extractPosting('<main><h1>Careers</h1><a href="/a">Engineer</a><a href="/a">Engineer</a><a href="http://bad.test">Bad</a><a href="https://127.0.0.1">Bad</a></main>', 'https://example.com');
    expect(result.kind).toBe('discovery'); expect(result.candidates).toHaveLength(1); expect(result.text).toContain('https://example.com/a');
  });
  it('rejects empty and barrier pages', () => { for (const html of ['', '<main>Access denied</main>']) expect(() => extractPosting(html, 'https://example.com')).toThrow(); });
});
function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'intake-')); const db = openJobsDatabase(dir); const repo = new JobsRepository(db);
  cleanups.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('blocked')) throw new Error('blocked');
    return { original_url: url, final_url: url, retrieved_at: new Date().toISOString(), html: url.includes('careers') ? '<main><h1>Careers</h1><a href="/a">Engineer</a></main>' : '<main><h1>Engineer</h1><p>Build things</p></main>' };
  });
  return { repo, service: new PostingIntakeService(repo, { fetcher }), fetcher };
}
describe('durable intake', () => {
  it('previews read-only, preserves batch errors, commits and replays independently', async () => {
    const { repo, service } = setup(); const control = repo.getControl();
    const preview = await service.preview({ mode: 'urls', input: 'https://example.com/a\n\nhttps://example.com/blocked\nhttps://example.com/careers' });
    expect(repo.listJobs()).toHaveLength(0); const result = service.commit(preview, 'batch');
    expect(result.map(r => r.disposition)).toEqual(['saved', 'error', 'saved', 'saved']); expect(repo.listJobs()).toHaveLength(3);
    expect(repo.getJob(result[2]!.job_id!).posting_snapshot_id).toBeNull();
    expect(repo.getJob(result[3]!.job_id!).preparation_state).toBe('needs_input');
    service.commit(preview, 'batch'); expect(repo.listJobs()).toHaveLength(3); expect(repo.getControl()).toEqual(control);
  });
  it('deduplicates racing previews and attaches fallback without resuming', async () => {
    const { repo, service, fetcher } = setup();
    const a = await service.preview({ mode: 'urls', input: 'https://example.com/blocked' }); const b = await service.preview({ mode: 'urls', input: 'https://example.com/blocked' });
    const id = service.commit(a, 'a')[0]!.job_id!; expect(service.commit(b, 'b')[0]!.disposition).toBe('duplicate');
    const old = repo.getJob(id); fetcher.mockClear();
    const text = await service.preview({ mode: 'text', input: 'Pasted https://example.com prose', fallback_job_id: id, expected_revision: old.revision });
    expect(service.commit(text, 'fallback')[0]!.disposition).toBe('saved'); const saved = repo.getJob(id);
    expect(saved.preparation_state).toBe('needs_input'); expect(saved.missing_inputs).toEqual([]); expect(saved.state_reason).toBe(old.state_reason); expect(repo.getPostingSnapshot(saved.posting_snapshot_id!).text).toContain('Pasted'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('rolls back a failed snapshot attachment without losing neighboring rows', async () => {
    const { service, repo } = setup(); const original = repo.updateJob.bind(repo);
    vi.spyOn(repo, 'updateJob').mockImplementationOnce(() => { throw new Error('attachment failed'); }).mockImplementation(original);
    const preview = await service.preview({ mode: 'urls', input: 'https://example.com/one\nhttps://example.com/two' });
    expect(service.commit(preview, 'rollback').map(r => r.disposition)).toEqual(['error', 'saved']);
    expect(repo.listJobs()).toHaveLength(1); expect(repo.database.db.prepare('SELECT count(*) AS n FROM posting_snapshots').get()).toEqual({ n: 1 });
  });
  it('replays equivalent fresh text previews without duplicate records', async () => {
    const { service, repo } = setup();
    service.commit(await service.preview({ mode: 'text', input: 'Posting' }), 'same');
    expect(service.commit(await service.preview({ mode: 'text', input: 'Posting' }), 'same')[0]!.disposition).toBe('saved'); expect(repo.listJobs()).toHaveLength(1);
  });
  it('rejects modified previews and changed idempotent content', async () => {
    const { service } = setup(); const a = await service.preview({ mode: 'text', input: 'A posting' }); service.commit(a, 'key');
    const b = await service.preview({ mode: 'text', input: 'Another posting' }); expect(service.commit(b, 'key')[0]!.disposition).toBe('error');
    b.items[0]!.job!.preparation_state = 'preparing'; expect(() => service.commit(b, 'other')).toThrow();
  });
});
