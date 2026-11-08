import { describe, expect, it } from 'vitest';
import { extractPostingMetadata } from '../src/jobs/posting-extractor.js';

describe('structured posting metadata extraction', () => {
  it('extracts multi-region compensation and location metadata with source text and provenance', async () => {
    const html = `
      <html>
        <div class="location">Remote - US, UK, LATAM</div>
        <div class="salary">US: $160,000 - $190,000 USD | UK: £100,000 - £120,000 GBP</div>
        <div class="employment-type">Full-time Employee</div>
        <div class="description"><p>Lead frontend development across platforms...</p></div>
      </html>
    `;
    const parsed = await extractPostingMetadata(html, 'https://example.com/jobs/123');

    expect(parsed.compensation).toEqual([
      { region: 'US', currency: 'USD', min: 160000, max: 190000, period: 'annual', raw_text: '$160,000 - $190,000 USD' },
      { region: 'UK', currency: 'GBP', min: 100000, max: 120000, period: 'annual', raw_text: '£100,000 - £120,000 GBP' },
    ]);
    expect(parsed.employment_type).toBe('Full-time Employee');
    expect(parsed.remote_policy).toBe('Remote');
    expect(parsed.locations).toEqual(['US', 'UK', 'LATAM']);
    expect(parsed.source_url).toBe('https://example.com/jobs/123');
    expect(parsed.captured_at).toBeDefined();
  });

  it('extracts structured metadata from Schema.org JobPosting JSON-LD', async () => {
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: 'Senior Staff Engineer',
      employmentType: 'FULL_TIME',
      jobLocationType: 'TELECOMMUTE',
      applicantLocationRequirements: {
        '@type': 'Country',
        name: 'United States',
      },
      jobLocation: {
        '@type': 'Place',
        address: {
          addressLocality: 'San Francisco',
          addressRegion: 'CA',
          addressCountry: 'US',
        },
      },
      baseSalary: {
        '@type': 'MonetaryAmount',
        currency: 'USD',
        value: {
          '@type': 'QuantitativeValue',
          minValue: 210000,
          maxValue: 250000,
          unitText: 'YEAR',
        },
      },
    };
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head><body><h1>Job</h1></body></html>`;
    const parsed = await extractPostingMetadata(html, 'https://example.com/jobs/staff');

    expect(parsed.remote_policy).toBe('Remote');
    expect(parsed.employment_type).toBe('Full-time');
    expect(parsed.locations).toContain('San Francisco, CA, US');
    expect(parsed.compensation).toEqual([
      { currency: 'USD', min: 210000, max: 250000, period: 'annual', raw_text: 'USD 210,000 - 250,000' },
    ]);
  });

  it('extracts hourly rate and hybrid remote policy', async () => {
    const html = `
      <html>
        <div class="job-location">Hybrid - Austin, TX</div>
        <div class="salary">$75 - $95 / hr</div>
        <div class="employment-type">Contractor</div>
      </html>
    `;
    const parsed = await extractPostingMetadata(html);

    expect(parsed.remote_policy).toBe('Hybrid');
    expect(parsed.employment_type).toBe('Contractor');
    expect(parsed.locations).toEqual(['Austin, TX']);
    expect(parsed.compensation).toEqual([
      { currency: 'USD', min: 75, max: 95, period: 'hourly', raw_text: '$75 - $95 / hr' },
    ]);
  });
});
