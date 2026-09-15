# Slop Catalogue: The Taxonomy of Tells

The full taxonomy of AI-slop tells: what each one is, *why* it reads as machine prose, the detector pattern that catches it, and a canonical example.

Read this to understand *why* something is flagged. The detector surfaces candidates; the rubric (`rubric.md`) assigns quality bands.

---

## Lexically Detectable Tells

| Tell | Why it reads as AI | Detector Type | Canonical Example |
|---|---|---|---|
| **Empty Hedging** | Avoids committing to the claim it is about to make | `hedge` | "It's worth noting that caching helps." / "Needless to say, testing is vital." |
| **Manufactured Stakes** | Borrowed urgency the content didn't earn | `stakes` | "In today's fast-paced digital world..." / "Now more than ever..." |
| **LLM Lexicon Filler** | Predictable vocabulary favored by language models | `delve` | "delve into the rich tapestry of microservices" / "stands as a testament to" |
| **Business Jargon Idioms** | Empty corporate buzz phrases standing in for a concrete verb | `bizjargon` | "circle back", "move the needle", "low-hanging fruit", "boil the ocean" |
| **Triadic Buzzwords** | Formulaic adjective triplets ("rule-of-three") without proof | `triadic` | "fast, reliable, and scalable" / "powerful, intuitive, and seamless" |
| **Copula Inflation** | Fluffy pseudo-verbs dodging simple "is" or "has" | `copula` | "The platform boasts an intuitive API" / "serves as a cornerstone" |
| **Corporate Buzzword Salad** | Grandiose business jargon that obscures actual work | `corporate_uplift` | "spearheaded cross-functional synergies", "fostered synergistic alignment" |
| **Filler Intensifiers** | Empty adverbs attempting to force unearned importance | `intensifier_filler` | "a truly elegant architecture", "genuinely transformative" |
| **Assistant Voice** | Chatbot conversational habits and sycophancy | `assistant_voice` | "Great question!", "I'd be happy to help", "As an AI language model..." |
| **Vague Quantifiers** | Weasel words substituting for measurable numbers | `vague_quantifier` | "a wide variety of features", "a plethora of options", "a myriad of systems" |
| **Throat-Clearing Openers** | Stalls before delivering the sentence's actual point | `throat_clearing` | "The uncomfortable truth is...", "Make no mistake...", "Let that sink in." |

---

## Why These Tells Degrade Technical & Career Artifacts

1. **Dilutes Engineering Signal:** Hiring managers and engineering leaders scan for concrete scope, decisions, and measurable outcomes. Buzzwords like "streamlined cross-functional synergies" hide what was actually designed, built, or deployed.
2. **Signals Automated Generation:** Clustered tells trigger immediate skepticism during technical resume reviews and promotion calibration committees.
3. **Obscures Ownership:** Phrases like "played a pivotal role in navigating complex paradigms" prevent readers from discerning whether the candidate owned the architecture or merely sat in the room.

---

## Model-Judgment-Only Tells (Semantic Flaws Beyond Simple Regex)

These tells require semantic comprehension and cannot be caught by regex alone:

| Tell | Why No Regex Catches It | How It Is Caught |
|---|---|---|
| **Hollowness** | The sentence is grammatically clean and contains no buzzwords, but makes no factual claim. | Apply the **Removal Test** (`rubric.md`): if you delete it, is anything lost? |
| **Unbacked Claims** | Asserting high impact without citing evidence or verifiable metrics. | Cross-reference against `evidence-ledger.md` and check for `[METRIC NEEDED]`. |
| **Plausible-Sounding Hallucination** | Fabricating plausible technical details that never happened in production. | Strict adherence to the **Ledger Ceiling Rule**. |
