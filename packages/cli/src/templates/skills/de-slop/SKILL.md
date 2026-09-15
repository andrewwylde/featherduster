---
name: de-slop
description: >-
  Use when prose reads like AI — to remove "AI slop" (empty hedging, listicle
  stems, smooth transitions that hide the absence of a claim, generic filler,
  manufactured stakes, and buzzword inflation) and rewrite it into sharp, grounded
  technical writing with a real point of view. Trigger on requests like "humanize this",
  "de-slop", "remove the AI slop", "make this sound less like AI / less like ChatGPT",
  or after generating resume bullets and accomplishment summaries that need a quality pass.
  Detects, rewrites fixable parts, self-scores against an embedded rubric, and iterates
  to a high bar — preserving facts and metrics exactly, flagging hollow spans instead of
  inventing claims, and reporting changes rather than overwriting.
license: MIT
---

# De-Slop

Turn AI-slop prose into writing that survives a hostile editor's red pen — without swapping one kind of slop for another.

## Two hard rules (read first)

1. **Fidelity over flair.** Preserve the original meaning, facts, and metrics *exactly*.
   Only subtract hedging/filler and sharpen what is already there. Never inject
   stance, edginess, em-dash theatrics, or unearned adjectives. **Swapping AI-slop
   for edgy-slop is a failure, not a fix.**
2. **Flag hollow spans, don't fabricate.** Some prose is weak because it has no
   point to make — rewording cannot save it. Flag those. Do **not** invent a claim
   or hallucinate metrics to make them sound sharp.

## The 6-Step Loop

**0. Scope.** Work paragraph by paragraph (or bullet by bullet). Skip code blocks,
blockquotes, headings, and genuine data lists.

**1. Pre-flag.** Run the cheap deterministic pass to narrow attention:

```bash
featherduster check
```

Or detect slop patterns through `@featherduster/core` / `auditSlop`:
It scans for candidate spans (hedge stems, "in today's...", triadic buzzwords,
copula inflation, filler intensifiers, assistant voice, etc.). These are **candidates,
not final verdicts** — you still judge every paragraph or bullet.

**2. Judge.** Score each unit against `references/rubric.md` →
`strong | moderate | weak | fail`, with a one-line reason. Apply the hostile-editor
test: *would this survive a red pen? does removing it lose anything?*

**3. Triage** each unit below **strong**:
- **Rewordable** — there's a real claim buried under hedging/filler → rewrite.
- **Hollow** — weak because there's no actual point or evidence → **flag, don't fabricate**.

**4. Rewrite** the rewordable ones. Subtract the hedging, strip the filler, sharpen
the existing claim, and keep the meaning and verifiable metrics identical.

**5. Self-score** the rewrite against the rubric again:
- Reached **strong** → lock it in.
- Still below → iterate (back to step 4). **Maximum 3 passes total.**
- After 3 passes still not strong → keep the best version and **flag it**
  ("couldn't reach strong — may need a real claim or missing metric, not better words").

**6. Report — do not overwrite.** Return three things:
- **Humanized text** — rewrites applied; hollow spans left intact with placeholders.
- **Change log** — per paragraph/bullet: `before-band → after-band` and what changed.
- **Flags** — hollow spans + any span that hit the 3-pass cap or requires human evidence.

## Properties this loop must preserve

- **Fail-honest:** hollow and capped spans are always surfaced, never quietly "polished."
- **Idempotent:** prose that already scores strong is returned unchanged.
- **Non-destructive:** you produce a report + change log, not an in-place edit without user review.

## References

- `references/rubric.md` — scoring bands, slop indicators, the two tests, and triage rule.
- `references/slop-catalogue.md` — full taxonomy of AI slop tells, causes, and detector rules.
