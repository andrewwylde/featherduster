# De-Slop Quality Rubric

Score technical prose, resume bullets, and accomplishment narratives on **clarity, groundedness, and humanness** — does this sound like a technical practitioner with authentic ownership, or generic AI-flavored filler?

---

## Scoring Bands (0–100)

- **strong (80–100):**
  - Concrete, specific, and grounded in verifiable facts.
  - Survives a hostile editor's red pen.
  - Every assertion is supported by an evidence citation (`ev-###`) or concrete metric.
  - Removing it would lose critical technical signal.

- **moderate (50–79):**
  - A real technical contribution is present, but softened or diluted by hedging or filler.
  - Needs tightening: strip leading stems, remove filler adverbs, and elevate the verb.

- **weak (20–49):**
  - Pattern-matchable AI prose with generic corporate uplift or manufactured urgency.
  - The sentence mimics the rhythm of an achievement without demonstrating real ownership or measurable outcomes.
  - Removing it loses virtually nothing.

- **fail (0–19):**
  - Pure scaffolding language: empty hedging, listicle stems, or buzzword soup ("spearheaded synergies in today's fast-paced digital world").

---

## The Two Critical Tests

### 1. The Hostile-Editor Test
> *Would a skeptical engineering director or hiring committee leave this bullet on the page, or red-pen it as fluff?*
- If an accomplishment uses words like "empowered", "frictionless", or "cutting-edge" without stating what the technology actually is and how it performed, it fails the hostile-editor test.

### 2. The Removal Test
> *If you deleted this sentence or bullet entirely, would the reader lose any concrete information?*
- If deleting it costs nothing, the text is slop regardless of how polished it sounds.

---

## Triage Rules: Rewordable vs. Hollow

For any span scoring below **strong**:

1. **REWORDABLE:**
   - The text contains a real claim or technical action that is buried under buzzwords or hedging.
   - *Fix:* Subtract hedging and filler, keep verbs active and factual, preserve metrics.
   - *Example:* "It is worth noting that we spearheaded the migration to microservices, achieving a 40% drop in latency."
   - *Rewrite:* "Migrated monolithic backend to microservices, reducing p99 latency by 40%."

2. **HOLLOW:**
   - The text has no underlying fact, metric, or technical action.
   - *Fix:* **Flag, do not fabricate.** Flag with `[METRIC NEEDED]` or prompt the user for real evidence. Never invent an impressive-sounding claim to fill the void.
