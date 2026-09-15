# Job Description Extraction & Alignment Rubric

Use this rubric to parse unstructured job descriptions into structured evaluation criteria and map them against the Featherduster evidence ledger.

---

## 1. Deconstruction Taxonomy

When parsing a job posting, categorize requirements into four distinct tiers:

### Tier 1: Core Technical Competencies (Must-Haves)
Essential technical skills required to function in the role:
- **Core Languages & Frameworks:** Primary programming languages (e.g. TypeScript, Go, Python, Rust) and frameworks (React, Node.js).
- **Architecture & Paradigms:** Distributed systems, Event-driven architecture, Design systems, Domain-driven design.
- **Data & Storage:** Databases, caches, queues, streaming (PostgreSQL, Redis, Kafka, GraphQL).
- **Infrastructure & Scale:** Cloud providers (AWS, GCP), containerization (Docker, Kubernetes), concurrency and SLA targets.

### Tier 2: Specialized Competencies (Nice-to-Haves)
Secondary or domain-specific preferences:
- Secondary tools or alternate tech stacks ("Kubernetes experience is a plus").
- Domain knowledge (Fintech compliance, Developer Experience/DX, security protocols).
- Specialized workflows (performance profiling, AST/compiler tooling, CI/CD automation).

### Tier 3: Company Vocabulary & Nomenclature
Distinct terms preferred by the employer:
- "Design system" vs. "Component library"
- "Observability" vs. "Monitoring & Alerting"
- "Monorepo tooling" vs. "Build scripts"

### Tier 4: HR Boilerplate (Ignored for Tailoring)
Generic filler phrases that do not reflect technical differentiation:
- "Fast-paced environment", "passionate team player", "wear multiple hats".
- Do not tailor bullets to match these phrases.

---

## 2. Terminology Harmonization Matrix

Harmonize candidate accomplishments to company vocabulary ONLY when functionally equivalent:

| Job Posting Term | Common Ledger Equivalents | Safe to Harmonize? | Condition / Grounding Check |
|---|---|---|---|
| **Design System** | Shared UI library, component kit, UI design tokens | Yes | Must have authored/maintained multi-consumer UI packages. |
| **Event-Driven Architecture** | Message queues, asynchronous worker pipelines, pub/sub | Yes | Backed by SQS, RabbitMQ, Kafka, or event bus implementations in ledger. |
| **Developer Experience (DX)** | CLI tooling, internal dev workflows, build optimization | Yes | Evidence of authoring tooling adopted by other engineers. |
| **Observability** | Distributed tracing, Prometheus metrics, telemetry pipelines | Yes | Evidence of instrumenting OpenTelemetry, Datadog, or logging systems. |

**Unsafe Harmonization (Strictly Forbidden):**
- JD requires **Kafka**; Candidate used **RabbitMQ**. *Do not replace RabbitMQ with Kafka on the resume.* Keep RabbitMQ, and bridge in the interview defensibility brief.
- JD requires **Kubernetes**; Candidate used **Docker Compose**. *Do not claim Kubernetes.*

---

## 3. Gap Categorization

| Category | Definition | Action on Resume | Action in Defensibility Brief |
|---|---|---|---|
| **Direct Backed** | Exact tool/pattern verified in evidence ledger. | Elevate to top bullet slots. Harmonize terminology if truthful. | Select as primary anchor stories. |
| **Transferable** | Equivalent conceptual work done with adjacent tools. | Keep truthful tool name; highlight architectural pattern. | Draft concrete bridge narrative for interview. |
| **True Gap** | Technology or domain completely absent from ledger. | **DO NOT ADD.** Never inject into Skills or bullets. | Formulate honest learning strategy and cite parallel mastery. |
