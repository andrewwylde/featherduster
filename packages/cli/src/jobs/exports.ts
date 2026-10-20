import { currentResumeContext } from './resume-context.js';
import { randomUUID } from 'node:crypto';
import * as C from '@featherduster/core';
import { z } from 'zod';
import { JobArtifactsService } from './artifacts.js';
import { JobMaterials } from './materials.js';
import { JobsRepository, RepositoryError } from './repository.js';
import { fingerprint } from './files.js';
import type { selectJobSkillset } from './skillset.js';
import type { SemanticService } from './semantic-service.js';

const canonical = (value: unknown): string => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
export const JobExportRequestSchema = z.object({
  artifact_id: z.string().uuid(), artifact_fingerprint: z.string().min(1),
  cover_letter: z.string().uuid().optional(), interview_brief: z.string().uuid().optional(),
  dossier: z.boolean().default(false),
}).strict();
export type JobExportRequest = z.infer<typeof JobExportRequestSchema>;
const fileSchema = z.object({ name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/), type: z.string(), confidential: z.boolean(), reference: C.ImmutableReferenceSchema });
const releaseSchema = z.object({ schema_version: z.literal(1), id: z.string().uuid(), job_id: z.string().uuid(), workspace_id: z.string().uuid(), created_at: z.string(), binding: z.unknown(), files: z.array(fileSchema) }).strict();
export type JobRelease = z.infer<typeof releaseSchema>;
type File = { name: string; type: string; confidential: boolean; bytes: string | Uint8Array };

/** Publication uses only persisted Jobs content. No renderer, runner or approval path. */
export class JobExports {
  constructor(private readonly r: JobsRepository, private readonly artifacts: JobArtifactsService,
    private readonly materials: JobMaterials, private readonly select: (id: string, ids: string[]) => ReturnType<typeof selectJobSkillset>,
    private readonly rules: () => C.PrivacyRulesConfig, private readonly semantic?: SemanticService) {}

  private resolve(jobId: string, request: JobExportRequest) {
    const job = this.r.getJob(jobId), view = this.artifacts.review(jobId, request.artifact_id);
    const { artifact, draft } = view;
    const blocked = (message: string): never => { throw new RepositoryError('ineligible', message); };
    if (artifact.version_fingerprint !== request.artifact_fingerprint) blocked('Resume version changed. Reload the current resume before exporting.');
    if (job.artifact_version_ids.at(-1) !== artifact.id) blocked('This is historical. Open its saved release, or return to the current resume.');
    if (this.r.active().some(a => a.job_id === jobId)) blocked('Stop or finish preparation before publishing current files.');
    if (view.working_draft && canonical(view.working_draft.candidate) !== canonical(draft.candidate)) blocked('Working resume has pending edits. Save and check it before exporting; saved releases remain available.');
const { context, rules } = currentResumeContext(this.r, this.artifacts, jobId, artifact.id, this.select, this.rules);
const input = context.input;
    if (artifact.semantic_binding && (!this.semantic || canonical(artifact.semantic_binding) !== canonical(this.semantic.binding(jobId,
      { kind: 'draft', draft_id: draft.id, candidate: draft.candidate }))))
      blocked('Evidence decisions changed. Check and finalize the current resume before creating a new release; saved PDFs remain available.');

    if (artifact.validation_result !== 'passed' || !artifact.pdf || !view.validation_report || view.validation_report.passed !== true || view.validation_report.pageCount !== 1 || view.validation_report.pageBudget !== 1 || input.policy.page_budget !== 1) blocked('A verified one-page PDF is required. Return to resume checks; exports never render a replacement.');
    const scan = C.redactText(C.compileMarkdownResume(draft.candidate), rules);
    if (!C.scanConfidentiality(C.compileMarkdownResume(draft.candidate), rules).isClean || !scan.isClean || scan.redactedText !== C.compileMarkdownResume(draft.candidate)) blocked('Resume contains private wording. Correct it and check a new PDF before exporting.');
    const binding = { job_id: jobId, company: job.company, role: job.role, artifact: { id: artifact.id, fingerprint: artifact.version_fingerprint }, draft: { id: draft.id, revision: draft.revision, fingerprint: fingerprint(canonical(draft.candidate)) }, input: { id: input.id, fingerprint: input.fingerprint }, posting: input.posting, evidence: input.selected_evidence, privacy: input.privacy_rules, corpus: input.corpus_knowledge, materials: {} as Record<string, unknown> };
    return { view, context, rules, binding };
  }

