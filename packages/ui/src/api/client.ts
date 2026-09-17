import type {
  AlignmentMatrix,
  EvidenceEntry,
  EvidenceRecord,
  JobAnalysis,
  LevelingRubric,
  Proposal,
  RubricGapAnalysis,
  ResumeSpec,
  RunManifest,
  RunState,
  TailoringStep,
} from '@featherduster/core';

/** Error thrown for non-2xx API responses; keeps the server's machine-readable code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly detail?: unknown;
  constructor(message: string, status: number, code?: string, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export type RunnerId = 'claude-code' | 'anthropic-api' | 'ollama' | 'fake';

export interface RunnerInfo {
  id: RunnerId;
  label: string;
  locality: 'local' | 'cloud';
  model: string;
  isDefault: boolean;
  available: boolean;
  detail: string;
}

export interface RunnersResponse {
  runners: RunnerInfo[];
  consent: Partial<Record<RunnerId, string>>;
}

export type TailoringRunSummary = RunManifest & { needs_review: boolean };

export type TailoringCitations = Record<string, Array<{ slug: string; title: string }>>;

export interface TailoringRunDetail {
  manifest: RunManifest;
  posting: string;
  base_resume: ResumeSpec | null;
  analysis: JobAnalysis | null;
  alignment: AlignmentMatrix | null;
  alignment_summary: { backed: number; transferable: number; gap: number } | null;
  proposals: Proposal[] | null;
  page_budget: { overBy: number; proposalIds: string[] } | null;
  resume: ResumeSpec | null;
  brief_markdown: string | null;
}

export interface TailoringEvent {
  slug: string;
  step: TailoringStep | null;
  kind: 'status' | 'token' | 'state';
  text?: string;
  state?: RunState;
}

export interface FinalizeResponse {
  filePath: string;
  preflight: {
    isClean: boolean;
    danglingCitations: string[];
    metricIssues: unknown[];
    violations: string[];
    slop: { score: number; band: string; summary: string };
  };
}

export type GapAnalysisResult = RubricGapAnalysis;

export interface HealthResponse {
  status: string;
  workspaceDir: string;
}

export interface EvidenceFilters {
  company?: string;
  theme?: string;
  search?: string;
  confidence?: 'verified' | 'provisional' | 'retracted' | string;
  in_flight?: boolean;
  hasMissingMetrics?: boolean;
}

export interface SaveEvidencePayload {
  entry: EvidenceEntry;
  narrative?: string;
  filePath?: string;
}

export interface SaveEvidenceResponse {
  success: boolean;
  entry: EvidenceEntry;
  error?: string;
}

export interface IntegrityIssue {
  file: string;
  type: 'dangling_citation' | 'missing_metric' | 'unverified_metric' | 'banned_keyword' | string;
  message: string;
  line?: number;
  keyword?: string;
  citation?: string;
}

export interface IntegrityCheckResponse {
  isClean: boolean;
  issues: IntegrityIssue[];
}

export interface CompileResumeResponse {
  output: string;
  violations: string[];
  isClean: boolean;
}

export interface ImportRubricPayload {
  rawTable?: string;
  rubric?: LevelingRubric | any;
  id?: string;
  title?: string;
  target_level?: string;
}

export interface ImportRubricResponse {
  success: boolean;
  rubric: LevelingRubric;
  error?: string;
}

export interface ResumeRecord {
  id: string;
  name: string;
  type: 'template' | 'tailored' | string;
  filePath: string;
  spec: ResumeSpec;
}

export interface SaveResumeResponse {
  success: boolean;
  name: string;
  filePath?: string;
  error?: string;
}

export interface PreflightResult {
  isClean: boolean;
  validCitations: string[];
  danglingCitations: string[];
  metricIssues: Array<{ type: string; message: string; line?: number }>;
  violations: string[];
  redactedText: string;
  slop?: {
    isClean: boolean;
    score: number;
    slopBand: 'clean' | 'low' | 'moderate' | 'high';
    matches: Array<{
      type: string;
      patternName: string;
      matchedText: string;
      line?: number;
    }>;
    summary: string;
  };
  slopIssues?: Array<{
    type: string;
    patternName: string;
    matchedText: string;
    line?: number;
  }>;
  error?: string;
}

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl;
  }

  private async fetchJson<T>(endpoint: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        'Accept': 'application/json',
        ...init?.headers,
      },
    });

    if (!res.ok) {
      let errorMessage = `API Error ${res.status}: ${res.statusText}`;
      let code: string | undefined;
      let detail: unknown;
      try {
        const errorData = await res.json();
        if (errorData.error) {
          errorMessage = errorData.error;
        } else if (errorData.message) {
          errorMessage = errorData.message;
        }
        code = typeof errorData.code === 'string' ? errorData.code : undefined;
        detail = errorData.detail;
      } catch {
        // Fallback to status text
      }
      throw new ApiError(errorMessage, res.status, code, detail);
    }

    return res.json() as Promise<T>;
  }

  /**
   * Health check and active workspace inspection
   */
  async getHealth(): Promise<HealthResponse> {
    return this.fetchJson<HealthResponse>('/api/health');
  }

  /**
   * List and filter evidence entries
   */
  async getEvidence(filters?: EvidenceFilters): Promise<EvidenceRecord[]> {
    const params = new URLSearchParams();
    if (filters) {
      if (filters.company) params.set('company', filters.company);
      if (filters.theme) params.set('theme', filters.theme);
      if (filters.search) params.set('search', filters.search);
      if (filters.confidence && filters.confidence !== 'all') {
        params.set('confidence', filters.confidence);
      }
      if (filters.in_flight !== undefined) {
        params.set('in_flight', String(filters.in_flight));
      }
      if (filters.hasMissingMetrics !== undefined) {
        params.set('hasMissingMetrics', String(filters.hasMissingMetrics));
      }
    }
    const query = params.toString();
    const endpoint = query ? `/api/evidence?${query}` : '/api/evidence';
    return this.fetchJson<EvidenceRecord[]>(endpoint);
  }

  /**
   * Create or update an evidence entry
   */
  async saveEvidence(
    entry: EvidenceEntry,
    narrative: string = '',
    filePath?: string
  ): Promise<SaveEvidenceResponse> {
    return this.fetchJson<SaveEvidenceResponse>('/api/evidence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry, narrative, filePath }),
    });
  }

  /**
   * List rubrics
   */
  async getRubrics(): Promise<LevelingRubric[]> {
    return this.fetchJson<LevelingRubric[]>('/api/rubrics');
  }

  /**
   * Import or save a leveling rubric
   */
  async importRubric(data: ImportRubricPayload): Promise<ImportRubricResponse> {
    return this.fetchJson<ImportRubricResponse>('/api/rubrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  /**
   * Compute rubric gap analysis
   */
  async getGapAnalysis(rubricId: string, targetLevel?: string): Promise<GapAnalysisResult> {
    const params = new URLSearchParams({ rubricId });
    if (targetLevel) params.set('targetLevel', targetLevel);
    return this.fetchJson<GapAnalysisResult>(`/api/rubrics/gap-analysis?${params.toString()}`);
  }

  /**
   * Compile tailored resume or brag doc
   */
  async compileResume(
    spec: ResumeSpec | Record<string, any>,
    format: 'markdown' | 'html' | 'typst' | 'latex' | 'brag' | string
  ): Promise<CompileResumeResponse> {
    return this.fetchJson<CompileResumeResponse>('/api/resumes/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec, format }),
    });
  }

  /**
   * Run workspace integrity audit
   */
  async getIntegrityCheck(): Promise<IntegrityCheckResponse> {
    return this.fetchJson<IntegrityCheckResponse>('/api/integrity/check');
  }

  /**
   * List resume specs (templates & tailored variants)
   */
  async getResumes(): Promise<ResumeRecord[]> {
    return this.fetchJson<ResumeRecord[]>('/api/resumes');
  }

  /**
   * Save a tailored variant or template resume spec
   */
  async saveResume(
    name: string,
    spec: ResumeSpec,
    type: 'tailored' | 'template' | string = 'tailored'
  ): Promise<SaveResumeResponse> {
    return this.fetchJson<SaveResumeResponse>('/api/resumes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, spec, type }),
    });
  }

  /**
   * Run comprehensive pre-flight integrity audit on spec or text
   */
  async runPreflight(payload: { spec?: ResumeSpec; text?: string }): Promise<PreflightResult> {
    return this.fetchJson<PreflightResult>('/api/integrity/preflight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  /**
   * Automatically de-slop text by stripping buzzwords, empty hedging stems, and passive throat-clearing
   */
  async deslopText(
    text: string
  ): Promise<{ success: boolean; cleanedText: string; fixesApplied: string[] }> {
    return this.fetchJson<{ success: boolean; cleanedText: string; fixesApplied: string[] }>(
      '/api/integrity/deslop',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Skill-driven tailoring runs
  // ---------------------------------------------------------------------------

  async getRunners(): Promise<RunnersResponse> {
    return this.fetchJson<RunnersResponse>('/api/runners');
  }

  async grantRunnerConsent(runner: RunnerId): Promise<{ success: boolean }> {
    return this.fetchJson('/api/runners/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runner }),
    });
  }

  async getTailoringCitations(): Promise<TailoringCitations> {
    return this.fetchJson<TailoringCitations>('/api/tailoring-citations');
  }

  async updateEvidence(
    id: string,
    entry: EvidenceEntry,
    narrative: string
  ): Promise<{ success: boolean; entry: EvidenceEntry; filePath: string }> {
    return this.fetchJson(`/api/evidence/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry, narrative }),
    });
  }

  async listTailoringRuns(): Promise<TailoringRunSummary[]> {
    const res = await this.fetchJson<{ runs: TailoringRunSummary[] }>('/api/tailoring');
    return res.runs;
  }

  async createTailoringRun(payload: {
    posting: string;
    base_resume: string;
    runner: RunnerId;
    label?: string;
  }): Promise<{ slug: string; manifest: RunManifest }> {
    return this.fetchJson('/api/tailoring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async getTailoringRun(slug: string): Promise<TailoringRunDetail> {
    return this.fetchJson<TailoringRunDetail>(`/api/tailoring/${encodeURIComponent(slug)}`);
  }

  async runTailoringStep(slug: string, step: TailoringStep): Promise<{ started: boolean }> {
    return this.fetchJson(`/api/tailoring/${encodeURIComponent(slug)}/steps/${step}/run`, { method: 'POST' });
  }

  async previewTailoringStep(
    slug: string,
    step: TailoringStep
  ): Promise<{ runner: string; locality: 'local' | 'cloud'; system: string; prompt: string }> {
    return this.fetchJson(`/api/tailoring/${encodeURIComponent(slug)}/steps/${step}/preview`);
  }

  async saveTailoringStep(slug: string, step: TailoringStep, data: unknown): Promise<TailoringRunDetail> {
    return this.fetchJson<TailoringRunDetail>(`/api/tailoring/${encodeURIComponent(slug)}/steps/${step}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  async approveTailoringStep(slug: string, step: TailoringStep): Promise<TailoringRunDetail> {
    return this.fetchJson<TailoringRunDetail>(`/api/tailoring/${encodeURIComponent(slug)}/steps/${step}/approve`, {
      method: 'POST',
    });
  }

  async cancelTailoringRun(slug: string): Promise<{ cancelled: boolean }> {
    return this.fetchJson(`/api/tailoring/${encodeURIComponent(slug)}/cancel`, { method: 'POST' });
  }

  async finalizeTailoringRun(slug: string): Promise<FinalizeResponse> {
    return this.fetchJson<FinalizeResponse>(`/api/tailoring/${encodeURIComponent(slug)}/finalize`, { method: 'POST' });
  }
}

export const apiClient = new ApiClient();
