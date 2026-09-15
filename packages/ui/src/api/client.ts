import type {
  EvidenceEntry,
  EvidenceRecord,
  LevelingRubric,
  RubricGapAnalysis,
  ResumeSpec,
} from '@featherduster/core';

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
      try {
        const errorData = await res.json();
        if (errorData.error) {
          errorMessage = errorData.error;
        } else if (errorData.message) {
          errorMessage = errorData.message;
        }
      } catch {
        // Fallback to status text
      }
      throw new Error(errorMessage);
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
}

export const apiClient = new ApiClient();
