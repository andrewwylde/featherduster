import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Sparkles,
  ShieldCheck,
  Printer,
  Copy,
  Download,
  Plus,
  Trash2,
  Check,
  RefreshCw,
  AlertTriangle,
  Save,
  CheckCircle2,
  Layers,
  ChevronDown,
  ChevronRight,
  User,
  GraduationCap,
  Wrench,
} from 'lucide-react';
import {
  apiClient,
  type ResumeRecord,
  type PreflightResult,
} from '../api/client';
import { PreFlightModal } from '../components/PreFlightModal';
import { EvidencePickerModal } from '../components/EvidencePickerModal';
import {
  cleanSlop,
  type EvidenceRecord,
  type ResumeSpec,
  type ResumeEducation,
  type ResumeSkillGroup,
} from '@featherduster/core';

interface ModularBullet {
  id: string;
  text: string;
  citations?: string[];
  included: boolean;
}

interface ModularExperience {
  id: string;
  company: string;
  role: string;
  location?: string;
  startDate: string;
  endDate: string;
  bullets: ModularBullet[];
}

type CompilerFormat = 'markdown' | 'html' | 'typst' | 'latex';

export const ResumeTailor: React.FC = () => {
  // Remote data state
  const [resumes, setResumes] = useState<ResumeRecord[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<string>('');
  const [evidenceList, setEvidenceList] = useState<EvidenceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Resume Spec Editing State
  const [profile, setProfile] = useState<ResumeSpec['profile']>({
    name: '',
    title: '',
    email: '',
    phone: '',
    location: '',
    links: { github: '', linkedin: '', website: '' },
  });
  const [summary, setSummary] = useState('');
  const [experiences, setExperiences] = useState<ModularExperience[]>([]);
  const [education, setEducation] = useState<ResumeEducation[]>([]);
  const [skills, setSkills] = useState<ResumeSkillGroup[]>([]);

  // Target Job Description State
  const [jobDescription, setJobDescription] = useState('');

  // Right Pane: Compiler & Format State
  const [activeFormat, setActiveFormat] = useState<CompilerFormat>('markdown');
  const [compiledOutput, setCompiledOutput] = useState('');
  const [compiling, setCompiling] = useState(false);
  const [copied, setCopied] = useState(false);

  // Pre-Flight Gate State
  const [preflightStatus, setPreflightStatus] = useState<PreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [isPreflightModalOpen, setIsPreflightModalOpen] = useState(false);

  // Evidence Picker State
  const [pickerExperienceId, setPickerExperienceId] = useState<string | null>(null);

  // Save Variant Dialog State
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [saveVariantName, setSaveVariantName] = useState('');
  const [saveVariantType, setSaveVariantType] = useState<'tailored' | 'template'>('tailored');
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);

  // De-Slop Feedback State
  const [deslopBanner, setDeslopBanner] = useState<string | null>(null);
  const [deslopping, setDeslopping] = useState(false);

  // Collapsible UI sections
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [showSkillsEditor, setShowSkillsEditor] = useState(false);
  const [showEduEditor, setShowEduEditor] = useState(false);

  // Build current active spec containing only included bullets
  const currentSpec: ResumeSpec = useMemo(() => {
    return {
      profile,
      summary,
      experiences: experiences.map((exp) => ({
        company: exp.company,
        role: exp.role,
        location: exp.location,
        startDate: exp.startDate,
        endDate: exp.endDate,
        bullets: exp.bullets
          .filter((b) => b.included)
          .map((b) => ({
            text: b.text,
            citations: b.citations,
          })),
      })),
      education,
      skills,
    };
  }, [profile, summary, experiences, education, skills]);

  // Load initial data
  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      const [resumesData, evidenceData] = await Promise.all([
        apiClient.getResumes(),
        apiClient.getEvidence(),
      ]);
      setResumes(resumesData);
      setEvidenceList(evidenceData);

      if (resumesData.length > 0) {
        const initial = resumesData[0];
        setSelectedResumeId(initial.id);
        applySpec(initial.spec);
      }
    } catch (err) {
      console.error('Failed to load initial resume data', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Helper to load a spec into modular editing state
  const applySpec = (spec: ResumeSpec) => {
    setProfile(spec.profile || {
      name: '',
      title: '',
      email: '',
      phone: '',
      location: '',
      links: {},
    });
    setSummary(spec.summary || '');
    setExperiences(
      (spec.experiences || []).map((exp, expIdx) => ({
        id: `exp-${expIdx}-${Date.now()}`,
        company: exp.company,
        role: exp.role,
        location: exp.location,
        startDate: exp.startDate,
        endDate: exp.endDate,
        bullets: (exp.bullets || []).map((b, bIdx) => ({
          id: `b-${expIdx}-${bIdx}-${Date.now()}`,
          text: b.text,
          citations: b.citations,
          included: true,
        })),
      }))
    );
    setEducation(spec.education || []);
    setSkills(spec.skills || []);
  };

  // Switch loaded resume variant
  const handleSelectResume = (id: string) => {
    setSelectedResumeId(id);
    const found = resumes.find((r) => r.id === id);
    if (found) {
      applySpec(found.spec);
    }
  };

  // Re-compile resume whenever activeFormat or currentSpec changes
  const compileActiveSpec = useCallback(async () => {
    if (!profile.name && experiences.length === 0) return;
    setCompiling(true);
    try {
      const res = await apiClient.compileResume(currentSpec, activeFormat);
      setCompiledOutput(res.output);

      // Also trigger quick background preflight check
      setPreflightLoading(true);
      apiClient
        .runPreflight({ spec: currentSpec })
        .then((pf) => setPreflightStatus(pf))
        .catch(() => setPreflightStatus(null))
        .finally(() => setPreflightLoading(false));
    } catch (err: any) {
      setCompiledOutput(`// Compilation Error:\n${err.message || err}`);
    } finally {
      setCompiling(false);
    }
  }, [currentSpec, activeFormat, profile.name, experiences.length]);

  useEffect(() => {
    const timer = setTimeout(() => {
      compileActiveSpec();
    }, 150);
    return () => clearTimeout(timer);
  }, [compileActiveSpec]);

  // Keyword Matcher computation
  const candidateKeywords = useMemo(() => {
    const set = new Set<string>();
    skills.forEach((g) => g.skills.forEach((s) => set.add(s)));
    evidenceList.forEach((e) => (e.themes || []).forEach((t) => set.add(t)));
    return Array.from(set);
  }, [skills, evidenceList]);

  const { matchedKeywords, unmatchedKeywords } = useMemo(() => {
    if (!jobDescription.trim()) {
      return { matchedKeywords: [], unmatchedKeywords: candidateKeywords };
    }
    const jdLower = jobDescription.toLowerCase();
    const matched: string[] = [];
    const unmatched: string[] = [];

    candidateKeywords.forEach((kw) => {
      const kwLower = kw.toLowerCase();
      // Match word or substring
      if (jdLower.includes(kwLower)) {
        matched.push(kw);
      } else {
        unmatched.push(kw);
      }
    });

    return { matchedKeywords: matched, unmatchedKeywords: unmatched };
  }, [jobDescription, candidateKeywords]);

  // Toggle bullet inclusion
  const handleToggleBullet = (expId: string, bulletId: string) => {
    setExperiences((prev) =>
      prev.map((exp) => {
        if (exp.id !== expId) return exp;
        return {
          ...exp,
          bullets: exp.bullets.map((b) =>
            b.id === bulletId ? { ...b, included: !b.included } : b
          ),
        };
      })
    );
  };

  // Update bullet text
  const handleUpdateBulletText = (expId: string, bulletId: string, text: string) => {
    setExperiences((prev) =>
      prev.map((exp) => {
        if (exp.id !== expId) return exp;
        return {
          ...exp,
          bullets: exp.bullets.map((b) =>
            b.id === bulletId ? { ...b, text } : b
          ),
        };
      })
    );
  };

  // Delete bullet
  const handleDeleteBullet = (expId: string, bulletId: string) => {
    setExperiences((prev) =>
      prev.map((exp) => {
        if (exp.id !== expId) return exp;
        return {
          ...exp,
          bullets: exp.bullets.filter((b) => b.id !== bulletId),
        };
      })
    );
  };

  // Add custom bullet
  const handleAddCustomBullet = (expId: string) => {
    const newBullet: ModularBullet = {
      id: `b-custom-${Date.now()}`,
      text: 'Engineered high-throughput service optimization.',
      included: true,
    };
    setExperiences((prev) =>
      prev.map((exp) =>
        exp.id === expId ? { ...exp, bullets: [...exp.bullets, newBullet] } : exp
      )
    );
  };

  // Insert bullet from Evidence store
  const handleInsertEvidence = (ev: EvidenceRecord) => {
    if (!pickerExperienceId) return;
    const bulletText = ev.summary
      ? `${ev.summary} (${ev.id})`
      : `${ev.title} (${ev.id})`;

    const newBullet: ModularBullet = {
      id: `b-ev-${ev.id}-${Date.now()}`,
      text: bulletText,
      citations: [ev.id],
      included: true,
    };

    setExperiences((prev) =>
      prev.map((exp) =>
        exp.id === pickerExperienceId
          ? { ...exp, bullets: [...exp.bullets, newBullet] }
          : exp
      )
    );
    setPickerExperienceId(null);
  };

  // Add new experience
  const handleAddExperience = () => {
    const newExp: ModularExperience = {
      id: `exp-${Date.now()}`,
      company: 'New Company',
      role: 'Staff Software Engineer',
      location: 'San Francisco, CA',
      startDate: '2025',
      endDate: 'Present',
      bullets: [],
    };
    setExperiences((prev) => [newExp, ...prev]);
  };

  // Delete experience
  const handleDeleteExperience = (expId: string) => {
    setExperiences((prev) => prev.filter((e) => e.id !== expId));
  };

  // Save tailored variant
  const handleSaveVariant = async () => {
    if (!saveVariantName.trim()) return;
    try {
      const res = await apiClient.saveResume(
        saveVariantName.trim(),
        currentSpec,
        saveVariantType
      );
      if (res.success) {
        setSaveSuccessMessage(`Variant saved as ${res.name}.yaml`);
        setIsSaveModalOpen(false);
        setSaveVariantName('');
        // Refresh resume list
        const updated = await apiClient.getResumes();
        setResumes(updated);
        const match = updated.find((r) => r.name === res.name);
        if (match) setSelectedResumeId(match.id);
        setTimeout(() => setSaveSuccessMessage(null), 4000);
      }
    } catch (err: any) {
      alert(`Failed to save variant: ${err.message}`);
    }
  };

  // De-Slop active resume bullets and summary
  const handleDeSlop = useCallback(() => {
    setDeslopping(true);
    let totalFixes = 0;
    const allFixes: string[] = [];

    // Clean summary if present
    let newSummary = summary;
    if (summary) {
      const summaryClean = cleanSlop(summary);
      if (summaryClean.cleanedText !== summary) {
        newSummary = summaryClean.cleanedText;
        totalFixes += summaryClean.fixesApplied.length;
        allFixes.push(...summaryClean.fixesApplied);
      }
    }

    // Clean experience bullets
    let bulletsModified = 0;
    const newExperiences = experiences.map((exp) => {
      const newBullets = exp.bullets.map((bullet) => {
        const cleaned = cleanSlop(bullet.text);
        if (cleaned.cleanedText !== bullet.text) {
          bulletsModified++;
          totalFixes += cleaned.fixesApplied.length;
          allFixes.push(...cleaned.fixesApplied);
          return {
            ...bullet,
            text: cleaned.cleanedText,
          };
        }
        return bullet;
      });
      return {
        ...exp,
        bullets: newBullets,
      };
    });

    if (totalFixes > 0) {
      setSummary(newSummary);
      setExperiences(newExperiences);
      const msg = `De-slopped: Removed ${totalFixes} empty hedge${totalFixes === 1 ? '' : 's'}, preserved all metrics`;
      setDeslopBanner(msg);
    } else {
      setDeslopBanner('De-slopped: Removed 0 empty hedges, preserved all metrics');
    }

    setTimeout(() => {
      setDeslopBanner(null);
    }, 5000);

    setDeslopping(false);
  }, [summary, experiences]);

  // Copy compiled output
  const handleCopyCompiled = async () => {
    if (!compiledOutput) return;
    try {
      await navigator.clipboard.writeText(compiledOutput);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  // Download compiled file
  const handleDownloadCompiled = () => {
    if (!compiledOutput) return;
    const extMap: Record<CompilerFormat, string> = {
      markdown: 'md',
      html: 'html',
      typst: 'typ',
      latex: 'tex',
    };
    const mimeMap: Record<CompilerFormat, string> = {
      markdown: 'text/markdown;charset=utf-8',
      html: 'text/html;charset=utf-8',
      typst: 'text/plain;charset=utf-8',
      latex: 'application/x-latex;charset=utf-8',
    };
    const ext = extMap[activeFormat] || 'txt';
    const mime = mimeMap[activeFormat] || 'text/plain';

    const blob = new Blob([compiledOutput], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `resume_tailored.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Browser Print for HTML preview
  const handlePrintHtml = () => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(compiledOutput);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400 space-y-3">
        <RefreshCw className="w-8 h-8 animate-spin text-purple-400" />
        <p className="text-sm font-medium">Loading Resume Tailoring Canvas...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* View Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            Resume Tailoring Canvas
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-purple-950/50 text-purple-300 border border-purple-500/30">
              Multi-Target ATS
            </span>
          </h1>
          <p className="text-sm text-slate-400">
            Target role descriptions, toggle modular verified bullets, and preview live compiles across ATS Markdown, HTML print, Typst, and LaTeX.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {deslopBanner && (
            <div className="px-3 py-1.5 rounded-xl bg-purple-950/60 border border-purple-500/40 text-purple-200 text-xs font-medium flex items-center gap-2 animate-fadeIn shadow-lg shadow-purple-950/50">
              <Sparkles className="w-4 h-4 text-purple-400 shrink-0" />
              <span>{deslopBanner}</span>
            </div>
          )}

          {saveSuccessMessage && (
            <div className="px-3 py-1.5 rounded-xl bg-emerald-950/50 border border-emerald-500/30 text-emerald-300 text-xs font-medium flex items-center gap-1.5 animate-fadeIn">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>{saveSuccessMessage}</span>
            </div>
          )}
        </div>
      </div>

      {/* 3-Pane Split-Screen Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* ========================================================================= */}
        {/* LEFT PANE: Target Job & Matcher (Col span 3) */}
        {/* ========================================================================= */}
        <div className="xl:col-span-3 space-y-5">
          {/* Variant Loader Dropdown */}
          <div className="p-4 bg-slate-900/70 border border-slate-800 rounded-2xl space-y-3 shadow-md">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-purple-400" />
                Resume Variant
              </label>
              <button
                onClick={() => setIsSaveModalOpen(true)}
                className="text-xs font-medium text-purple-400 hover:text-purple-300 flex items-center gap-1"
              >
                <Save className="w-3 h-3" /> Save Variant
              </button>
            </div>
            <select
              value={selectedResumeId}
              onChange={(e) => handleSelectResume(e.target.value)}
              aria-label="Select resume variant"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-purple-500 font-medium"
            >
              {resumes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.type})
                </option>
              ))}
            </select>
          </div>

          {/* Target Job Description & Requirement Matcher */}
          <div className="p-4 bg-slate-900/70 border border-slate-800 rounded-2xl space-y-3 shadow-md">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                Target Job Description
              </label>
              {jobDescription && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950/40 text-cyan-300 border border-cyan-500/30">
                  {matchedKeywords.length} Matched
                </span>
              )}
            </div>
            <textarea
              rows={6}
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Paste target job specification or hiring requirements here to analyze skill & keyword alignment..."
              className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 leading-relaxed font-sans"
            />

            {/* Keyword Match Highlights */}
            {jobDescription && (
              <div className="space-y-2 pt-2 border-t border-slate-800/80">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
                  <span>Requirement Matcher</span>
                  <span className="text-cyan-400 font-mono">
                    {Math.round(
                      (matchedKeywords.length / Math.max(1, candidateKeywords.length)) * 100
                    )}
                    % Evidence Alignment
                  </span>
                </div>

                {matchedKeywords.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-medium text-emerald-400 uppercase tracking-wider">
                      Matched Skills & Themes
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {matchedKeywords.map((kw) => (
                        <span
                          key={kw}
                          className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 font-medium"
                        >
                          ✓ {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {unmatchedKeywords.length > 0 && (
                  <div className="space-y-1 pt-1">
                    <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
                      Unmatched Profile Skills
                    </p>
                    <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                      {unmatchedKeywords.slice(0, 10).map((kw) => (
                        <span
                          key={kw}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/60 text-slate-400 border border-slate-800"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Candidate Profile Editor */}
          <div className="p-4 bg-slate-900/70 border border-slate-800 rounded-2xl space-y-3 shadow-md">
            <button
              onClick={() => setShowProfileEditor(!showProfileEditor)}
              className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-200"
            >
              <span className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-purple-400" />
                Candidate Profile
              </span>
              {showProfileEditor ? (
                <ChevronDown className="w-4 h-4 text-slate-500" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-500" />
              )}
            </button>

            {showProfileEditor && (
              <div className="space-y-2.5 pt-2 border-t border-slate-800 animate-fadeIn text-xs">
                <div>
                  <label className="text-[11px] text-slate-400 font-medium">Full Name</label>
                  <input
                    type="text"
                    value={profile.name}
                    onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 font-medium">Target Title</label>
                  <input
                    type="text"
                    value={profile.title}
                    onChange={(e) => setProfile({ ...profile, title: e.target.value })}
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs mt-0.5"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-slate-400 font-medium">Email</label>
                    <input
                      type="text"
                      value={profile.email}
                      onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs mt-0.5"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 font-medium">Phone</label>
                    <input
                      type="text"
                      value={profile.phone || ''}
                      onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs mt-0.5"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 font-medium">Location</label>
                  <input
                    type="text"
                    value={profile.location || ''}
                    onChange={(e) => setProfile({ ...profile, location: e.target.value })}
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs mt-0.5"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-slate-400 font-medium">GitHub</label>
                    <input
                      type="text"
                      value={profile.links?.github || ''}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          links: { ...profile.links, github: e.target.value },
                        })
                      }
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs mt-0.5"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 font-medium">LinkedIn</label>
                    <input
                      type="text"
                      value={profile.links?.linkedin || ''}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          links: { ...profile.links, linkedin: e.target.value },
                        })
                      }
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs mt-0.5"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* MIDDLE PANE: Modular Section & Bullet Builder (Col span 5) */}
        {/* ========================================================================= */}
        <div className="xl:col-span-5 space-y-5">
          {/* Header Controls for Middle Pane */}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-400" />
              Modular Experiences & Bullets
            </h2>
            <button
              onClick={handleAddExperience}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-purple-300 rounded-xl text-xs font-semibold transition-all inline-flex items-center gap-1 border border-slate-700"
            >
              <Plus className="w-3.5 h-3.5" /> Add Experience
            </button>
          </div>

          {/* Experiences List */}
          <div className="space-y-4">
            {experiences.map((exp) => (
              <div
                key={exp.id}
                className="p-4 bg-slate-900/70 border border-slate-800 rounded-2xl space-y-3 shadow-md"
              >
                {/* Experience Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <input
                      type="text"
                      value={exp.role}
                      onChange={(e) =>
                        setExperiences((prev) =>
                          prev.map((item) =>
                            item.id === exp.id ? { ...item, role: e.target.value } : item
                          )
                        )
                      }
                      placeholder="Role"
                      className="col-span-2 px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-bold text-white focus:outline-none focus:border-purple-500"
                    />
                    <input
                      type="text"
                      value={exp.company}
                      onChange={(e) =>
                        setExperiences((prev) =>
                          prev.map((item) =>
                            item.id === exp.id ? { ...item, company: e.target.value } : item
                          )
                        )
                      }
                      placeholder="Company"
                      className="col-span-2 px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-semibold text-purple-300 focus:outline-none focus:border-purple-500"
                    />
                    <input
                      type="text"
                      value={exp.startDate}
                      onChange={(e) =>
                        setExperiences((prev) =>
                          prev.map((item) =>
                            item.id === exp.id ? { ...item, startDate: e.target.value } : item
                          )
                        )
                      }
                      placeholder="Start Date"
                      className="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-lg text-[11px] text-slate-300 focus:outline-none focus:border-purple-500"
                    />
                    <input
                      type="text"
                      value={exp.endDate}
                      onChange={(e) =>
                        setExperiences((prev) =>
                          prev.map((item) =>
                            item.id === exp.id ? { ...item, endDate: e.target.value } : item
                          )
                        )
                      }
                      placeholder="End Date"
                      className="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-lg text-[11px] text-slate-300 focus:outline-none focus:border-purple-500"
                    />
                    <input
                      type="text"
                      value={exp.location || ''}
                      onChange={(e) =>
                        setExperiences((prev) =>
                          prev.map((item) =>
                            item.id === exp.id ? { ...item, location: e.target.value } : item
                          )
                        )
                      }
                      placeholder="Location"
                      className="col-span-2 px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-lg text-[11px] text-slate-300 focus:outline-none focus:border-purple-500"
                    />
                  </div>

                  <button
                    onClick={() => handleDeleteExperience(exp.id)}
                    title="Delete experience"
                    className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Bullets List */}
                <div className="space-y-2 pt-2 border-t border-slate-800/60">
                  {exp.bullets.map((bullet) => {
                    const primaryCit = bullet.citations?.[0];
                    const matchedEv = primaryCit
                      ? evidenceList.find(
                          (e) =>
                            e.id.toLowerCase() === primaryCit.toLowerCase()
                        )
                      : null;

                    return (
                      <div
                        key={bullet.id}
                        className={`p-2.5 rounded-xl border transition-all ${
                          bullet.included
                            ? 'bg-slate-950/60 border-slate-800'
                            : 'bg-slate-950/20 border-slate-800/40 opacity-50'
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          <input
                            type="checkbox"
                            checked={bullet.included}
                            onChange={() => handleToggleBullet(exp.id, bullet.id)}
                            className="mt-1 w-4 h-4 rounded text-purple-600 bg-slate-950 border-slate-700 focus:ring-purple-500 shrink-0 cursor-pointer"
                            title="Toggle bullet inclusion in compiled resume"
                          />

                          <div className="flex-1 space-y-1.5">
                            <textarea
                              rows={2}
                              value={bullet.text}
                              onChange={(e) =>
                                handleUpdateBulletText(exp.id, bullet.id, e.target.value)
                              }
                              className="w-full p-2 bg-transparent text-xs text-slate-200 focus:bg-slate-950 focus:border-purple-500 border border-transparent rounded-lg leading-relaxed focus:outline-none resize-none"
                            />

                            {/* Bullet Badges & Citations */}
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {bullet.citations &&
                                bullet.citations.map((cit) => (
                                  <span
                                    key={cit}
                                    className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-purple-950/50 text-purple-300 border border-purple-500/30"
                                  >
                                    ({cit})
                                  </span>
                                ))}

                              {matchedEv ? (
                                matchedEv.confidence === 'verified' ? (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1 font-medium">
                                    <ShieldCheck className="w-2.5 h-2.5" /> Verified
                                  </span>
                                ) : (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1 font-medium">
                                    <AlertTriangle className="w-2.5 h-2.5" /> Provisional
                                  </span>
                                )
                              ) : bullet.citations && bullet.citations.length > 0 ? (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center gap-1 font-medium">
                                  Dangling
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <button
                            onClick={() => handleDeleteBullet(exp.id, bullet.id)}
                            className="p-1 text-slate-500 hover:text-rose-400 rounded transition-colors"
                            title="Remove bullet"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {/* Bullet Action Buttons */}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => setPickerExperienceId(exp.id)}
                      className="px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 rounded-xl text-xs font-semibold transition-all inline-flex items-center gap-1.5 shadow-sm"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Bullet from Evidence
                    </button>
                    <button
                      onClick={() => handleAddCustomBullet(exp.id)}
                      className="px-2.5 py-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl text-xs transition-colors"
                    >
                      + Custom Bullet
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Education & Skills Section Foldouts */}
          <div className="space-y-3 pt-2">
            {/* Skills foldout */}
            <div className="p-4 bg-slate-900/70 border border-slate-800 rounded-2xl shadow-md">
              <button
                onClick={() => setShowSkillsEditor(!showSkillsEditor)}
                className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-200"
              >
                <span className="flex items-center gap-1.5">
                  <Wrench className="w-3.5 h-3.5 text-cyan-400" />
                  Skills Groups ({skills.length})
                </span>
                {showSkillsEditor ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </button>

              {showSkillsEditor && (
                <div className="space-y-3 pt-3 border-t border-slate-800 mt-2">
                  {skills.map((group, gIdx) => (
                    <div key={gIdx} className="space-y-1 text-xs">
                      <div className="flex items-center justify-between">
                        <input
                          type="text"
                          value={group.category}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSkills((prev) =>
                              prev.map((g, idx) =>
                                idx === gIdx ? { ...g, category: val } : g
                              )
                            );
                          }}
                          className="font-semibold text-slate-200 bg-transparent border-b border-slate-700 px-1 py-0.5"
                        />
                        <button
                          onClick={() =>
                            setSkills((prev) => prev.filter((_, idx) => idx !== gIdx))
                          }
                          className="text-slate-500 hover:text-rose-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <input
                        type="text"
                        value={group.skills.join(', ')}
                        onChange={(e) => {
                          const list = e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean);
                          setSkills((prev) =>
                            prev.map((g, idx) =>
                              idx === gIdx ? { ...g, skills: list } : g
                            )
                          );
                        }}
                        className="w-full px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-lg text-slate-300 text-xs"
                      />
                    </div>
                  ))}
                  <button
                    onClick={() =>
                      setSkills([
                        ...skills,
                        { category: 'New Category', skills: ['Skill 1', 'Skill 2'] },
                      ])
                    }
                    className="text-xs text-purple-400 hover:text-purple-300 font-medium inline-flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Add Skill Category
                  </button>
                </div>
              )}
            </div>

            {/* Education foldout */}
            <div className="p-4 bg-slate-900/70 border border-slate-800 rounded-2xl shadow-md">
              <button
                onClick={() => setShowEduEditor(!showEduEditor)}
                className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-200"
              >
                <span className="flex items-center gap-1.5">
                  <GraduationCap className="w-3.5 h-3.5 text-emerald-400" />
                  Education ({education.length})
                </span>
                {showEduEditor ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </button>

              {showEduEditor && (
                <div className="space-y-3 pt-3 border-t border-slate-800 mt-2">
                  {education.map((edu, eIdx) => (
                    <div
                      key={eIdx}
                      className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <input
                          type="text"
                          value={edu.degree}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEducation((prev) =>
                              prev.map((item, idx) =>
                                idx === eIdx ? { ...item, degree: val } : item
                              )
                            );
                          }}
                          placeholder="Degree"
                          className="w-full px-2 py-1 bg-slate-900 border border-slate-800 rounded text-slate-200 font-medium"
                        />
                        <button
                          onClick={() =>
                            setEducation((prev) => prev.filter((_, idx) => idx !== eIdx))
                          }
                          className="text-slate-500 hover:text-rose-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <input
                          type="text"
                          value={edu.institution}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEducation((prev) =>
                              prev.map((item, idx) =>
                                idx === eIdx ? { ...item, institution: val } : item
                              )
                            );
                          }}
                          placeholder="Institution"
                          className="col-span-2 px-2 py-1 bg-slate-900 border border-slate-800 rounded text-slate-300"
                        />
                        <input
                          type="text"
                          value={edu.year}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEducation((prev) =>
                              prev.map((item, idx) =>
                                idx === eIdx ? { ...item, year: val } : item
                              )
                            );
                          }}
                          placeholder="Year"
                          className="px-2 py-1 bg-slate-900 border border-slate-800 rounded text-slate-300"
                        />
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={() =>
                      setEducation([
                        ...education,
                        {
                          institution: 'University',
                          degree: 'B.S. in Computer Science',
                          year: '2020',
                        },
                      ])
                    }
                    className="text-xs text-purple-400 hover:text-purple-300 font-medium inline-flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Add Education
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* RIGHT PANE: Live Multi-Target Compiler Preview & Pre-Flight Gate (Col span 4) */}
        {/* ========================================================================= */}
        <div className="xl:col-span-4 space-y-4 flex flex-col">
          {/* Top Bar: Format Switcher & Pre-Flight Gate Action */}
          <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-2xl shadow-md flex flex-wrap items-center justify-between gap-2.5">
            {/* Target Format Switcher Tabs */}
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => setActiveFormat('markdown')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                  activeFormat === 'markdown'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                ATS Markdown
              </button>
              <button
                onClick={() => setActiveFormat('html')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                  activeFormat === 'html'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Web Print (HTML)
              </button>
              <button
                onClick={() => setActiveFormat('typst')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                  activeFormat === 'typst'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Typst
              </button>
              <button
                onClick={() => setActiveFormat('latex')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                  activeFormat === 'latex'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                LaTeX
              </button>
            </div>

            {/* Pre-Flight & De-Slop Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleDeSlop}
                disabled={deslopping}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 transition-all inline-flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                title="Run De-Slop cleaner on resume bullets"
              >
                <Sparkles className={`w-3.5 h-3.5 ${deslopping ? 'animate-spin text-purple-400' : 'text-purple-400'}`} />
                <span>De-Slop</span>
              </button>

              <button
                onClick={() => setIsPreflightModalOpen(true)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all inline-flex items-center gap-1.5 ${
                  preflightStatus?.isClean
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20'
                }`}
                title="Run Pre-Flight Check"
              >
                {preflightLoading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-400" />
                    <span>Auditing...</span>
                  </>
                ) : preflightStatus?.isClean ? (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Pre-Flight: Passed</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Pre-Flight: Needs Review</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Compiler Preview Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-lg flex-1 flex flex-col min-h-[600px]">
            {/* Preview Toolbar */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-slate-950/60">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-slate-400">
                  Target: <strong className="text-slate-200">{activeFormat.toUpperCase()}</strong>
                </span>
                {compiling && (
                  <span className="text-[10px] text-purple-400 animate-pulse font-mono">
                    Compiling...
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {activeFormat === 'html' ? (
                  <button
                    onClick={handlePrintHtml}
                    className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold transition-all inline-flex items-center gap-1.5 shadow-sm shadow-purple-900/30"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print / Save as PDF</span>
                  </button>
                ) : (
                  <>
                    <button
                      onClick={handleCopyCompiled}
                      className="px-2.5 py-1 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-medium transition-colors inline-flex items-center gap-1"
                    >
                      {copied ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                    <button
                      onClick={handleDownloadCompiled}
                      className="px-2.5 py-1 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-medium transition-colors inline-flex items-center gap-1"
                    >
                      <Download className="w-3 h-3" />
                      <span>Download</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Preview Body */}
            <div className="p-3 flex-1 flex flex-col overflow-hidden">
              {activeFormat === 'html' ? (
                <iframe
                  srcDoc={compiledOutput}
                  title="Sandboxed Resume Print Preview"
                  className="w-full flex-1 bg-white rounded-xl shadow-inner border border-slate-700 min-h-[580px]"
                />
              ) : (
                <pre className="p-4 bg-slate-950 font-mono text-xs text-slate-200 rounded-xl overflow-auto whitespace-pre-wrap flex-1 border border-slate-800/80 leading-relaxed selection:bg-purple-900/50">
                  {compiledOutput}
                </pre>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Evidence Picker Drawer/Modal */}
      <EvidencePickerModal
        isOpen={pickerExperienceId !== null}
        onClose={() => setPickerExperienceId(null)}
        onSelectEvidence={handleInsertEvidence}
        evidenceList={evidenceList}
      />

      {/* Pre-Flight Gate Modal */}
      <PreFlightModal
        isOpen={isPreflightModalOpen}
        onClose={() => setIsPreflightModalOpen(false)}
        spec={currentSpec}
        text={compiledOutput}
        onTextCleaned={handleDeSlop}
        onRedactAndDownload={(cleanText) => {
          console.log('Downloaded clean redacted resume:', cleanText.length);
        }}
      />

      {/* Save Variant Modal */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white">Save Tailored Resume Variant</h3>
            <p className="text-xs text-slate-400">
              Saves the current modular selection and active bullet configuration to your repository.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-300">Variant Name (slug)</label>
                <input
                  type="text"
                  placeholder="e.g. netflix-agent-platform"
                  value={saveVariantName}
                  onChange={(e) => setSaveVariantName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white mt-1 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-300">Destination</label>
                <select
                  value={saveVariantType}
                  onChange={(e) =>
                    setSaveVariantType(e.target.value as 'tailored' | 'template')
                  }
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white mt-1 focus:outline-none focus:border-purple-500"
                >
                  <option value="tailored">resumes/tailored/ (Job-Specific Variant)</option>
                  <option value="template">resumes/templates/ (Master Template)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={() => setIsSaveModalOpen(false)}
                className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveVariant}
                disabled={!saveVariantName.trim()}
                className="px-4 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-40 rounded-xl transition-colors shadow-md shadow-purple-900/30"
              >
                Save Variant
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