  files(jobId: string, request: JobExportRequest) {
    const { view, context, rules, binding } = this.resolve(jobId, request);
    const spec = view.draft.candidate;
    const files: File[] = [];
    const add = (name: string, type: string, bytes: File['bytes'], confidential = false) => files.push({ name, type, bytes, confidential });
    add('resume.pdf', 'application/pdf', this.artifacts.content(jobId, view.artifact.id));
    add('resume.md', 'text/markdown', C.compileMarkdownResume(spec, rules));
    add('resume.txt', 'text/plain', C.compileMarkdownResume(spec, rules));
    add('resume.html', 'text/html', C.compileHtmlPrintResume(spec, rules));
    add('resume.typ', 'text/plain', C.compileTypstResume(spec, rules));
    // Preserve the exact source used to produce the validated PDF, not a different template.
    add('resume.tex', 'text/plain', this.r.database.files.readArtifact(view.artifact.source, jobId, view.artifact.id));
    if (request.dossier) {
      const job = this.r.getJob(jobId), posting = this.r.getPostingSnapshot(context.input.posting.id);
      const options = { targetCompany: job.company ?? undefined, targetRole: job.role ?? undefined, jobDescription: posting.text, date: view.artifact.created_at.slice(0, 10) };
      const dossierMd = C.compileDefenseBrief(spec, context.evidence, options)
        .replace(/^# 🛡️ Interview Defense Brief:/m, '# 🛡️ Confidential Evidence Dossier (Private Candidate Preparation — Not the Interview Brief):');
      const dossierHtml = C.compileHtmlDefenseBrief(spec, context.evidence, options)
        .replace('<title>Interview Defense Brief -', '<title>Confidential Evidence Dossier -')
        .replace('<h1>Interview Defense Brief:', '<h1>Confidential Evidence Dossier (Private Candidate Preparation — Not the Interview Brief):');
      add('confidential-dossier.md', 'text/markdown', dossierMd, true);
      add('confidential-dossier.html', 'text/html', dossierHtml, true);
    }
    for (const kind of ['cover_letter', 'interview_brief'] as const) {
      const revision = request[kind];
      if (!revision) continue;
      const value = this.materials.read(jobId, kind).current;
      // export revalidates freshness and review before any files are published.
      const text = this.materials.export(jobId, kind, revision, 'text');
      const html = this.materials.export(jobId, kind, revision, 'html');
      if (!value || value.resume?.fingerprint !== fingerprint(JSON.stringify(spec)) || value.posting.id !== context.input.posting.id) throw new RepositoryError('ineligible', 'Material refers to a different resume or posting. Generate and review it against this resume.');
      binding.materials[kind] = { id: revision, content: value.content_fingerprint, input: value.input, privacy: value.privacy_fingerprint, sources: value.sources_fingerprint };
      add(`${kind}.md`, 'text/markdown', text); add(`${kind}.txt`, 'text/plain', text); add(`${kind}.html`, 'text/html', html);
    }
    return { binding, files };
  }

  save(jobId: string, request: JobExportRequest, key: string): JobRelease {
    const release = this.r.withReceipt('job_export_release', key, { jobId, request }, () => {
      const result = this.files(jobId, request), id = randomUUID(), bundle: Record<string, File['bytes']> = {};
      const parent = this.r.database.files.bundlePath('artifacts', jobId, id);
      const files = result.files.map(file => { bundle[file.name] = file.bytes; return { name: file.name, type: file.type, confidential: file.confidential, reference: { id: `${parent}/${file.name}`, fingerprint: fingerprint(file.bytes) } }; });
      const release = releaseSchema.parse({ schema_version: 1, id, job_id: jobId, workspace_id: this.r.database.workspaceId, created_at: new Date().toISOString(), binding: result.binding, files });
      bundle['release.json'] = JSON.stringify(release);
      this.r.database.files.writeBundle('artifacts', jobId, id, bundle);
      return release;
    }).result;
    return this.verify(release);
  }

  list(jobId: string): (JobRelease & { unavailable_reason?: string })[] {
    this.r.getJob(jobId);
    const rows = this.r.database.db.prepare("SELECT result FROM mutation_receipts WHERE operation='job_export_release' ORDER BY rowid DESC").all() as { result: string }[];
    return rows.map(row => releaseSchema.parse(JSON.parse(row.result))).filter(value => value.job_id === jobId).map(value => { try { return this.verify(value); } catch (error) { return { ...value, unavailable_reason: error instanceof Error ? error.message : 'Saved files unavailable' }; } });
  }
  private verify(value: JobRelease) {
    try {
      if (value.workspace_id !== this.r.database.workspaceId) throw new Error('Workspace mismatch');
      const bytes = JSON.stringify(value);
      this.r.database.files.readArtifact({ id: `${this.r.database.files.bundlePath('artifacts', value.job_id, value.id)}/release.json`, fingerprint: fingerprint(bytes) }, value.job_id, value.id);
      for (const file of value.files) this.r.database.files.readArtifact(file.reference, value.job_id, value.id);
      return value;
    } catch { throw new RepositoryError('corrupt_data', 'Saved release files are missing or changed. Restore the original bundle; current content and other releases are retained.'); }
  }
  content(jobId: string, releaseId: string, name: string) {
    const release = this.list(jobId).find(value => value.id === releaseId);
    if (release) this.verify(releaseSchema.parse(Object.fromEntries(Object.entries(release).filter(([key]) => key !== 'unavailable_reason'))));
    if (release && name === 'release.json') { const { unavailable_reason, ...manifest } = release; return { name, type: 'application/json', confidential: manifest.files.some(file => file.confidential), bytes: Buffer.from(JSON.stringify(manifest)) }; }
    const file = release?.files.find(file => file.name === name);
    if (!file) throw new RepositoryError('not_found', 'Saved release file not found for this job');
    return { ...file, bytes: this.r.database.files.readArtifact(file.reference, jobId, releaseId) };
  }
}
