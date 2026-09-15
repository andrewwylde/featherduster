---
name: career-growth-accomplishments
description: >
  Builds and maintains an accomplishment journal (brag doc) from evidence ledger
  entries and practitioner notes, grouped by theme, impact, and competency. Use for
  "brag doc", "accomplishment journal", "what did I achieve this quarter", or to
  prepare for performance reviews and promotion cases.
---

# Career Growth: Accomplishments Journal (Brag Doc)

Transform raw evidence ledger entries into a living, high-impact accomplishments document updated across the review cycle.

---

## Core Purpose

A brag doc serves three key needs:
1. Prevents recency bias during annual or semi-annual performance reviews.
2. Organizes engineering impact by strategic themes rather than chronology.
3. Provides cited proof points ready for self-evaluations and promotion packets.

---

## Journal Structure

```markdown
# Accomplishments Journal: [Engineer Name] — [Review Period]

## Executive Summary
- [3-5 bullets highlighting the highest-leverage outcomes of the cycle, citing ev-###]

## By Strategic Theme
### Architecture & Scalability
- **[Month Year]** [Active Verb] [System / Component] -> [Measurable Outcome]. (ev-001, ev-004)

### Operational Excellence & Reliability
- **[Month Year]** Resolved chronic [Issue] through [Action], achieving [Metric]. (ev-002)

### Team Multipliers & Mentorship
- **[Month Year]** Authored RFC for [Domain] and onboarded [N] engineers. (ev-003)

## In-Flight Initiatives
- [Initiatives underway that have not yet reached general availability or measured impact]

## Evidence Gaps & Metrics Needed
- [Items requiring verification or marked with [METRIC NEEDED]]
```

---

## Writing Guidelines

1. **Lead with Impact:** Always follow the format: `[Action Verb] + [Scope / Problem Solved] -> [Measured Outcome] (Citation)`.
2. **Eliminate Fluff:** Avoid generic praise like "worked closely with stakeholders"; state the specific artifact produced (e.g. "authored API specification adopted by 3 partner teams").
3. **Traceable Citations:** Every bullet must cite an existing evidence ID (`ev-###`).
4. **Compile via CLI:** Generate the final formatted brag document using:
   ```bash
   featherduster build --format brag --rubric <rubric-id> -o resumes/exports/brag-doc.md
   ```
