---
name: career-growth-self-review
description: >
  Drafts structured, first-person self-review assessments backed strictly by cited evidence
  ledger entries and competency rubrics. Use for "write my self-review", "self-assessment",
  "EOY self-review", "mid-year reflection", or performance review preparation.
---

# Career Growth: Evidence-Backed Self-Review Drafting

Draft comprehensive, objective self-assessments anchored strictly in verified career evidence, eliminating guesswork and unsubstantiated claims.

---

## Non-Negotiable Self-Review Directives

1. **Every Claim Cites an Evidence ID:**
   No accomplishment, technical achievement, or cross-team contribution may be stated without citing a supporting entry (`ev-###`).
2. **Zero Hallucinated Metrics:**
   If a concrete business or performance metric is missing, use `[METRIC NEEDED]`. Never invent numbers.
3. **Synthesis Over Quote Dumping:**
   Synthesize PRs and project logs into a narrative reflecting ownership, trade-off analysis, and delivered outcomes.
4. **Constructive Growth Areas:**
   Reflect on authentic technical and workflow challenges without defensive posturing or false modesty.

---

## Self-Review Structure

```markdown
# Annual Self-Review: [Engineer Name] — [Period]

## 1. Key Accomplishments & Technical Delivery
- [Synthesized overview of top 3 initiatives shipped during the cycle, citing ev-###]

## 2. Competency Alignment (Against Current Level)
### Technical Execution & Architecture
- [Narrative detailing system decisions, scale handled, and reliability outcomes (ev-###)]

### Operational Rigor & Ownership
- [Incidents resolved, observability improvements, and deployment hardening (ev-###)]

### Team Multipliers & Mentorship
- [RFCs authored, code review contributions, and mentoring junior teammates (ev-###)]

## 3. Progress Against Prior Goals
- [Goal 1]: [Significant Progress / Met] — [Outcome and cited evidence]
- [Goal 2]: [In-Flight / Continued Focus] — [Status narrative]

## 4. Growth Opportunities & Next Cycle Objectives
- [Concrete development areas identified via rubric gap analysis]
```

---

## Workflow Steps

1. **Assemble Inputs:** Gather active `rubrics/engineering-ic.yaml`, evidence entries for the period, and prior cycle goals.
2. **Draft by Section:** Generate first-person narrative matching company review questions.
3. **Audit via CLI:** Run `featherduster check` to verify citation validity and ban slop or privacy leaks.
4. **De-Slop Pass:** Apply the `de-slop` skill to strip empty hedging and ensure concise, impactful phrasing.
5. **Human Review:** The engineer inspects, edits, and finalizes all statements before submission.
