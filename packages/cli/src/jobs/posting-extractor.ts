import { load } from 'cheerio';
import { canonicalizeJobUrl } from '@featherduster/core';
import { isPublicAddress } from './posting-fetcher.js';
import ipaddr from 'ipaddr.js';

export class PostingExtractionError extends Error {
  readonly code = 'extraction_failed';
  constructor() { super('No usable posting found. Paste posting text instead.'); }
}
export interface Opening { canonical_url: string; original_url: string; role: string | null; company: string | null; source_quote: string | null }
export interface ExtractedPosting { kind: 'job' | 'discovery'; text: string; role: string | null; company: string | null; external_job_id: string | null; candidates: Opening[] }
const string = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v.trim() : null;
function plain(html: string): string {
  const $ = load(html);
  $('script,style,template,iframe,object,embed,nav,form,input,button,select,textarea').remove();
  $('p,div,li,section,article,h1,h2,h3,h4,br').append('\n');
  return $.root().text().replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
export function extractPosting(html: string, finalUrl: string): ExtractedPosting {
  const $ = load(html); const jobs: Record<string, any>[] = []; let itemList = false; let visited = 0;
  const entries: Record<string, any>[] = [];
  function visit(value: any, depth = 0): void {
    if (!value || typeof value !== 'object' || depth > 20 || ++visited > 10000) return;
    if (Array.isArray(value)) { value.forEach(v => visit(v, depth + 1)); return; }
    const types = [value['@type']].flat();
    if (types.includes('JobPosting')) jobs.push(value);
    if (types.includes('ItemList')) { itemList = true; entries.push(...(Array.isArray(value.itemListElement) ? value.itemListElement : [])); }
    for (const child of Object.values(value)) visit(child, depth + 1);
  }
  $('script[type="application/ld+json"]').each((_, node) => { try { visit(JSON.parse($(node).text())); } catch { /* Other blocks and semantic content remain usable. */ } });
  const unique = [...new Map(jobs.map(j => [JSON.stringify([j.url, j.title, j.hiringOrganization?.name, j.description]), j])).values()];
  const semantic = $('main,article').first();
  const text = plain(semantic.length ? semantic.html() ?? '' : $('body').html() ?? '');
  if (/captcha|access denied|verify you are human|sign in to continue/i.test(text)) throw new PostingExtractionError();
  const heading = $('h1').first().text();
  const index = /careers|open (positions|roles)|job openings|current (openings|vacancies)/i.test(heading);
  const candidates = new Map<string, Opening>();
  function add(raw: unknown, role: unknown, company: unknown): void {
    if (typeof raw !== 'string') return;
    try {
      const url = new URL(raw, finalUrl); const canonical_url = canonicalizeJobUrl(url.href);
      const host = url.hostname.replace(/^\[|\]$/g, '');
      if (ipaddr.isValid(host) && !isPublicAddress(host)) return;
      candidates.set(canonical_url, { canonical_url, original_url: url.href, role: string(role), company: string(company), source_quote: string(role) });
    } catch { /* Unsafe or malformed shortlist links are not actionable. */ }
  }
  unique.forEach(j => add(j.url, j.title, j.hiringOrganization?.name));
  entries.forEach(e => add(e.item?.url ?? e.url ?? (typeof e.item === 'string' ? e.item : null), e.item?.name ?? e.name, null));
  if (index) (semantic.length ? semantic : $('body')).find('a[href]').each((_, a) => add($(a).attr('href'), $(a).text(), null));
  if (unique.length > 1 || itemList || index) {
    const shortlist = [...candidates.values()];
    return { kind: 'discovery', text: [text || 'Careers index', ...shortlist.map(c => `${c.role ?? 'Opening'}: ${c.original_url}`)].join('\n'), role: null, company: null, external_job_id: null, candidates: shortlist };
  }
  const job = unique[0];
  if (job && string(job.description)) {
    const description = plain(job.description);
    if (description) return { kind: 'job', text: [string(job.title), description].filter(Boolean).join('\n'), role: string(job.title), company: string(job.hiringOrganization?.name), external_job_id: string(job.identifier?.value ?? job.identifier), candidates: [] };
  }
  if (!text || !semantic.length) throw new PostingExtractionError();
  return { kind: 'job', text, role: string(heading), company: null, external_job_id: null, candidates: [] };
}
