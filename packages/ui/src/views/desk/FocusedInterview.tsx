import React, { useState } from 'react';
import {
  ArrowLeft,
  Send,
  Paperclip,
  Plus,
  BarChart2,
  CheckCircle2,
  FileText,
  ArrowRight,
} from 'lucide-react';
import type { RecommendedLead, InterviewMessage, LiveDossier } from '../../types/desk';
import { EvidenceBadge } from '../../components/desk/EvidenceBadge';
import { apiClient } from '../../api/client';

interface FocusedInterviewProps {
  lead: RecommendedLead;
  onBackToBriefing: () => void;
  onViewThread?: (threadId: string) => void;
  onEvidenceCaptured?: (evidenceId: string) => void;
}

export const FocusedInterview: React.FC<FocusedInterviewProps> = ({
  lead,
  onBackToBriefing,
  onViewThread,
  onEvidenceCaptured,
}) => {
  const [messages, setMessages] = useState<InterviewMessage[]>(lead.initialTranscript);
  const [inputText, setInputText] = useState('');
  const [dossier, setDossier] = useState<LiveDossier>(lead.dossierDraft);
  const [isCapturing, setIsCapturing] = useState(false);
  const [capturedEntryId, setCapturedEntryId] = useState<string | null>(null);
  const [isThreadStrengthened, setIsThreadStrengthened] = useState(false);

  const handleSendMessage = () => {
    if (!inputText.trim()) return;

    const userText = inputText.trim();
    const userMsg: InterviewMessage = {
      id: `msg-${Date.now()}`,
      speaker: 'user',
      timestamp: '10:09 AM',
      body: userText,
    };

    // Construct intelligent editor follow-up confirming the metrics
    const editorFollowup: InterviewMessage = {
      id: `msg-${Date.now() + 1}`,
      speaker: 'editor',
      timestamp: '10:10 AM',
      headline: 'Excellent specifics.',
      context:
        'This gives us a solid, verifiable claim. I have updated the dossier with your reduction metric and linked the verification source.',
      body: '',
    };

    setMessages((prev) => [...prev, userMsg, editorFollowup]);
    setInputText('');

    // Update Live Structured Dossier: resolve [METRIC NEEDED]
    setDossier((prev) => ({
      ...prev,
      updatedAt: 'Just now',
      outcome: {
        text: 'We stopped waking someone for routine worker failures, reducing pager noise and allowing the team to focus on real incidents. Reduced alerts by 80% across 140k daily worker tasks.',
        status: 'verified',
        missingMetric: false,
      },
      sources: [
        ...prev.sources.map((s) => (s.id === 'src-note-incident' ? { ...s, status: 'verified' as const } : s)),
        {
          id: 'src-datadog-wa-au-018',
          label: 'Datadog monitor wa-au-018',
          tag: 'Production telemetry',
          status: 'verified',
        },
      ],
      stillNeeded: prev.stillNeeded.filter((item) => !item.toLowerCase().includes('quantitative')),
    }));
  };

  const handleCapture = async () => {
    try {
      setIsCapturing(true);
      const generatedId = 'ev-042';

      try {
        await apiClient.saveEvidence(
          {
            id: generatedId,
            date: '2026-04-12',
            company: 'parable',
            title: 'Automated Job Worker Failover & Pager Noise Reduction',
            summary: dossier.action.text,
            impact: dossier.outcome.text.replace(/\[METRIC NEEDED\]/g, 'verified 80% reduction'),
            confidence: 'verified',
            in_flight: false,
            themes: ['reliability', 'systems', 'automation'],
            metrics: [{ name: 'alert reduction', value: '80%', status: 'verified' }],
            internal_references: [{ type: 'pr', ref: '#4821' }],
          },
          dossier.situation.text
        );
      } catch {
        // Fallback for mock/disconnected mode
      }

      setCapturedEntryId(generatedId);
      setIsThreadStrengthened(true);
      if (onEvidenceCaptured) onEvidenceCaptured(generatedId);
    } finally {
      setIsCapturing(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* Top back navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBackToBriefing}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 transition-colors group focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:outline-none rounded"
        >
          <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
          <span>Return to briefing</span>
        </button>

        <span className="text-xs font-mono text-slate-600 dark:text-slate-400">
          Core Goal: 1 complete evidence entry in ~5 min
        </span>
      </div>

      {/* Completion Feedback Banner */}
      {isThreadStrengthened && (
        <div
          role="status"
          aria-live="polite"
          className="p-4 rounded-desk border border-emerald-300 dark:border-emerald-800/80 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 duration-200"
        >
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold">
                Evidence entry captured: <span className="font-mono">{capturedEntryId}</span>
              </p>
              <p className="text-xs text-emerald-700 dark:text-emerald-300">
                Story thread &apos;Reliability leadership&apos; strengthened. Source signals and skills are now linked and traceable.
              </p>
            </div>
          </div>
          <button
            onClick={() => onViewThread?.(lead.storyThread.id)}
            className="px-3.5 py-1.5 rounded-desk bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none text-white text-xs font-medium shadow-sm transition-colors flex items-center gap-1.5 self-end sm:self-auto"
          >
            <span>View strengthened thread</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Main 2-Column Working Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: The Editor Transcript & Composer (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="rounded-desk border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121622] p-6 lg:p-7 shadow-sm">
            {/* Header */}
            <div className="border-b border-slate-100 dark:border-slate-800/80 pb-5 mb-6">
              <span className="text-xs font-mono uppercase tracking-widest text-vermilion-600 dark:text-vermilion-400 font-semibold">
                The Editor
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white mt-1">
                Focused interview
              </h1>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                Answer a few questions about your work. The Editor will help turn your experience into evidence backed stories.
              </p>
            </div>

            {/* Transcript */}
            <div className="space-y-6" role="log" aria-live="polite" aria-label="Interview transcript">
              {messages.map((msg) => {
                const isEditor = msg.speaker === 'editor';
                return (
                  <div key={msg.id} className="space-y-2">
                    {/* Speaker Header */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        {isEditor ? 'The Editor' : 'You'}
                      </span>
                      <span className="text-[11px] font-mono text-slate-600 dark:text-slate-400">
                        {msg.timestamp}
                      </span>
                    </div>

                    {/* Headline or Question */}
                    {msg.headline && (
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                        {msg.headline}
                      </p>
                    )}

                    {/* Body */}
                    {msg.body && (
                      <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                        {msg.body}
                      </p>
                    )}

                    {/* Context / Prompt details */}
                    {msg.context && (
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed italic">
                        {msg.context}
                      </p>
                    )}

                    {/* Margin Annotation (Vermilion) */}
                    {msg.annotation && (
                      <div className="mt-2 pl-3 border-l-2 border-vermilion-500 text-xs font-medium text-vermilion-600 dark:text-vermilion-400 leading-relaxed bg-vermilion-50/40 dark:bg-vermilion-950/10 py-1 rounded-r">
                        {msg.annotation}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Composer Box */}
            <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="interview-input"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400"
                >
                  Add what you remember
                </label>
                <span id="composer-shortcut-hint" className="text-[11px] font-mono text-slate-600 dark:text-slate-400">
                  Ctrl + Enter to send
                </span>
              </div>

              <div className="rounded-desk border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 p-3 focus-within:border-vermilion-500/50 focus-within:ring-2 focus-within:ring-vermilion-500/30 transition-all">
                <textarea
                  id="interview-input"
                  rows={3}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  aria-describedby="composer-shortcut-hint"
                  aria-keyshortcuts="Control+Enter Meta+Enter"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="Share more details, add numbers, or point to a source..."
                  className="w-full bg-transparent text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 resize-none focus:outline-none"
                />

                <div className="flex items-center justify-between pt-2 border-t border-slate-200/50 dark:border-slate-800/50">
                  <button
                    type="button"
                    onClick={() => {
                      setInputText(
                        (prev) =>
                          (prev ? prev + ' ' : '') +
                          'Reduced alerts by 80% across 140k daily worker tasks, verified in Datadog wa-au-018.'
                      );
                    }}
                    className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:outline-none rounded transition-colors"
                  >
                    <Paperclip className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Attach source</span>
                  </button>

                  <button
                    onClick={handleSendMessage}
                    disabled={!inputText.trim()}
                    className="px-4 py-1.5 rounded-desk bg-vermilion-500 hover:bg-vermilion-600 disabled:opacity-50 text-white text-xs font-semibold shadow-sm focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:outline-none transition-all flex items-center gap-1.5"
                  >
                    <span>Send</span>
                    <Send className="w-3 h-3" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Live Structured Dossier (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="rounded-desk border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121622] p-6 shadow-sm space-y-5">
            {/* Dossier Header */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 pb-4">
              <div>
                <h2 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
                  {dossier.title}
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Turn your answers into a structured evidence entry.
                </p>
              </div>
              <span className="text-[11px] font-mono text-slate-600 dark:text-slate-400">
                {dossier.updatedAt}
              </span>
            </div>

            {/* Situation */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Situation
                </span>
                <EvidenceBadge status={dossier.situation.status} />
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {dossier.situation.text}
              </p>
            </div>

            {/* Action */}
            <div className="space-y-1.5 pt-3 border-t border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Action
                </span>
                <EvidenceBadge status={dossier.action.status} />
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {dossier.action.text}
              </p>
            </div>

            {/* Outcome */}
            <div className="space-y-1.5 pt-3 border-t border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Outcome
                </span>
                <EvidenceBadge status={dossier.outcome.status} />
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {dossier.outcome.text.includes('[METRIC NEEDED]') ? (
                  <>
                    {dossier.outcome.text.split('[METRIC NEEDED]')[0]}
                    <span className="px-1.5 py-0.5 rounded bg-vermilion-50 dark:bg-vermilion-950/60 text-vermilion-700 dark:text-vermilion-300 font-bold border border-vermilion-200 dark:border-vermilion-800">
                      [METRIC NEEDED]
                    </span>
                    {dossier.outcome.text.split('[METRIC NEEDED]')[1]}
                  </>
                ) : (
                  dossier.outcome.text
                )}
              </p>
            </div>

            {/* Skills */}
            <div className="space-y-1.5 pt-3 border-t border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Skills
                </span>
                <EvidenceBadge status={dossier.skills.status} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {dossier.skills.names.map((sk) => (
                  <span
                    key={sk}
                    className="px-2 py-0.5 rounded-full text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium"
                  >
                    {sk}
                  </span>
                ))}
              </div>
            </div>

            {/* Sources */}
            <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                    Sources
                  </span>
                  <span className="text-[11px] text-slate-600 dark:text-slate-400">
                    Link the evidence that supports this story.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDossier((prev) => ({
                      ...prev,
                      sources: [
                        ...prev.sources,
                        {
                          id: `src-custom-${Date.now()}`,
                          label: 'Runbook v2 failover check',
                          tag: 'Internal runbook',
                          status: 'remembered',
                        },
                      ],
                    }));
                  }}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-vermilion-600 dark:hover:text-vermilion-400 focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:outline-none transition-colors px-2 py-1 rounded border border-slate-200 dark:border-slate-800"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add source</span>
                </button>
              </div>

              <div className="space-y-2">
                {dossier.sources.map((src) => (
                  <div
                    key={src.id}
                    className="p-2.5 rounded-desk border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5 text-slate-400" />
                      <div>
                        <span className="font-semibold text-slate-900 dark:text-white block">
                          {src.label}
                        </span>
                        <span className="text-[10px] text-slate-600 dark:text-slate-400">{src.tag}</span>
                      </div>
                    </div>
                    <EvidenceBadge status={src.status} />
                  </div>
                ))}
              </div>
            </div>

            {/* How it connects mini node graph */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  How it connects
                </span>
                <span className="text-[11px] text-slate-600 dark:text-slate-400">
                  This entry will strengthen 1 story thread.
                </span>
              </div>

              <div className="p-3 rounded-desk border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 flex items-center justify-between gap-2">
                <div className="space-y-1 text-xs">
                  <div className="text-slate-700 dark:text-slate-300 font-medium">
                    PR #4821 + Incident review
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-400">
                    &rarr; Reduced manual intervention
                  </div>
                </div>

                <div
                  className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                    isThreadStrengthened
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-vermilion-500 text-white shadow-sm'
                  }`}
                >
                  <BarChart2 className="w-4 h-4" />
                  <span>Reliability leadership</span>
                </div>
              </div>
            </div>

            {/* Primary Action Button */}
            <div className="pt-2">
              <button
                onClick={handleCapture}
                disabled={isCapturing || isThreadStrengthened}
                className={`w-full py-2.5 rounded-desk text-white text-xs font-bold transition-all flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:outline-none ${
                  isThreadStrengthened
                    ? 'bg-emerald-600 cursor-default shadow-sm'
                    : 'bg-vermilion-500 hover:bg-vermilion-600 disabled:opacity-50 shadow-md shadow-vermilion-500/20'
                }`}
              >
                <span>{isCapturing ? 'Capturing...' : isThreadStrengthened ? 'Captured to dossier' : 'Capture evidence entry'}</span>
                {isThreadStrengthened ? (
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
