import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import yaml from 'js-yaml';
import { RunStore, RUN_FILES } from '../store.js';
import { prepareRun, type CreateRunInput } from '../prepare-run.js';
import { loadTailoringConfig } from '../config.js';
import { defaultRunnerFactory, type RunnerFactory } from '../../runners/registry.js';
import { withDraftFileLock } from './locks.js';
import { ResumeSpecSchema, DraftRevisionTokenSchema, canonicalJson, DraftContextSchema, DraftRecordSchema, DraftUpdateSchema, SetupPayloadSchema, ManualDraftPayloadSchema, RunManifestSchema, DraftAppliedContentSchema, RunDraftPayloadSchema, type DraftArtifactTokens, type DraftAppliedContent, type RunManifest, type DraftEnvelope, type DraftBase, type ResumeSpec, type DraftUpdate, type RevisionToken } from '@featherduster/core';
import { DraftRepository, DraftRepositoryError } from './repository.js';
import { DraftOperationRunner, type DraftOperation } from './operations.js';
import { mergeDraftResume, mergedManual, rebaseProposals } from './upstream.js';
import { applyProposals, mergeEqual, DraftRunArtifactsSchema, type MergeChoice } from '@featherduster/core';

export const DraftSeedSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.string().uuid(), kind: z.literal('setup'), payload: SetupPayloadSchema, context: DraftContextSchema.optional() }).strict(),
  z.object({ id: z.string().uuid(), kind: z.literal('manual'), payload: ManualDraftPayloadSchema, context: DraftContextSchema.optional() }).strict(),
]);
export type DraftSeed = z.infer<typeof DraftSeedSchema>;
export interface DraftServiceDependencies {
  workspaceDir: string;
  runnerFactory?: RunnerFactory;
  now?: () => Date;
  loadResumes: () => Array<{ id: string; spec: ResumeSpec; filePath?: string }>;
}
/** Canonical identity is independent of the process working directory and path spelling. */
export function workspaceIdentity(workspaceDir: string): string {
  const resolved = path.resolve(workspaceDir);
  const canonical = fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
  return createHash('sha256').update(process.platform === 'win32' ? canonical.toLowerCase() : canonical).digest('hex');
}
export class DraftService {
  readonly repository: DraftRepository;
  readonly operations: DraftOperationRunner;
  readonly workspaceId: string;
  private recoveryErrors: { id: string; message: string }[] = [];
  constructor(private readonly dependencies: DraftServiceDependencies) {
    this.workspaceId = workspaceIdentity(dependencies.workspaceDir);
    this.repository = new DraftRepository(dependencies.workspaceDir);
    this.operations = new DraftOperationRunner(dependencies.workspaceDir, this.repository);
  }
  /** Must run before legacy run recovery changes manifests. A damaged intent is surfaced in list. */
  recover(): void {
    try { this.recoveryErrors = this.operations.recover().errors.map(({ operationId, message }) => ({ id: operationId, message })); }
    catch (error) { this.recoveryErrors = [{ id: 'operations', message: String(error) }]; }
  }
  list() {
    const result = this.repository.list();
    return { workspaceId: this.workspaceId, records: result.records, recoveryErrors: [...result.recoveryErrors, ...this.recoveryErrors] };
  }
  get(id: string) {
    const result = this.repository.read(id);
    if (result.record.lifecycle === 'discarded') throw new DraftRepositoryError(410, 'discarded', 'Draft was discarded');
    return result;
  }
  upstream(id: string) {
    const { record } = this.get(id);
    const matches = this.dependencies.loadResumes().filter(item => item.id === record.base?.resumeId);
    const source = matches.length === 1 ? matches[0] : undefined;
    const fingerprint = source ? createHash('sha256').update(canonicalJson(source.spec)).digest('hex') : null;
    return { record, fingerprint, missing: !source, changed: !!fingerprint && fingerprint !== record.base?.fingerprint };
  }
  private prepareUpstream(id: string, expected: RevisionToken, resolutions: Record<string, MergeChoice> = {}) {
    const draft = this.get(id), record = draft.record;
    if (canonicalJson(draft.token) !== canonicalJson(expected)) throw new DraftRepositoryError(409, 'stale_revision', 'Draft changed before upstream sync');
    if (record.lifecycle !== 'draft' || !record.base) throw new DraftRepositoryError(409, 'invalid_lifecycle', 'Only an editable draft with a pinned base can sync');
    const sources: NonNullable<DraftOperation['sources']> = [];
    const matches = this.dependencies.loadResumes().filter(item => item.id === record.base!.resumeId);
    if (matches.length !== 1) throw new DraftRepositoryError(409, 'missing_upstream', 'Live source is missing or ambiguous. Your pinned snapshot and edits are retained.');
    const upstream = matches[0];
    if (!upstream.filePath) throw new DraftRepositoryError(409, 'missing_upstream_path', 'Live source cannot be checked safely because its file path is unavailable.');
    const sourcePath = upstream.filePath.replace(/\\/g, '/');
    const fullPath = path.resolve(this.dependencies.workspaceDir, sourcePath);
    const relative = path.relative(this.dependencies.workspaceDir, fullPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new DraftRepositoryError(409, 'invalid_source', 'Source must be inside the workspace');
    const bytes = fs.existsSync(fullPath) ? fs.readFileSync(fullPath) : null;
    sources.push({ path: sourcePath, expectedHash: bytes === null ? null : createHash('sha256').update(bytes).digest('hex') });
    const currentSource = this.dependencies.loadResumes().filter(item => item.id === upstream.id);
    if (currentSource.length !== 1 || canonicalJson(currentSource[0].spec) !== canonicalJson(upstream.spec) || currentSource[0].filePath !== upstream.filePath) throw new DraftRepositoryError(409, 'upstream_changed', 'Upstream changed while loading. Preview again.');
    const fingerprint = createHash('sha256').update(canonicalJson(upstream.spec)).digest('hex');
    const nextBase = { resumeId: upstream.id, spec: upstream.spec, fingerprint };
    const store = new RunStore(this.dependencies.workspaceDir);
    let manifest: RunManifest | undefined;
    const artifacts: Record<string, unknown> = {};
    if (record.kind === 'run') {
      this.assertRunMutationAvailable(record.runSlug!);
      for (const file of [RUN_FILES.manifest, RUN_FILES.posting, RUN_FILES.analysis, RUN_FILES.alignment, RUN_FILES.proposals, RUN_FILES.briefData, RUN_FILES.brief]) {
        const text = store.readText(record.runSlug!, file);
        sources.push({ path: `tailoring/${record.runSlug}/${file}`, expectedHash: text === null ? null : createHash('sha256').update(text).digest('hex') });
        if (text !== null) artifacts[file] = text;
      }
      manifest = RunManifestSchema.parse(yaml.load(String(artifacts[RUN_FILES.manifest])));
      if (manifest.draft_id !== record.id) throw new DraftRepositoryError(409, 'association_conflict', 'Run and draft association differ');
      if (Object.values(manifest.steps).some(step => step.status === 'running')) throw new DraftRepositoryError(409, 'busy', 'A generation step is running. Wait or cancel it before syncing upstream.');
      this.assertArtifactTokens(draft, sources);
    }
    const merge = mergeDraftResume(record, upstream.spec, resolutions);
    let next = { ...record, base: nextBase };
    if (record.kind === 'manual') next = { ...record, base: nextBase, payload: mergedManual(record.payload, merge.merged) };
    if (record.kind === 'run') {
      const rebased = rebaseProposals(record.base.spec, merge.local, upstream.spec, merge.merged, record.payload.proposals?.proposals ?? []);
      const previous = DraftRunArtifactsSchema.parse({ posting: artifacts[RUN_FILES.posting] ?? '', manifest, base: record.base,
        ...Object.fromEntries((['analysis', 'alignment', 'proposals', 'brief'] as const).flatMap(key => { const raw = artifacts[key === 'brief' ? RUN_FILES.briefData : RUN_FILES[key]]; return raw ? [[key, JSON.parse(String(raw))]] : []; })),
      });
      next = { ...record, base: nextBase, payload: { ...record.payload, ...(record.payload.proposals ? { proposals: { proposals: rebased.proposals } } : {}) },
        upstreamSync: { candidate: merge.merged, previous, previousAppliedContent: record.appliedContent, reviewProposalIds: rebased.reviewProposalIds, staleSteps: ['alignment', 'proposals', 'brief'] },
      };
    }
    // The preview version also pins source bytes/path; formatting-only edits must
    // not silently pass a preview-to-commit check. The stored base stays semantic.
    const upstreamFingerprint = createHash('sha256').update(canonicalJson({ fingerprint, source: sources[0] })).digest('hex');
    // Imported formats can include explicit undefined optional fields. Journal
    // records use canonical JSON omission semantics for those fields.
    const nextRecord = DraftRecordSchema.parse(JSON.parse(canonicalJson(next)));
    return { draft, next: nextRecord, sources, manifest, upstreamFingerprint, conflicts: merge.conflicts, candidate: merge.merged, targetMap: merge.targetMap };
  }
  previewSync(id: string, expected: RevisionToken) {
    const prepared = this.prepareUpstream(id, expected);
    return { upstreamFingerprint: prepared.upstreamFingerprint, conflicts: prepared.conflicts, record: prepared.next, candidate: prepared.candidate, targetMap: prepared.targetMap };
  }
  sync(id: string, input: { expected: RevisionToken; operationId: string; upstreamFingerprint: string; resolutions: Record<string, MergeChoice> }) {
    const request = { origin: 'upstream-sync', id, ...input };
    const prior = this.operations.lookup(input.operationId);
    if (prior) {
      if (prior.operation.command !== 'sync' || canonicalJson(prior.operation.request) !== canonicalJson(request)) throw new DraftRepositoryError(409, 'operation_conflict', 'Operation id was used for another request');
      return this.operations.execute(prior.operation).acknowledgement;
    }
    const prepared = this.prepareUpstream(id, input.expected, input.resolutions);
    if (input.upstreamFingerprint !== prepared.upstreamFingerprint) throw new DraftRepositoryError(409, 'upstream_changed', 'Upstream changed after preview. Preview again before applying.');
    if (prepared.conflicts.some(conflict => !input.resolutions[conflict.id]) || Object.keys(input.resolutions).some(key => !prepared.conflicts.some(conflict => conflict.id === key))) throw new DraftRepositoryError(422, 'unresolved_merge', 'Choose local or upstream for every conflict in this preview');
    // Target remapping alone cannot express every resolved array choice (for
    // example, experience order). Never publish a different effective candidate.
    // Pending ambiguous operations cannot excuse unrelated candidate differences.
    if (prepared.next.kind === 'run'
      && !mergeEqual(applyProposals(prepared.next.base.spec, prepared.next.payload.proposals?.proposals ?? []), prepared.candidate)) {
      throw new DraftRepositoryError(422, 'unrepresentable_merge', 'The rebased proposals cannot reproduce the resolved candidate. Choose upstream for the conflicting section, or cancel and revise your edits. Your draft and preview are retained.');
    }
    const writes: DraftOperation['writes'] = [];
    if (prepared.next.kind === 'run' && prepared.next.payload.proposals) {
      const record = prepared.next, proposals = record.payload.proposals!;
      const content = JSON.stringify(proposals, null, 2) + '\n';
      const file = `tailoring/${record.runSlug}/${RUN_FILES.proposals}`;
      const fingerprint = createHash('sha256').update(content).digest('hex');
      writes.push({ path: file, expectedHash: prepared.sources.find(item => item.path === file)!.expectedHash, content });
      record.payload.artifactTokens.proposals = { revision: (record.payload.artifactTokens.proposals?.revision ?? -1) + 1, fingerprint };
      record.appliedContent = { ...record.appliedContent, proposals };
    }
    if (prepared.manifest) {
      const manifest = structuredClone(prepared.manifest);
      for (const step of ['alignment', 'proposals', 'brief'] as const) manifest.steps[step] = { ...manifest.steps[step], status: 'stale' };
      manifest.state = 'draft'; manifest.updated = (this.dependencies.now?.() ?? new Date()).toISOString();
      const file = `tailoring/${manifest.slug}/${RUN_FILES.manifest}`;
      writes.push({ path: file, expectedHash: prepared.sources.find(item => item.path === file)!.expectedHash, content: yaml.dump(manifest, { indent: 2, lineWidth: 120 }) });
    }
    return this.operations.execute({ operationId: input.operationId, draftId: prepared.next.id, command: 'sync', expected: input.expected, request,
      next: prepared.next, contentChanged: true, sources: prepared.sources.filter(source => !writes.some(write => write.path === source.path)), writes, result: {},
    }).acknowledgement;
  }
  private captureBase(resumeId: string): DraftBase | null {
    if (!resumeId) return null;
    const resume = this.dependencies.loadResumes().find((item) => item.id === resumeId);
    if (!resume) throw new DraftRepositoryError(400, 'invalid_base', 'Selected resume does not exist');
    const spec = structuredClone(resume.spec);
    return { resumeId, spec, fingerprint: createHash('sha256').update(canonicalJson(spec)).digest('hex') };
  }
  create(input: DraftSeed, mutationId: string) {
    const seed = DraftSeedSchema.parse(input);
    const id = seed.id.toLowerCase();
    return this.repository.createFromSeed(id, mutationId, { ...seed, id }, () => {
      const base = this.captureBase(seed.kind === 'setup' ? seed.payload.baseResumeId : seed.payload.selectedResumeId);
      if (seed.kind === 'manual' && !base) throw new DraftRepositoryError(400, 'invalid_base', 'Manual drafts require a selected resume');
      const timestamp = '1970-01-01T00:00:00.000Z';
      return DraftRecordSchema.parse({ ...seed, id, schemaVersion: 1, lifecycle: 'draft', revision: 0, createdAt: timestamp, editedAt: timestamp, savedAt: timestamp, base, context: seed.context ?? {}, appliedContent: {} });
    });
  }

  save(id: string, input: DraftUpdate) {
    const update = DraftUpdateSchema.parse(input);
    const setup = update.change === 'content' ? SetupPayloadSchema.safeParse(update.payload) : undefined;
    if (setup?.success) {
      const payload = setup.data;
      // Dispatch from submitted content, so receipt identity survives lifecycle/kind changes.
      // Repository checks receipts under lock before validating the current record.
      return this.repository.trustedTransition(id, { expected: update.expected, mutationId: update.mutationId, input: { operation: 'setup-content', update }, contentChanged: true }, (record) => {
        if (record.kind !== 'setup') throw new DraftRepositoryError(400, 'invalid_payload', 'Expected setup draft');
        const base = payload.baseResumeId === record.payload.baseResumeId ? record.base : this.captureBase(payload.baseResumeId);
        return { ...record, payload, base, context: update.context ?? record.context };
      });
    }
    const run = update.change === 'content' ? RunDraftPayloadSchema.safeParse(update.payload) : undefined;
    if (run?.success) {
      return this.repository.trustedTransition(id, { expected: update.expected, mutationId: update.mutationId, input: { operation: 'run-content', update }, contentChanged: true }, (record) => {
        if (record.kind !== 'run') throw new DraftRepositoryError(400, 'invalid_payload', 'Expected run draft');
        // Artifact tokens and the applied baseline belong to the server, including on retries.
        return { ...record, payload: { ...run.data, artifactTokens: record.payload.artifactTokens }, context: update.context ?? record.context };
      });
    }
    return this.repository.update(id, update);
  }
  /** A prepared adoption owns its planned run paths before run.yaml carries draft_id. */
  assertRunMutationAvailable(slug: string): void {
    if (this.reservedSlugs(true).has(slug)) throw new DraftRepositoryError(409, 'pending_operation', 'Run has an unresolved draft operation; recover it first');
  }
  private reservedSlugs(isolateMalformed = false): Set<string> {
    const result = new Set<string>();
    const root = path.join(this.dependencies.workspaceDir, 'tailoring-drafts', 'operations');
    if (!fs.existsSync(root)) return result;
    for (const owner of fs.readdirSync(root, { withFileTypes: true })) {
      if (!owner.isDirectory() || !z.string().uuid().safeParse(owner.name).success) continue;
      for (const file of fs.readdirSync(path.join(root, owner.name))) {
        if (!file.endsWith('.json')) continue;
        const id = file.slice(0, -5);
        let intent: ReturnType<DraftOperationRunner['lookup']>;
        try { intent = this.operations.lookup(id); }
        catch (error) {
          // Unreadable intents are reported in recovery and guarded by declared draft ownership.
          // They cannot establish validated path ownership over unrelated healthy legacy runs.
          if (isolateMalformed) continue;
          throw error;
        }
        if (!intent || intent.phase === 'committed') continue;
        for (const write of [...intent.operation.writes, ...(intent.operation.sources ?? [])]) {
          const match = /^tailoring\/([^/]+)\//.exec(write.path);
          if (match) result.add(match[1]);
        }
      }
    }
    return result;
  }
  createRun(id: string, expected: RevisionToken, operationId: string) {
    return this.createRunWithSlugMode(id, expected, operationId, false);
  }
  private createRunWithSlugMode(id: string, expected: RevisionToken, operationId: string, legacySlug: boolean, prevalidated?: ReturnType<typeof prepareRun>) {
    const prior = this.operations.lookup(operationId);
    if (prior) {
      if (prior.operation.command !== 'create-run' || prior.operation.draftId !== id.toLowerCase() || canonicalJson(prior.operation.expected) !== canonicalJson(expected) || prior.operation.request !== 'setup') {
        throw new DraftRepositoryError(409, 'operation_conflict', 'Operation id was used for a different request');
      }
      const receipt = this.operations.execute(prior.operation);
      return { ...receipt.acknowledgement, slug: (receipt.result as { slug: string }).slug };
    }
    const current = this.get(id);
    if (current.record.kind !== 'setup') throw new DraftRepositoryError(409, 'invalid_kind', 'Create a run from a setup draft');
    const record = current.record;
    const store = new RunStore(this.dependencies.workspaceDir);
    // Serializes slug selection through durable intent publication, without creating a run first.
    const allocation = path.join(this.dependencies.workspaceDir, 'tailoring-drafts', 'run-allocation');
    return withDraftFileLock(allocation, () => {
      const now = this.dependencies.now?.() ?? new Date();
      const allocated = store.allocateSlug(record.payload.label, now, legacySlug ? this.reservedSlugs() : undefined);
      const slug = legacySlug ? allocated : `${allocated.slice(0, 42)}-${operationId}`;
      const prepared = prevalidated ?? prepareRun({ posting: record.payload.posting, base_resume: record.payload.baseResumeId, runner: record.payload.runner, label: record.payload.label }, record.base, loadTailoringConfig(this.dependencies.workspaceDir), this.dependencies.runnerFactory ?? defaultRunnerFactory, slug, now);
      prepared.manifest.slug = slug;
      prepared.manifest.draft_id = record.id;
      const next = DraftRecordSchema.parse({ ...record, kind: 'run', runSlug: slug, originSetup: record.payload, payload: { proposalTextById: {}, artifactTokens: {} } });
      const receipt = this.operations.execute({ operationId, draftId: record.id, command: 'create-run', expected, next, request: 'setup', writes: [
        { path: `tailoring/${slug}/${RUN_FILES.posting}`, expectedHash: null, content: prepared.posting },
        { path: `tailoring/${slug}/${RUN_FILES.manifest}`, expectedHash: null, content: yaml.dump(prepared.manifest, { indent: 2, lineWidth: 120 }) },
      ], result: { slug } });
      return { ...receipt.acknowledgement, slug };
    });
  }
  /** Compatibility entry point: the historical HTTP API now creates a pinned setup first. */
  createLegacyRun(input: CreateRunInput) {
    const id = randomUUID();
    const baseId = typeof input.base_resume === 'string' ? input.base_resume : '';
    const base = this.captureBase(baseId);
    // Validate before creating any recovery row for an invalid legacy request.
    const prepared = prepareRun(input, base, loadTailoringConfig(this.dependencies.workspaceDir), this.dependencies.runnerFactory ?? defaultRunnerFactory, 'validation', this.dependencies.now?.() ?? new Date());
    const draft = this.create({ id, kind: 'setup', payload: { posting: String(input.posting), label: typeof input.label === 'string' ? input.label : '', baseResumeId: baseId, runner: typeof input.runner === 'string' ? input.runner : '' } }, randomUUID());
    const result = this.createRunWithSlugMode(id, draft.token, randomUUID(), true, prepared);
    return new RunStore(this.dependencies.workspaceDir).readManifest(result.slug);
  }
  /** Missing legacy sources stay readable; no historical snapshot is invented. */
  adoptRun(slug: string): DraftEnvelope | undefined {
    const store = new RunStore(this.dependencies.workspaceDir);
    const bytes = store.readText(slug, RUN_FILES.manifest);
    const manifest = bytes === null ? store.readManifest(slug) : RunManifestSchema.parse(yaml.load(bytes));
    if (manifest.draft_id) {
      const draft = this.repository.read(manifest.draft_id);
      if (draft.record.kind !== 'run' || draft.record.runSlug !== slug) throw new DraftRepositoryError(409, 'association_conflict', 'Run and draft association differ');
      return this.establishLegacyCompletion(this.reconcileMissingArtifactTokens(draft, store), store);
    }
    const source = this.dependencies.loadResumes().find((item) => item.id === manifest.base_resume);
    if (!source) return undefined;
    const digest = createHash('sha256').update(this.workspaceId + ':legacy:' + slug).digest('hex');
    const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    const operationId = id;
    const prior = this.operations.lookup(operationId);
    if (prior) { this.operations.execute(prior.operation); return this.repository.read(id); }
    this.assertRunMutationAvailable(slug);
    const hashBytes = (text: string) => createHash('sha256').update(text).digest('hex');
    const applied: Record<string, unknown> = {};
    const sources = [];
    const artifactTokens: DraftArtifactTokens = {};
    for (const name of ['analysis', 'alignment', 'proposals', 'brief'] as const) {
      const file = name === 'brief' ? RUN_FILES.briefData : RUN_FILES[name];
      const text = store.readText(slug, file);
      sources.push({ path: `tailoring/${slug}/${file}`, expectedHash: text === null ? null : hashBytes(text) });
      if (text !== null) { if (name !== 'brief') applied[name] = JSON.parse(text); artifactTokens[name] = { revision: 0, fingerprint: hashBytes(text) }; }
    }
    const baseline = DraftAppliedContentSchema.parse(applied);
    const base = { resumeId: source.id, spec: structuredClone(source.spec), fingerprint: hashBytes(canonicalJson(source.spec)) };
    const notice = 'Legacy run: the historical base is unknown. A snapshot of today’s base was captured; review proposal targets before applying.';
    const next = DraftRecordSchema.parse({ id, schemaVersion: 1, kind: 'run', lifecycle: 'draft', revision: 0, createdAt: manifest.created, editedAt: manifest.updated, savedAt: manifest.updated, runSlug: slug, base, legacyBaseNotice: notice, context: {}, payload: { ...baseline, proposalTextById: {}, artifactTokens }, appliedContent: baseline });
    const associated = { ...manifest, draft_id: id };
    // Existing completed output remains readable. Uncertain targets cannot be approved silently.
    if (baseline.proposals && !manifest.finalized_path) {
      associated.steps = { ...manifest.steps, proposals: { ...manifest.steps.proposals, status: 'stale' as const } };
    }
    this.operations.execute({ operationId, draftId: id, command: 'create-run', expected: null, next, request: 'legacy-adoption', sources, writes: [{ path: `tailoring/${slug}/${RUN_FILES.manifest}`, expectedHash: bytes === null ? null : hashBytes(bytes), content: yaml.dump(associated, { indent: 2, lineWidth: 120 }) }], result: { slug } });
    return this.establishLegacyCompletion(this.repository.read(id), store);
  }
  private establishLegacyCompletion(draft: DraftEnvelope, store: RunStore): DraftEnvelope {
    if (draft.record.kind !== 'run' || draft.record.lifecycle !== 'draft') return draft;
    const record = draft.record, manifest = store.readManifest(record.runSlug!);
    if (!manifest.finalized_path) return draft;
    const outputPath = manifest.finalized_path.replace(/\\/g, '/');
    if (!/^resumes\/(templates|tailored)\/.+\.(yaml|yml|json|md|tex)$/i.test(outputPath) || outputPath.split('/').some(part => part === '..' || part === '.')) throw new DraftRepositoryError(409, 'invalid_output', 'Invalid finalized output path');
    const fullPath = path.join(this.dependencies.workspaceDir, outputPath);
    if (!fs.existsSync(fullPath)) throw new DraftRepositoryError(409, 'missing_output', 'Finalized output is missing; restore the original output before continuing');
    const bytes = fs.readFileSync(fullPath);
    const loaded = this.dependencies.loadResumes().find(resume => resume.filePath?.replace(/\\/g, '/') === outputPath);
    if (!loaded) throw new DraftRepositoryError(409, 'invalid_output', 'Finalized output could not be loaded');
    const sources: NonNullable<DraftOperation['sources']> = [{ path: outputPath, expectedHash: createHash('sha256').update(bytes).digest('hex') }];
    const artifacts: Record<string, unknown> = { base: record.base };
    for (const [key, file] of Object.entries({ manifest: RUN_FILES.manifest, posting: RUN_FILES.posting, analysis: RUN_FILES.analysis, alignment: RUN_FILES.alignment, proposals: RUN_FILES.proposals, brief: RUN_FILES.briefData, briefMarkdown: RUN_FILES.brief })) {
      const text = store.readText(record.runSlug!, file);
      sources.push({ path: `tailoring/${record.runSlug}/${file}`, expectedHash: text === null ? null : completionHash(text) });
      if (text !== null) artifacts[key] = key === 'manifest' ? yaml.load(text) : key === 'posting' || key === 'briefMarkdown' ? text : JSON.parse(text);
    }
    const outputId = randomUUID();
    const completion = { outputId, name: path.basename(outputPath, path.extname(outputPath)), type: outputPath.startsWith('resumes/templates/') ? 'template' : 'tailored', path: outputPath, completedAt: manifest.updated, spec: loaded.spec, runArtifacts: DraftRunArtifactsSchema.parse(artifacts) };
    const next = DraftRecordSchema.parse(JSON.parse(canonicalJson({ ...record, lifecycle: 'completed', completion })));
    return this.operations.execute({ operationId: randomUUID(), draftId: record.id, command: 'complete', expected: draft.token, next, request: { origin: 'legacy-completion' }, sources, writes: [{ path: `tailoring-drafts/completions/${outputId}.json`, expectedHash: null, content: canonicalJson(next) + '\n' }], result: {} }).acknowledgement;
  }
  /** Upgrade runs created before artifact publication tracked recovery baselines. */
  private reconcileMissingArtifactTokens(draft: DraftEnvelope, store: RunStore): DraftEnvelope {
    if (draft.record.kind !== 'run' || !draft.record.runSlug || draft.record.lifecycle !== 'draft') return draft;
    const record = structuredClone(draft.record), slug = record.runSlug!;
    const sources: { path: string; expectedHash: string | null }[] = [];
    for (const step of ['analysis', 'alignment', 'proposals', 'brief'] as const) {
      if (record.payload.artifactTokens[step]) continue;
      const file = step === 'brief' ? RUN_FILES.briefData : RUN_FILES[step];
      const bytes = store.readText(slug, file);
      if (bytes === null) continue;
      const fingerprint = createHash('sha256').update(bytes).digest('hex');
      sources.push({ path: `tailoring/${slug}/${file}`, expectedHash: fingerprint });
      record.payload.artifactTokens[step] = { revision: 0, fingerprint };
      if (step !== 'brief') {
        const baseline = DraftAppliedContentSchema.parse({ [step]: JSON.parse(bytes) });
        record.payload = { ...record.payload, [step]: mergeGenerated(record.appliedContent[step], record.payload[step], baseline[step]) };
        record.appliedContent = { ...record.appliedContent, [step]: baseline[step] };
      }
    }
    if (sources.length === 0) return draft;
    const manifestBytes = store.readText(slug, RUN_FILES.manifest)!;
    sources.push({ path: `tailoring/${slug}/${RUN_FILES.manifest}`, expectedHash: createHash('sha256').update(manifestBytes).digest('hex') });
    return this.operations.execute({ operationId: randomUUID(), draftId: record.id, command: 'sync', expected: draft.token,
      next: record, contentChanged: false, request: { origin: 'initialize-artifact-tokens' }, sources, writes: [], result: { slug },
    }).acknowledgement;
  }
  /** Captured bytes must still belong to the server's reviewed artifact baseline.
   * Journal sources/writes subsequently enforce these same hashes under ownership. */
  assertArtifactTokens(draft: DraftEnvelope, sources: { path: string; expectedHash: string | null }[], steps: readonly (keyof DraftArtifactTokens)[] = ['analysis', 'alignment', 'proposals', 'brief']): void {
    if (draft.record.kind !== 'run') return;
    for (const step of steps) {
      const file = step === 'brief' ? RUN_FILES.briefData : RUN_FILES[step];
      const source = sources.find((item) => item.path === `tailoring/${draft.record.runSlug}/${file}`);
      if (!source || source.expectedHash !== (draft.record.payload.artifactTokens[step]?.fingerprint ?? null)) {
        throw new DraftRepositoryError(409, 'artifact_conflict', `The ${step} artifact changed outside the draft; review and reconcile it before continuing`);
      }
    }
  }
  publishStep(input: {
    draft: DraftEnvelope; step: keyof DraftAppliedContent | 'brief'; data: unknown; manifest: RunManifest;
    operationId: string; command: 'apply' | 'sync'; request: NonNullable<DraftOperation['request']>; result?: DraftOperation['result'];
    sources: { path: string; expectedHash: string | null }[];
    consumeBuffers?: boolean; briefMarkdown?: string;
  }) {
    const { draft, step, manifest } = input;
    if (draft.record.kind !== 'run') throw new DraftRepositoryError(409, 'invalid_kind', 'Expected run draft');
    this.assertArtifactTokens(draft, input.sources);
    const record = draft.record;
    const data = step === 'brief' ? undefined : DraftAppliedContentSchema.parse(JSON.parse(JSON.stringify({ [step]: input.data })))[step];
    const content = JSON.stringify(input.data, null, 2) + '\n';
    const fingerprint = createHash('sha256').update(content).digest('hex');
    const currentToken = record.payload.artifactTokens[step];
    const payload = { ...record.payload,
      ...(step === 'brief' ? {} : { [step]: input.command === 'apply' ? data : mergeGenerated(record.appliedContent[step], record.payload[step], data) }),
      artifactTokens: { ...record.payload.artifactTokens, [step]: { revision: (currentToken?.revision ?? -1) + 1, fingerprint } },
      ...(input.consumeBuffers ? { proposalTextById: {} } : {}),
    };
    const upstreamSync = record.upstreamSync ? { ...record.upstreamSync,
      staleSteps: record.upstreamSync.staleSteps.filter(stale => stale !== step),
      reviewProposalIds: step === 'proposals' ? (canonicalJson(input.request) === canonicalJson({ origin: 'generation', step }) ? [] : record.upstreamSync.reviewProposalIds.filter(id => payload.proposals?.proposals.some(p => p.id === id && p.decision !== 'rejected'))) : record.upstreamSync.reviewProposalIds,
    } : undefined;
    const next = DraftRecordSchema.parse({ ...record, ...(upstreamSync ? { upstreamSync } : {}), payload, appliedContent: step === 'brief' ? record.appliedContent : { ...record.appliedContent, [step]: data } });
    const file = `tailoring/${manifest.slug}/${step === 'brief' ? RUN_FILES.briefData : RUN_FILES[step]}`;
    const manifestPath = `tailoring/${manifest.slug}/${RUN_FILES.manifest}`;
    const expectedHash = (name: string) => {
      const source = input.sources.find((item) => item.path === name);
      if (!source) throw new Error('Publication requires captured artifact and manifest sources');
      return source.expectedHash;
    };
    const writes = [{ path: file, expectedHash: expectedHash(file), content },
      { path: manifestPath, expectedHash: expectedHash(manifestPath), content: yaml.dump(manifest, { indent: 2, lineWidth: 120 }) }];
    if (step === 'brief') {
      if (input.briefMarkdown === undefined) throw new Error('Brief publication requires markdown');
      const markdownPath = `tailoring/${manifest.slug}/${RUN_FILES.brief}`;
      writes.push({ path: markdownPath, expectedHash: expectedHash(markdownPath), content: input.briefMarkdown });
    }
    return this.operations.execute({ operationId: input.operationId, draftId: record.id, command: input.command,
      expected: draft.token, next, contentChanged: input.command === 'apply', request: input.request, sources: input.sources.filter((source) => !writes.some((write) => write.path === source.path)), writes,
      result: input.result ?? { slug: manifest.slug, step },
    }).acknowledgement;
  }
  prepareCompletion?: (slug: string) => { spec: ResumeSpec; preflight: Record<string, unknown> };
  completionPreflight?: (spec: ResumeSpec) => Record<string, unknown>;
  complete(id: string, expected: RevisionToken, operationId: string, options: { name?: string; type?: 'template' | 'tailored' } = {}) {
    const parsed = z.object({ name: z.string().trim().min(1).max(512).optional(), type: z.enum(['template', 'tailored']).optional() }).strict().parse(options);
    const request = JSON.parse(JSON.stringify({ id, expected, options: parsed }));
    const prior = this.operations.lookup(operationId);
    if (prior) {
      if (prior.operation.command !== 'complete' || canonicalJson(prior.operation.request) !== canonicalJson(request)) throw new DraftRepositoryError(409, 'operation_conflict', 'Operation id was used for another request');
      const result = this.operations.execute(prior.operation);
      return { ...result.acknowledgement, ...(result.result as object), completion: result.acknowledgement.record.completion! };
    }
    DraftRevisionTokenSchema.parse(expected);
    const draft = this.get(id), record = draft.record;
    if (canonicalJson(draft.token) !== canonicalJson(expected)) throw new DraftRepositoryError(409, 'stale_revision', 'Draft changed before completion');
    if (record.lifecycle !== 'draft' || record.kind === 'setup') throw new DraftRepositoryError(409, 'invalid_lifecycle', 'Only an editable manual or run draft can complete');
    let spec: ResumeSpec, preflight: Record<string, unknown> = {};
    const sources: NonNullable<DraftOperation['sources']> = [], writes: DraftOperation['writes'] = [];
    let runArtifacts;
    if (record.kind === 'manual') {
      const payload = record.payload;
      spec = ResumeSpecSchema.parse({ profile: payload.profile, summary: payload.summary, education: payload.education, skills: payload.skills,
        experiences: payload.experiences.map(({ id: _id, bullets, ...experience }) => ({ ...experience, bullets: bullets.filter(b => b.included).map(({ id: _id, included: _included, ...b }) => b) })) });
      preflight = this.completionPreflight?.(spec) ?? {};
    } else {
      if (!this.prepareCompletion) throw new Error('Run completion preparation unavailable');

      const store = new RunStore(this.dependencies.workspaceDir), artifacts: Record<string, unknown> = {};
      for (const [key, file] of Object.entries({ manifest: RUN_FILES.manifest, posting: RUN_FILES.posting, analysis: RUN_FILES.analysis, alignment: RUN_FILES.alignment, proposals: RUN_FILES.proposals, brief: RUN_FILES.briefData, briefMarkdown: RUN_FILES.brief, resume: RUN_FILES.resume })) {
        const text = store.readText(record.runSlug!, file); sources.push({ path: `tailoring/${record.runSlug}/${file}`, expectedHash: text === null ? null : completionHash(text) });
        if (text !== null) artifacts[key] = key === 'manifest' ? yaml.load(text) : key === 'posting' || key === 'briefMarkdown' || key === 'resume' ? text : JSON.parse(text);
      }
      this.assertArtifactTokens(draft, sources);
      const prepared = this.prepareCompletion(record.runSlug!); spec = prepared.spec; preflight = prepared.preflight;
      runArtifacts = DraftRunArtifactsSchema.parse({ ...Object.fromEntries(Object.entries(artifacts).filter(([key]) => key !== 'resume')), base: record.base });
    }
    const outputId = randomUUID(), name = parsed.name ?? record.runSlug ?? 'Resume variant', type = parsed.type ?? 'tailored';
    const filename = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'resume'}-${outputId}`;
    const outputPath = `resumes/${type === 'template' ? 'templates' : 'tailored'}/${filename}.yaml`;
    const completion = { outputId, name, type, path: outputPath, completedAt: (this.dependencies.now?.() ?? new Date()).toISOString(), spec, ...(runArtifacts ? { runArtifacts } : {}) };
    const next = DraftRecordSchema.parse({ ...record, lifecycle: 'completed', completion });
    writes.push({ path: `tailoring-drafts/completions/${outputId}.json`, expectedHash: null, content: canonicalJson(next) + '\n' }, { path: outputPath, expectedHash: null, content: yaml.dump(spec, { indent: 2, lineWidth: 120 }) });
    if (runArtifacts) {
      const file = `tailoring/${record.runSlug}/${RUN_FILES.manifest}`;
      writes.push({ path: file, expectedHash: sources.find(source => source.path === file)!.expectedHash, content: yaml.dump({ ...runArtifacts.manifest, finalized_path: outputPath }, { indent: 2, lineWidth: 120 }) });
    }
    const result = this.operations.execute({ operationId, draftId: id, command: 'complete', expected, request, next, sources: sources.filter(source => !writes.some(write => write.path === source.path)), writes, result: JSON.parse(JSON.stringify({ filePath: outputPath, preflight })) });
    return { ...result.acknowledgement, ...(result.result as object), completion: result.acknowledgement.record.completion! };
  }
  continue(id: string, expected: RevisionToken, operationId: string) {
    const request = { id, expected };
    const prior = this.operations.lookup(operationId);
    if (prior) {
      if (prior.operation.command !== 'continue' || canonicalJson(prior.operation.request) !== canonicalJson(request)) throw new DraftRepositoryError(409, 'operation_conflict', 'Operation id was used for another request');
      return this.operations.execute(prior.operation).acknowledgement;
    }
    const draft = this.get(id);
    if (canonicalJson(draft.token) !== canonicalJson(expected)) throw new DraftRepositoryError(409, 'stale_revision', 'Completed version changed');
    if (draft.record.lifecycle !== 'completed' || !draft.record.completion) throw new DraftRepositoryError(409, 'invalid_lifecycle', 'Continue requires a completed version');
    const snapshotPath = `tailoring-drafts/completions/${z.string().uuid().parse(draft.record.completion.outputId)}.json`;
    const bytes = fs.readFileSync(path.join(this.dependencies.workspaceDir, snapshotPath), 'utf8');
    const snapshot = DraftRecordSchema.parse(JSON.parse(bytes));
    if (snapshot.id !== id || snapshot.lifecycle !== 'completed' || canonicalJson(snapshot.completion) !== canonicalJson(draft.record.completion)) throw new DraftRepositoryError(409, 'invalid_snapshot', 'Completed snapshot identity differs');
    const freshId = randomUUID(), now = (this.dependencies.now?.() ?? new Date()).toISOString();
    const { completion: _completion, ...inherited } = snapshot;
    const next = DraftRecordSchema.parse({ ...inherited, id: freshId, lifecycle: 'draft', parentCompletionId: snapshot.completion!.outputId, revision: 0, createdAt: now, savedAt: now, editedAt: now });
    const writes: DraftOperation['writes'] = [];
    if (next.kind === 'run') {
      const artifacts = snapshot.completion!.runArtifacts;
      if (!artifacts) throw new DraftRepositoryError(409, 'missing_snapshot', 'Completed run artifacts are missing');
      const slug = `continued-${freshId}`; next.runSlug = slug;
      const manifest = { ...artifacts.manifest, slug, draft_id: freshId, finalized_path: null, created: now, updated: now };
      writes.push({ path: `tailoring/${slug}/${RUN_FILES.manifest}`, expectedHash: null, content: yaml.dump(manifest, { indent: 2, lineWidth: 120 }) }, { path: `tailoring/${slug}/${RUN_FILES.posting}`, expectedHash: null, content: artifacts.posting }, { path: `tailoring/${slug}/${RUN_FILES.resume}`, expectedHash: null, content: yaml.dump(snapshot.completion!.spec, { indent: 2, lineWidth: 120 }) });
      if (artifacts.briefMarkdown !== undefined) writes.push({ path: `tailoring/${slug}/${RUN_FILES.brief}`, expectedHash: null, content: artifacts.briefMarkdown });
      next.payload.artifactTokens = {};
      for (const step of ['analysis', 'alignment', 'proposals', 'brief'] as const) {
        if (!artifacts[step]) continue;
        const content = JSON.stringify(artifacts[step], null, 2) + '\n';
        writes.push({ path: `tailoring/${slug}/${step === 'brief' ? RUN_FILES.briefData : RUN_FILES[step]}`, expectedHash: null, content });
        next.payload.artifactTokens[step] = { revision: 0, fingerprint: completionHash(content) };
      }
    }
    return this.operations.execute({ operationId, draftId: freshId, command: 'continue', expected: null, request, next, sources: [{ path: snapshotPath, expectedHash: completionHash(bytes) }], writes, result: {} }).acknowledgement;
  }
  ownsCompletedOutput(file: string): boolean {
    const normalized = path.resolve(this.dependencies.workspaceDir, file).toLowerCase();
    return this.repository.list().records.some(({ record }) => record.completion && path.resolve(this.dependencies.workspaceDir, record.completion.path).toLowerCase() === normalized);
  }
  discard(id: string, expected: RevisionToken, operationId: string) {
    const request = { origin: 'discard-unapplied', id, expected };
    const prior = this.operations.lookup(operationId);
    if (prior) {
      if (prior.operation.command !== 'sync' || canonicalJson(prior.operation.request) !== canonicalJson(request)) throw new DraftRepositoryError(409, 'operation_conflict', 'Operation id was used for a different request');
      return this.operations.execute(prior.operation).acknowledgement;
    }
    const draft = this.repository.read(id);
    if (draft.record.kind !== 'run') return this.repository.discard(id, expected, operationId);
    const record = draft.record;
    const store = new RunStore(this.dependencies.workspaceDir);
    const sources = ['analysis', 'alignment', 'proposals', 'brief', 'manifest'].map(step => {
      const file = step === 'brief' ? RUN_FILES.briefData : RUN_FILES[step as 'analysis' | 'alignment' | 'proposals' | 'manifest'];
      const bytes = store.readText(record.runSlug!, file);
      return { path: `tailoring/${record.runSlug}/${file}`, expectedHash: bytes === null ? null : createHash('sha256').update(bytes).digest('hex') };
    });
    this.assertArtifactTokens(draft, sources);
    return this.operations.execute({ operationId, draftId: record.id, command: 'sync', expected, request, sources, writes: [], result: {},
      next: { ...record, payload: { ...record.appliedContent, proposalTextById: {}, artifactTokens: record.payload.artifactTokens } },
    }).acknowledgement;
  }
  /** A recovery snapshot is content, never authority to inherit a workflow approval. */
  fork(id: string, expected: RevisionToken, operationId: string, sourceSnapshot: unknown) {
    const source = DraftRecordSchema.parse(sourceSnapshot);
    if (source.id !== z.string().uuid().parse(id).toLowerCase()) throw new DraftRepositoryError(400, 'invalid_source', 'Recovery draft identity differs');
    const request = JSON.parse(JSON.stringify({ id, expected, sourceSnapshot: source }));
    const prior = this.operations.lookup(operationId);
    if (prior) {
      if (prior.operation.command !== 'fork' || canonicalJson(prior.operation.request) !== canonicalJson(request)) throw new DraftRepositoryError(409, 'operation_conflict', 'Operation id was used for a different request');
      return this.operations.execute(prior.operation).acknowledgement;
    }
    // Setup permits source selection before its next snapshot is captured.
    // Manual recovery must retain its own consistent historical base.
    let base = source.base;
    const selected = source.kind === 'setup' ? source.payload.baseResumeId : source.kind === 'manual' ? source.payload.selectedResumeId : base?.resumeId;
    if (selected !== base?.resumeId) {
      if (source.kind !== 'setup') throw new DraftRepositoryError(400, 'invalid_base', 'Manual recovery source must match its pinned base');
      try { base = this.captureBase(selected ?? ''); }
      catch (error) { if (!(error instanceof DraftRepositoryError) || error.code !== 'invalid_base') throw error; base = null; }
    }
    if (base) base = { ...base, fingerprint: createHash('sha256').update(canonicalJson(base.spec)).digest('hex') };
    const now = this.dependencies.now?.() ?? new Date();
    const freshId = randomUUID();
    const common = { schemaVersion: 1, id: freshId, lifecycle: 'draft', revision: 0, createdAt: now.toISOString(), editedAt: now.toISOString(), savedAt: now.toISOString(), context: source.context, base, appliedContent: {} };
    let next;
    const writes: DraftOperation['writes'] = [];
    if (source.kind === 'run') {
      const slug = `recovered-${freshId}`;
      const payload = structuredClone(source.payload);
      payload.artifactTokens = {};
      // Candidate choices are editable recovery content. Validation findings are
      // derived again on Apply; manifest approvals and applied content stay empty.
      payload.proposals?.proposals.forEach(proposal => { proposal.checks = []; });
      const step = () => ({ status: 'pending' as const, completed_at: null, input_hash: null, error: null, raw_output: null });
      let posting = source.originSetup?.posting ?? '';
      if (!posting) {
        try { const parent = this.repository.read(id).record; if (parent.kind === 'run' && parent.runSlug) posting = new RunStore(this.dependencies.workspaceDir).readText(parent.runSlug, RUN_FILES.posting) ?? ''; }
        catch (error) { if (!(error instanceof DraftRepositoryError) || error.status !== 404) throw error; }
      }
      const manifest = RunManifestSchema.parse({ slug, draft_id: freshId, title: source.originSetup?.label ?? 'Recovered draft', created: now.toISOString(), updated: now.toISOString(), runner: source.originSetup?.runner || loadTailoringConfig(this.dependencies.workspaceDir).runner.default, model: '', base_resume: base!.resumeId, state: 'draft', error: null, finalized_path: null, steps: { analysis: step(), alignment: step(), proposals: step(), brief: step() } });
      next = DraftRecordSchema.parse({ ...common, kind: 'run', runSlug: slug, payload, ...(source.originSetup ? { originSetup: source.originSetup } : {}), legacyBaseNotice: 'Recovered edits require review and Apply. Historical approvals and artifacts were not copied.' });
      writes.push({ path: `tailoring/${slug}/${RUN_FILES.posting}`, expectedHash: null, content: posting }, { path: `tailoring/${slug}/${RUN_FILES.manifest}`, expectedHash: null, content: yaml.dump(manifest, { indent: 2, lineWidth: 120 }) });
    } else next = DraftRecordSchema.parse({ ...common, kind: source.kind, payload: source.payload });
    return this.operations.execute({ operationId, draftId: freshId, command: 'fork', expected: null, next, request, writes, result: {} }).acknowledgement;
  }
}

/** Three-way publication: untouched fields follow generation; edited arrays remain intact. */
function mergeGenerated(baseline: unknown, edited: unknown, generated: unknown): unknown {
  if (canonicalJson(edited ?? null) === canonicalJson(baseline ?? null)) return generated;
  if (baseline && edited && generated && !Array.isArray(edited) && !Array.isArray(generated) && typeof baseline === 'object' && typeof edited === 'object' && typeof generated === 'object') {
    const old = baseline as Record<string, unknown>, current = edited as Record<string, unknown>, next = generated as Record<string, unknown>;
    return Object.fromEntries([...new Set([...Object.keys(current), ...Object.keys(next)])].map((key) => [key, mergeGenerated(old[key], current[key], next[key])]));
  }
  return edited;
}

const completionHash = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
