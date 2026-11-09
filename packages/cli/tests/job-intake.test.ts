import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractPostingMetadata } from '../src/jobs/posting-extractor.js';
import { openJobsDatabase } from '../src/jobs/database.js';
import { JobsRepository } from '../src/jobs/repository.js';
import { PostingIntakeService } from '../src/jobs/intake.js';

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

  it('filters false-positive salary labels from region fields', async () => {
    const html = `
      <html>
        <div class="salary">Salary: $150,000 - $180,000 USD | Base Pay: $120,000 - $140,000 USD</div>
      </html>
    `;
    const parsed = await extractPostingMetadata(html);
    expect(parsed.compensation).toEqual([
      { currency: 'USD', min: 150000, max: 180000, period: 'annual', raw_text: '$150,000 - $180,000 USD' },
      { currency: 'USD', min: 120000, max: 140000, period: 'annual', raw_text: '$120,000 - $140,000 USD' },
    ]);
    expect(parsed.compensation[0].region).toBeUndefined();
    expect(parsed.compensation[1].region).toBeUndefined();
  });

  it('extracts metadata line-by-line from plain text postings', async () => {
    const text = `
      Principal Software Engineer
      Location: Remote - US, Canada
      Employment Type: Full-time
      Salary: $180,000 - $220,000 USD
      We are looking for an experienced engineer...
    `;
    const parsed = await extractPostingMetadata(text);
    expect(parsed.remote_policy).toBe('Remote');
    expect(parsed.employment_type).toBe('Full-time');
    expect(parsed.locations).toEqual(['US', 'Canada']);
    expect(parsed.compensation).toEqual([
      { currency: 'USD', min: 180000, max: 220000, period: 'annual', raw_text: '$180,000 - $220,000 USD' },
    ]);
  });

  it('retains posting_metadata on job and snapshot during text fallback intake', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'intake-fallback-'));
    const db = openJobsDatabase(dir);
    const repo = new JobsRepository(db);
    try {
      const service = new PostingIntakeService(repo);
      const initial = repo.createJob({
        schema_version: 1,
        id: '11111111-1111-4111-8111-111111111111',
        workspace_id: db.workspaceId,
        revision: 0,
        kind: 'job',
        original_url: 'https://example.com/blocked',
        canonical_url: 'https://example.com/blocked',
        employer_id: null,
        external_job_id: null,
        company: 'Acme',
        role: 'Engineer',
        parent_discovery_id: null,
        posting_snapshot_id: null,
        preparation_state: 'needs_input',
        application_lifecycle: 'not_started',
        preparation_stage: null,
        base_resume_id: null,
        template_id: null,
        runner: null,
        policy_fingerprint: null,
        current_attempt_id: null,
        artifact_version_ids: [],
        missing_inputs: [{ key: 'posting_text', question: 'Paste posting text', scope: { kind: 'job', job_id: '11111111-1111-4111-8111-111111111111' }, reason: 'blocked' }],
        confirmation_provenance: [],
        state_reason: 'blocked',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, 'init').result;

      const fallbackText = `
        Location: Remote - US
        Salary: $150,000 - $180,000 USD
        Employment Type: Full-time
      `;
      const preview = await service.preview({
        mode: 'text',
        input: fallbackText,
        fallback_job_id: initial.id,
        expected_revision: initial.revision,
      });

      expect(preview.items[0]?.job?.posting_metadata).toBeDefined();
      expect(preview.items[0]?.snapshot?.posting_metadata).toBeDefined();

      const committed = service.commit(preview, 'fallback-batch');
      expect(committed[0]?.disposition).toBe('saved');

      const updatedJob = repo.getJob(initial.id);
      expect(updatedJob.posting_metadata).toBeDefined();
      expect(updatedJob.posting_metadata?.remote_policy).toBe('Remote');
      expect(updatedJob.posting_metadata?.compensation[0]?.min).toBe(150000);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('extracts compensation present only in JSON-LD description with repeated units (SL-BUG-006)', async () => {
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: 'Frontend Engineer',
      description: '<p>Compensation:</p><p>$180,000/year - $220,000/year + equity + benefits</p><p>Requires 5+ years of experience. Series B startup.</p>',
      employmentType: 'FULL_TIME',
      jobLocationType: 'TELECOMMUTE',
      jobLocation: { address: { addressCountry: 'US' } },
    };
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head><body></body></html>`;
    const parsed = await extractPostingMetadata(html, 'https://example.com/jobs/frontend');

    expect(parsed.remote_policy).toBe('Remote');
    expect(parsed.employment_type).toBe('Full-time');
    expect(parsed.compensation).toEqual([
      {
        currency: 'USD',
        min: 180000,
        max: 220000,
        period: 'annual',
        raw_text: '$180,000/year - $220,000/year + equity + benefits',
      },
    ]);
  });
});
