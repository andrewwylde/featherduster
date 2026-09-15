---
name: career-growth-competency
description: >
  Maps verified evidence ledger entries and feedback to engineering leveling ladders (L3–L6),
  producing gap analysis and competency-tagged proof points. Use for "competency mapping",
  "level readiness", "gap analysis", "am I performing at L5", or promotion prep.
---

# Career Growth: Competency & Leveling Ladder Mapping (L3–L6)

Systematically evaluate verified career evidence against structured engineering leveling ladders (L3 through L6) to identify demonstrated competencies and concrete development gaps.

---

## Leveling Ladder Spectrum (L3–L6)

| Level | Title Archetype | Core Scope & Expectation |
|---|---|---|
| **L3** | Software Engineer | **Task & Feature Scope:** Completes defined tasks with high code quality, adheres to best practices, contributes to unit tests, and requires mentorship on complex designs. |
| **L4** | Senior Software Engineer | **Module & Project Scope:** Autonomously owns medium-to-large features from design to deploy; collaborates cross-functionally; mentors junior engineers; handles on-call incidents. |
| **L5** | Staff Software Engineer / Tech Lead | **Multi-Service & Team Scope:** Architects distributed systems; resolves ambiguous cross-team bottlenecks; writes strategic RFCs; elevates team operational rigor and sponsors L4 engineers. |
| **L6** | Principal Software Engineer | **Organization & Strategic Scope:** Defines multi-year technical roadmap; standardizes platform paradigms across engineering organizations; influences industry or enterprise standards. |

---

## Mapping Workflow

### 1. Ingest Active Rubric
Load the workspace rubric (e.g., `rubrics/engineering-ic.yaml`). Ensure competency dimensions are defined:
- Technical Execution & Problem Solving
- System Architecture & Scalability
- Operational Excellence & Reliability
- Collaboration, Mentorship & Multipliers

### 2. Map Verified Evidence Entries
For each competency, scan `evidence/**/*.md` and associate matching evidence IDs (`ev-###`). Tag relevance:
- `primary`: Core proof point demonstrating the expected level behavior.
- `supporting`: Corroborating evidence or adjacent contribution.

### 3. Identify Gaps & Readiness
Compare observed behaviors against target level criteria:
- **Demonstrated:** Multiple verified evidence entries demonstrating sustained impact at or above the level bar.
- **Developing:** One or two preliminary evidence entries, or in-flight initiatives.
- **Evidence Gap:** No verified records in the review period. Mark as an explicit area for targeted development.

### 4. Human Ownership
AI evaluates evidence coverage and flags gaps; it never renders a binding promotion decision or assigns performance scores.
