---
name: career-growth-promotion-packet
description: >
  Assembles a promotion packet with leveling worksheet sections and evidence mapped
  to next-level competencies, identifying strengths and readiness gaps without making
  a binding promotion decision. Use for "promotion packet", "leveling worksheet",
  "promotion case", "am I ready for L5", or promotion committee prep.
---

# Career Growth: Promotion Packet Drafting & Gap Identification

Compile a rigorous, objective promotion case demonstrating sustained performance at the next engineering level bar, while clearly identifying remaining readiness gaps.

---

## Packet Objectives

1. **Demonstrate Sustained Trajectory:** Prove the candidate is already operating at the target level across major competency dimensions (e.g. L4 operating at L5).
2. **Back Every Section with Evidence:** Replace generic manager/peer opinions with verifiable citations (`ev-###`).
3. **Transparent Gap Identification:** Explicitly surface areas where evidence is thin so the candidate and manager can address them before calibration.

---

## Standard Packet Structure

```markdown
# Promotion Case: [Candidate Name]
**Current Level:** L4 (Senior Software Engineer)
**Target Level:** L5 (Staff Software Engineer)
**Review Period:** [Cycle Dates]

## 1. Executive Summary & Core Rationale
[Concise synthesis of why the candidate meets the next-level bar: scope, technical ownership, and organizational leverage.]

## 2. Next-Level Competency Demonstration
### System Architecture & Cross-Team Scope
- [Evidence citations proving multi-service architectural leadership (ev-###)]

### Technical Execution & Delivery
- [Evidence citations proving delivery of complex, ambiguous initiatives (ev-###)]

### Operational Excellence & Reliability
- [Measurable improvements to platform reliability, SLAs, and incident management (ev-###)]

### Organizational Multipliers & Mentorship
- [Sponsorship of junior engineers, design review leadership, and RFC influence (ev-###)]

## 3. Evidence Ledger Appendix
| Evidence ID | Date | Title | Verified Metrics | Primary Competency |
|---|---|---|---|---|
| ev-001 | 2026-01-15 | Microservice Migration | 45% latency drop | Architecture |
| ev-002 | 2026-03-01 | Telemetry Ingestion | 50% CPU reduction | Operational Excellence |

## 4. Identified Gaps & Open Calibration Questions
- [Competency area where evidence is provisional or missing]
- [Open questions for the promotion committee regarding business scope and timing]
```

---

## Workflow

1. **Set Level Delta:** Define current level and target level (e.g., L4 -> L5).
2. **Fetch Next-Level Expectations:** Load the target level requirements from `rubrics/engineering-ic.yaml`.
3. **Extract Backed Evidence:** Filter `evidence/**/*.md` for entries showing next-level scope.
4. **Identify Gaps:** Highlight competencies where no verified evidence exists.
5. **Run Integrity Audit:** Execute `featherduster check` to ensure zero broken citations or unbacked claims.
6. **Human Calibration:** Submit the draft packet to the engineering manager and promotion committee for human evaluation.
