---
name: career-growth-tailor-resume
description: >
  Tailor an existing resume and evidence ledger for a specific job posting without fabricating claims
  or keyword stuffing. Use for "tailor my resume for this job", "adapt my resume for this posting",
  "job match analysis", "align my resume to this JD", or when provided a job posting URL or text
  alongside a resume or evidence ledger. Extracts requirements, maps them strictly to verified ledger
  entries, elevates relevant accomplishments, harmonizes terminology, and produces both the tailored
  resume and an Interview Defensibility Brief for gaps.
---

# Career Growth: Tailor Resume to Job Posting

Tailor an existing resume and career evidence ledger to match a specific job description with surgical precision, while strictly preserving truthfulness and interview defensibility.

Shared principles: [core-principles.md](../references/core-principles.md). Parsing rubric: [jd-extraction-rubric.md](references/jd-extraction-rubric.md).

---

## Core Invariants

1. **The Ledger Ceiling Rule:** A technology, language, or system cannot appear on the resume (neither in bullets nor in the Technical Skills block) unless verified by `evidence/**/*.md` or confirmed by the candidate. Tailoring selects and highlights from the ledger; it never appends fictional capabilities.
2. **Transferable vs. Fabricated:** If a job description asks for tool A (e.g. Kafka) and the candidate only has production experience with equivalent tool B (e.g. RabbitMQ/SQS), keep tool B on the resume. Highlight the common architectural pattern (asynchronous event ingestion, backpressure) and address tool A in the Interview Defensibility Brief.
3. **Positioning Stability:** Retain the candidate's true career center of gravity. A senior frontend engineer who grew into fullstack/platform remains positioned as a frontend authority with platform depth, rather than masquerading as a lifelong distributed systems architect.
4. **Length and Layout Invariance:** Single-page resumes MUST stay on a single page. Tailoring never increases total vertical height; for every line added or expanded, an equivalent lower-signal line must be consolidated or pruned.

---

## The 4 Gates

### Gate 0: Ingest & Deconstruct Job Posting
Parse the job posting into structured criteria using [references/jd-extraction-rubric.md](references/jd-extraction-rubric.md):
- **Target Role & Seniority:** Exact title, leveling (Senior, Staff, Principal), and core mission.
- **Tier 1 Must-Haves:** Essential languages, frameworks, core system scale, and architectural paradigms.
- **Tier 2 Nice-to-Haves:** Secondary tools, domain knowledge, and bonus qualifications.
- **Company Vocabulary:** Distinct technical terminology used by the company.

### Gate 1: Requirement Alignment & Gap Matrix
Cross-reference every requirement against the evidence ledger:
- **Direct Backed:** Candidate has explicit ledger entries proving production ownership.
- **Transferable:** Candidate has production experience with an equivalent pattern or adjacent tool.
- **True Gap:** Requirement is completely absent from candidate history.
Present the alignment matrix and confirm direction with the candidate before modifying text.

### Gate 2: Strategic Re-weighting & Terminology Harmonization
Apply tactical adjustments without distorting history:
1. **Summary Reframing:** Tune 1-2 sentences in the summary to address the target team's charter while preserving core identity.
2. **Bullet Re-ordering:** Move the 1-2 bullets that directly prove the job's highest priorities into the top positions for each role.
3. **Terminology Harmonization:** Adopt the company's specific vocabulary ONLY when backed by actual work (e.g., "design system" vs "shared component library").
4. **Skills Tuning:** Prioritize the target tech stack at the front of categories; prune legacy keywords. NEVER inject unverified skills.

### Gate 3: Emit Tailored Resume
Generate the tailored output (Markdown, LaTeX, or Typst):
- Strip all internal citation IDs (`ev-###`) using `featherduster build` or the redaction engine.
- Verify zero hallucinated metrics (`[METRIC NEEDED]` used if metric is unverified).
- Ensure strict page budget discipline.

### Gate 4: Generate Interview Defensibility Brief
Emit a companion defensibility brief (`resumes/tailored/briefs/[company]_[role]_brief.md`):
1. **Primary Anchor Stories:** Top 3 projects answering the hiring manager's biggest challenges (Problem, Ownership, Metric/Proof).
2. **Bridging Transferable Skills:** Honest framing for adjacent tooling (e.g., RabbitMQ to Kafka).
3. **Addressing True Gaps:** Honest acknowledgement, parallel mastery, and track record of rapid stack adoption.
