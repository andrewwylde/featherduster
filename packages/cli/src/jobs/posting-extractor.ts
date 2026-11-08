import { load } from 'cheerio';
import { canonicalizeJobUrl, type JobPostingMetadata, JobPostingMetadataSchema } from '@featherduster/core';
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

function parseNum(raw: string): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[$£€¥,]/g, '').replace(/\b[A-Z]{3}\b/gi, '').trim();
  const kMatch = cleaned.match(/^([\d.]+)\s*[kK]$/);
  if (kMatch) {
    const val = parseFloat(kMatch[1]);
    return isNaN(val) ? undefined : Math.round(val * 1000);
  }
  const numMatch = cleaned.match(/^[\d.]+/);
  if (numMatch) {
    const val = parseFloat(numMatch[0]);
    return isNaN(val) ? undefined : Math.round(val);
  }
  return undefined;
}

function parsePeriod(text: string, amount?: number): 'annual' | 'monthly' | 'hourly' | 'unknown' {
  if (/(\/|\bper\s+|\b)(hr|hour|hourly)\b/i.test(text)) return 'hourly';
  if (/(\/|\bper\s+|\b)(mo|month|monthly)\b/i.test(text)) return 'monthly';
  if (/(\/|\bper\s+|\b)(yr|year|annual|annually)\b/i.test(text)) return 'annual';
  if (amount !== undefined) {
    if (amount >= 20000) return 'annual';
    if (amount > 0 && amount <= 500) return 'hourly';
  }
  return 'unknown';
}

function parseCompensationSegment(seg: string): JobPostingMetadata['compensation'][number] | null {
  if (!/\d/.test(seg)) return null;
  const regionMatch = seg.match(/^([A-Za-z\s]{2,20})\s*[:\-–—]\s*(.*)$/);
  let region: string | undefined;
  let raw_text = seg;
  if (regionMatch) {
    const label = regionMatch[1].trim();
    const isLabelOrCurrency = /^(USD|GBP|EUR|CAD|AUD|CHF|JPY|NZD|SGD|HKD|SEK|NOK|DKK|INR|salary|compensation|base\s*pay|pay\s*range|salary\s*range|range|rate|pay)$/i.test(label);
    if (!isLabelOrCurrency) {
      region = label;
      raw_text = regionMatch[2].trim();
    } else {
      raw_text = regionMatch[2].trim();
    }
  }
  const currMatch = raw_text.match(/\b(USD|GBP|EUR|CAD|AUD|CHF|JPY|NZD|SGD|HKD|SEK|NOK|DKK|INR)\b/i);
  let currency = 'USD';
  if (currMatch) {
    currency = currMatch[1].toUpperCase();
  } else if (raw_text.includes('£')) {
    currency = 'GBP';
  } else if (raw_text.includes('€')) {
    currency = 'EUR';
  } else if (raw_text.includes('¥')) {
    currency = 'JPY';
  }
  const rangeMatch = raw_text.match(/([$£€¥]?(?:[A-Z]{3})?\s*[\d,]+(?:\.\d+)?\s*[kK]?)\s*(?:-|–|—|to)\s*([$£€¥]?(?:[A-Z]{3})?\s*[\d,]+(?:\.\d+)?\s*[kK]?)/);
  let min: number | undefined;
  let max: number | undefined;
  if (rangeMatch) {
    min = parseNum(rangeMatch[1]);
    max = parseNum(rangeMatch[2]);
  } else {
    const single = raw_text.match(/[$£€¥]?(?:[A-Z]{3})?\s*[\d,]+(?:\.\d+)?\s*[kK]?/);
    if (single) {
      min = parseNum(single[0]);
      max = min;
    }
  }
  if (min === undefined && max === undefined) return null;
  const period = parsePeriod(raw_text, min ?? max);
  return {
    ...(region ? { region } : {}),
    currency,
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    period,
    raw_text,
  };
}

