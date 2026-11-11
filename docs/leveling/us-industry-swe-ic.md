# 🧭 U.S. Industry Software Engineering (IC) Leveling Framework

Engineering level definitions vary by company, but the rubric below is a reasonable U.S. industry approximation for software engineering (IC) levels. Treat it as a behavioral model — what people consistently do — rather than a strict title-to-title mapping.

As you move up, expectations grow along three axes:

| Axis | What grows |
| :--- | :--- |
| **Scope** | Size and complexity of problems you own end-to-end |
| **Autonomy** | Self-directed execution vs. needing direction |
| **Strategic impact** | Influence on product/business outcomes and technical direction |

> 📌 **Key idea**: Progression generally requires more time at each subsequent level, and outcomes vary widely — team needs, company growth stage, available opportunity, and role design all matter as much as raw skill.

---

### 📚 Canonical References

These are the sources worth reading before you self-assess or prep — they are public, primary, and widely cited.

| Source | What it is | Why it's worth reading |
| :--- | :--- | :--- |
| [progression.fyi](https://progression.fyi) | A curated directory of real, public engineering career ladders (Dropbox, Monzo, GitLab, CircleCI, and dozens more) | The fastest way to compare how different companies word the same expectations — invaluable for calibrating where you actually sit |
| [Dropbox Engineering Career Framework](https://dropbox.github.io/dbx-career-framework/) | Dropbox's full, published IC + management ladder | One of the most detailed open ladders, with explicit per-level expectations across scope, craft, and impact |
| [GitLab Engineering Levels](https://handbook.gitlab.com/handbook/engineering/careers/) | GitLab's open job-family handbook | Transparent, version-controlled definitions you can map directly to behaviors and responsibilities |
| [\"Staff Engineer\" by Will Larson](https://staffeng.com) | Free guides distilled from interviews with staff-plus engineers | The clearest public articulation of what changes at Staff/Principal — archetypes (Tech Lead, Architect, Solver, Right Hand) and how to operate at that scope |
| [Google's re:Work guidance](https://rework.withgoogle.com/) | Google's published people-practices research | Useful framing on how leveling, calibration, and impact assessment work at scale |

> 💡 **Refresher**: If you only open one link, make it [progression.fyi](https://progression.fyi) — skim three or four ladders side by side and you'll quickly see which behaviors are universal and which are company-specific.

---

## 🧱 How to Use This Page

Use this as a lightweight calibration tool to:

- **Identify your current operating level** — what you consistently do, not your title.
- **Understand what's expected at the next level**.
- **Translate your experience into interview narratives** (ownership, tradeoffs, impact).

---

## 📊 Levels at a Glance

| Level | Core responsibility | Autonomy | Time-to-next (rough) |
| :--- | :--- | :--- | :--- |
| **Junior** | Ships well-defined tasks; learns the codebase and process | Works with guidance | ~1–3 yrs → Mid |
| **Mid-level** | Delivers features independently; owns small–medium problems | Largely self-directed on scoped work | ~2–5 yrs → Senior |
| **Senior** | Leads complex features/systems; makes architectural tradeoffs | Self-directed across multiple people/stakeholders | ~3+ yrs → Staff |
| **Staff** | Solves ambiguous, high-impact problems; sets direction for an area | Drives cross-team initiatives | Highly variable |
| **Principal** | Defines long-term technical vision; shapes the org | Sets company-wide technical strategy | Highly variable |

> ⚠️ **Gotcha — read the time ranges loosely**: These durations are illustrative, not targets. Senior is a terminal level at many companies (you can stay there indefinitely), and Staff/Principal are gated by available scope, not tenure — they often require a problem big enough to justify the level, which may or may not exist on your team. Promotion velocity is driven as much by company growth and opportunity as by individual readiness. Don't read a missed range as a verdict on your skill.

---

## 🎯 Level → Interview Signals

Interviewers are calibrating you against the level you're targeting. This maps each level to the signals they look for, a story you should be ready to tell, and the failure modes that quietly downlevel candidates.

| Level | Signals interviewers want | Example story to prepare | Common failure modes |
| :--- | :--- | :--- | :--- |
| **Junior** | Solid fundamentals, coachability, clean code, asks good questions | A bug you debugged methodically, or a feature you shipped and learned from | Over-explaining basics; not knowing why you made a choice |
| **Mid-level** | Independent delivery, sound tradeoffs on scoped work, reliability awareness | A feature you owned end-to-end, including testing and rollout | Describing tasks instead of decisions; no ownership of outcomes |
| **Senior** | System-design depth, architectural tradeoffs, raising team quality, mentoring | A complex system you led, with the tradeoffs you weighed and why | Going broad but shallow; can't quantify impact or justify alternatives |
| **Staff** | Cross-team influence, ambiguity navigation, leverage, technical strategy | An ambiguous, org-spanning problem you scoped and drove to resolution | Staying in the IC weeds; no evidence of multiplying others' work |
| **Principal** | Org-shaping vision, durable standards, company-wide judgment | A platform/standard you defined that changed how many teams work | Vision with no execution; influence claims without measurable adoption |

> 💡 **Tip**: Demonstrate level via **scope + ownership + impact + judgment** (tradeoffs, risk management, influence) — not by listing tasks. The most common reason a strong engineer gets downleveled is telling a Senior-scope story for a Staff target.

---

## 🔎 Level Details

### Junior

- **Responsibilities**: Completes well-defined tasks with guidance while building familiarity with the codebase, tooling, and team processes. Shows increasing independence as they grow toward mid-level.
- **Growth focus**: Fundamentals — debugging, testing, code-review hygiene, and working effectively on a team.

<details>
<summary><strong>Example project</strong></summary>

Implement a small feature (e.g., add a UI button that triggers an API call). Work includes basic frontend changes, a straightforward backend handler, and standard error handling.

</details>

---

### Mid-level

- **Responsibilities**: Delivers features independently, participates in design discussions, reviews code, and improves existing components. Owns small-to-medium scoped problems end-to-end.
- **Growth focus**: Maintainability, reliability basics, sharper estimation and scoping, cross-team collaboration, and mentoring juniors.

<details>
<summary><strong>Example project</strong></summary>

Build an authentication flow (login / registration / password reset). Integrate a library or service, handle security considerations, instrument key metrics, and address performance issues.

</details>

---

### Senior

- **Responsibilities**: Leads development of complex features and systems, makes architectural tradeoffs, raises engineering quality, mentors others, and drives delivery across multiple engineers and stakeholders.
- **Growth focus**: System design depth, technical leadership, operational excellence, and influencing technical direction beyond a single team.

<details>
<summary><strong>Example project</strong></summary>

Lead a refactor from a monolith to multiple services. Define boundaries and APIs, plan migrations, preserve contracts, reduce risk, and coordinate rollout across teams.

</details>

---

### Staff

- **Responsibilities**: Solves high-impact, ambiguous problems, leads cross-team technical initiatives, and sets direction for significant areas of the product or platform. Coaches senior engineers and partners closely with product/leadership.
- **Growth focus**: Designing at scale, cross-org alignment, technical vision, and building leverage via platforms, standards, and enablement.

> 📌 **Worth reading**: Will Larson's Staff archetypes (**Tech Lead**, **Architect**, **Solver**, **Right Hand**) are the clearest public model for how the Staff role actually varies — useful for naming the kind of Staff engineer you are or want to become.

<details>
<summary><strong>Example project</strong></summary>

Drive a data-store migration to address scalability bottlenecks (e.g., PostgreSQL → a distributed NoSQL system). Coordinate engineering/product/DevOps, manage data correctness, and execute a phased rollout with rollback plans.

</details>

---

### Principal

- **Responsibilities**: Defines long-term technical vision and guides large-scale system evolution. Sets standards that shape the engineering org and influences company-wide strategy through technical leadership and decision-making.
- **Growth focus**: Organization-level leadership, innovation, setting technical strategy, and creating durable systems and practices at scale.

<details>
<summary><strong>Example project</strong></summary>

Define and drive adoption of a company-wide framework or platform (e.g., standardizing service templates, observability, or a cloud migration) impacting hundreds of engineers and multiple product lines.

</details>

---

## 📝 Notes and Caveats

- **Titles and level mappings** (e.g., L3–L7, E2–E6) differ across companies — treat this as a behavioral baseline, not an absolute. Cross-reference [progression.fyi](https://progression.fyi) to translate it to a specific company's ladder.
- **Dual Tracks**: Many organizations have parallel growth paths (IC vs. management); this page focuses on IC leveling.
- **Directional Velocity**: Time-to-next ranges are directional. Use them to set expectations, not to benchmark yourself against peers.
