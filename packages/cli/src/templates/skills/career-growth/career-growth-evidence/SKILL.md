---
name: career-growth-evidence
description: >
  Collects, normalizes, and summarizes work signals from GitHub, Linear, Slack,
  and local practitioner notes into the Featherduster evidence ledger. Use for
  "gather my accomplishments", "what did I ship this cycle", "evidence for self-review",
  or when converting raw ticket and commit logs into structured evidence entries.
---

# Career Growth: Evidence Collection & Ledger Normalization

Collect objective work signals across development tools and synthesize them into verified, structured evidence entries conforming to the Featherduster `EvidenceEntrySchema`.

---

## Signal Ingestion Sources

1. **GitHub Activity:**
   - Merged pull requests, code reviews delivered, and closed issues using `gh` CLI or git logs.
   - Extract: PR titles, branch scope, architectural decisions, and merged timestamps.

2. **Linear / Issue Trackers:**
   - Completed features, epics, bug remediations, and project charters.
   - Extract: ticket IDs (`ref`), ownership role, project context, and status transitions.

3. **Slack / Communication Channels:**
   - Incident debriefs, technical RFC discussions, cross-team unblocking, and mentorship threads.
   - Extract: high-signal impact summaries; do NOT import raw conversational quotes.

4. **Local Engineering Notes:**
   - Design documents, sprint retrospectives, and personal logs.

---

## Normalization Workflow

### 1. Ingest & Deduplicate
Group related PRs, tickets, and incident responses into a single coherent initiative (e.g., combining 4 PRs for an auth migration into a single evidence record).

### 2. Formulate Frontmatter
Assign the next available `ev-###` identifier and construct the frontmatter:
```yaml
---
id: ev-002
date: '2026-03-01'
company: sample-company
title: Real-Time Telemetry Pipeline Optimization
summary: Re-architected log ingestion workers using stream batching and backpressure.
impact: Reduced event loss to 0% and halved CPU consumption across ingestion clusters.
themes:
  - backend
  - performance
  - observability
confidence: verified
in_flight: false
metrics:
  - name: event loss
    value: 0%
    status: verified
  - name: CPU utilization reduction
    value: 50%
    status: verified
internal_references:
  - type: pr
    ref: '#412'
  - type: ticket
    ref: PERF-109
---
```

### 3. Draft Technical Narrative
Write structured markdown detailing:
- **Context & Problem:** What broke, what was inefficient, or what capability was needed.
- **Technical Actions Taken:** Specific architectures, patterns, and code contributions made.
- **Measured Outcomes:** Concrete quantitative figures verified against telemetry. If a metric is unknown, mark as `[METRIC NEEDED]`.

### 4. Integrity Verification
Run `featherduster check` to ensure citations, schema compliance, and metric verification pass.