function parseLocations(text: string): string[] {
  if (!text) return [];
  if (text.includes('|') || text.includes(';')) {
    return text.split(/[|;]+/).map(s => s.trim()).filter(Boolean);
  }
  if (/^[A-Za-z\s.-]+,\s*[A-Z]{2}$/.test(text)) {
    return [text];
  }
  const parts = text.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) {
    const isRegionList = parts.every(p => /^[A-Z]{2,6}$/.test(p) || /^(US|USA|UK|LATAM|EMEA|APAC|EU|Canada)$/i.test(p));
    if (isRegionList) return parts;
  }
  return parts.length > 1 && !/^[A-Za-z\s.-]+,\s*[A-Z]{2}/.test(text) ? parts : [text];
}

export async function extractPostingMetadata(html: string, url?: string): Promise<JobPostingMetadata> {
  const $ = load(html);
  const jobs: Record<string, any>[] = [];
  let visited = 0;
  function visit(value: any, depth = 0): void {
    if (!value || typeof value !== 'object' || depth > 20 || ++visited > 10000) return;
    if (Array.isArray(value)) { value.forEach(v => visit(v, depth + 1)); return; }
    const types = [value['@type']].flat();
    if (types.includes('JobPosting')) jobs.push(value);
    for (const child of Object.values(value)) visit(child, depth + 1);
  }
  $('script[type="application/ld+json"]').each((_, node) => {
    try { visit(JSON.parse($(node).text())); } catch { /* Ignore malformed JSON-LD */ }
  });

  let remote_policy: string | undefined;
  let employment_type: string | undefined;
  let locations: string[] = [];
  const compensation: JobPostingMetadata['compensation'] = [];

  const job = jobs[0];
  if (job) {
    if (job.employmentType) {
      const raw = Array.isArray(job.employmentType) ? job.employmentType[0] : job.employmentType;
      if (typeof raw === 'string') {
        const typeMap: Record<string, string> = {
          FULL_TIME: 'Full-time',
          PART_TIME: 'Part-time',
          CONTRACTOR: 'Contractor',
          TEMPORARY: 'Temporary',
          INTERN: 'Internship',
        };
        employment_type = typeMap[raw] ?? raw;
      }
    }
    if (job.jobLocationType && String(job.jobLocationType).toUpperCase() === 'TELECOMMUTE') {
      remote_policy = 'Remote';
    } else if (job.applicantLocationRequirements) {
      remote_policy = 'Remote';
    }
    if (job.jobLocation) {
      const locs = [job.jobLocation].flat();
      for (const l of locs) {
        if (typeof l === 'string') {
          locations.push(l);
        } else if (l && typeof l === 'object') {
          const addr = l.address;
          if (typeof addr === 'string') {
            locations.push(addr);
          } else if (addr && typeof addr === 'object') {
            const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean);
            if (parts.length) locations.push(parts.join(', '));
          } else if (l.name && typeof l.name === 'string') {
            locations.push(l.name);
          }
        }
      }
    }
    if (job.baseSalary && typeof job.baseSalary === 'object') {
      const bs = job.baseSalary;
      const currency = typeof bs.currency === 'string' ? bs.currency : 'USD';
      let min: number | undefined;
      let max: number | undefined;
      let unitText: string | undefined;
      if (typeof bs.value === 'number') {
        min = max = bs.value;
      } else if (bs.value && typeof bs.value === 'object') {
        min = typeof bs.value.minValue === 'number' ? bs.value.minValue : undefined;
        max = typeof bs.value.maxValue === 'number' ? bs.value.maxValue : (typeof bs.value.value === 'number' ? bs.value.value : min);
        unitText = typeof bs.value.unitText === 'string' ? bs.value.unitText : undefined;
      }
      const period: 'annual' | 'monthly' | 'hourly' | 'unknown' =
        unitText ? (unitText.toLowerCase().includes('hour') ? 'hourly' : unitText.toLowerCase().includes('month') ? 'monthly' : 'annual') : (min ?? max ?? 0) >= 20000 ? 'annual' : 'unknown';
      const raw_text = min && max && min !== max ? `${currency} ${min.toLocaleString()} - ${max.toLocaleString()}` : `${currency} ${(min ?? max ?? 0).toLocaleString()}`;
      compensation.push({
        currency,
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
        period,
        raw_text,
      });
    }
  }

  if (!employment_type) {
    const empEl = $('.employment-type, .employment_type, [itemprop="employmentType"], .job-type').first();
    if (empEl.length && empEl.text().trim()) {
      employment_type = empEl.text().trim();
    }
  }

  const locEl = $('.location, .job-location, [itemprop="jobLocation"], .remote-policy, .workplace-type').first();
  const locText = locEl.length ? locEl.text().trim() : '';
  if (!remote_policy) {
    if (/\bhybrid\b/i.test(locText)) remote_policy = 'Hybrid';
    else if (/\bremote\b/i.test(locText)) remote_policy = 'Remote';
    else if (/\b(on-site|onsite|in-office)\b/i.test(locText)) remote_policy = 'On-site';
  }
  if (locations.length === 0 && locText) {
    const cleanedLoc = locText.replace(/^(remote|hybrid|on-site|onsite|in-office)\s*[-:—–]\s*/i, '').trim();
    if (cleanedLoc) {
      locations = parseLocations(cleanedLoc);
    }
  }

  const salEl = $('.salary, .compensation, [itemprop="baseSalary"], .pay-range, .salary-range');
  if (salEl.length) {
    salEl.each((_, el) => {
      const salText = $(el).text().trim();
      const segments = salText.split(/[|\n;]+/).map(s => s.trim()).filter(Boolean);
      for (const seg of segments) {
        const comp = parseCompensationSegment(seg);
        if (comp) compensation.push(comp);
      }
    });
  }

  const fullText = plain(html);
  const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean);

  if (locations.length === 0) {
    for (const line of lines) {
      const locMatch = line.match(/^(?:location|job\s*location)\s*[:\-–—]\s*(.*)$/i);
      if (locMatch) {
        const cleanedLoc = locMatch[1].replace(/^(remote|hybrid|on-site|onsite|in-office)\s*[-:—–]\s*/i, '').trim();
        if (cleanedLoc) locations = parseLocations(cleanedLoc);
        break;
      }
    }
  }

  if (compensation.length === 0) {
    for (const line of lines) {
      if (!/\d/.test(line)) continue;
      const looksLikeSalary = /^(?:salary|compensation|base\s*pay|pay\s*range|salary\s*range|rate)\s*[:\-–—]/i.test(line) ||
        /[$£€¥]|\b(?:USD|GBP|EUR|CAD|AUD)\b/i.test(line);
      if (looksLikeSalary) {
        const segments = line.split(/[|\n;]+/).map(s => s.trim()).filter(Boolean);
        for (const seg of segments) {
          const comp = parseCompensationSegment(seg);
          if (comp) compensation.push(comp);
        }
        if (compensation.length > 0) break;
      }
    }
  }

  if (!remote_policy) {
    if (/\bhybrid\b/i.test(fullText)) remote_policy = 'Hybrid';
    else if (/\bremote\b/i.test(fullText)) remote_policy = 'Remote';
    else if (/\b(on-site|onsite|in-office)\b/i.test(fullText)) remote_policy = 'On-site';
  }
  if (!employment_type) {
    for (const line of lines) {
      const empMatch = line.match(/^(?:employment\s*type|job\s*type)\s*[:\-–—]\s*(.*)$/i);
      if (empMatch) {
        employment_type = empMatch[1].trim();
        break;
      }
    }
    if (!employment_type) {
      const m = fullText.match(/\b(Full-time Employee|Full-time|Part-time Employee|Part-time|Contractor|Contract|Internship)\b/i);
      if (m) employment_type = m[1];
    }
  }

  let validSourceUrl: string | undefined;
  if (url) {
    try {
      const parsed = new URL(url);
      if (/^https?:$/i.test(parsed.protocol)) validSourceUrl = parsed.href;
    } catch { /* Ignore malformed URL */ }
  }

  return JobPostingMetadataSchema.parse({
    ...(remote_policy ? { remote_policy } : {}),
    locations,
    ...(employment_type ? { employment_type } : {}),
    compensation,
    ...(validSourceUrl ? { source_url: validSourceUrl } : {}),
    captured_at: new Date().toISOString(),
  });
}
