# BUG-009: Give saved resumes unique identities and distinguishable choices

Priority: P2. Status: open. Triage: ready-for-agent. Task Master: 58.

## Problem and evidence

The [live picker](../../../netbox-live-job-attempt-2026-11-07.md) contained a
long list with duplicate main labels and duplicate `tailored-main` values. The
loader derives identity from resume type plus basename, so differing extensions
or directories can collide. Choosing the wrong file was not demonstrated, but
the identity collision is present in the loader and captured option list.

## Reproduction

1. Create valid `resumes/tailored/main.yaml` and `main.tex` files, plus a
   nested resume with the same basename.
2. Load the records, render the picker, and select each file in turn.
3. Reorder filesystem traversal and reload the choices.
4. Resolve a legacy saved job referring to `tailored-main`.

Expected: every selectable file has a unique identity stable while that file's
location is unchanged. Legacy ambiguity requires a choice; order cannot decide
it.

## Implementation scope

Inspect [loadResumeSpecs](../../../../packages/cli/src/server.ts),
[JobInputReview.tsx](../../../../packages/ui/src/views/jobs/JobInputReview.tsx),
[ResumeVariantPicker.tsx](../../../../packages/ui/src/components/ResumeVariantPicker.tsx), and [captureInputs](../../../../packages/cli/src/jobs/runtime.ts).

Use a namespaced identifier derived from normalized workspace-relative file
identity, including extension, or an equivalent persisted unique identity.
Define Windows path/case normalization. A rename must become an explicit
missing/changed selection unless a recorded identity proves continuity.

Add a searchable picker showing a concise name, relative path, type, and useful
modified date. Reuse the existing resume-variant search component where
suitable. Do not expose full host paths or duplicate UI-only IDs as a
workaround.

Maintain a legacy resolution path: resolve an old ID only if unambiguous;
otherwise request selection before a new capture. Already captured historical
resumes remain readable from their immutable snapshots.

## Acceptance and verification

- Same basenames across extensions/directories have different selection values.
- Each value selects its exact intended bytes, independent of traversal order.
- Search and keyboard navigation work with a large variant list.
- Legacy unique IDs resolve; ambiguous IDs never silently select the first
  file.
- Deleted/moved choices preserve historical artifacts and require an explicit
  current selection. No automatic regeneration or blanket rewrite of saved jobs.
- Test loader identity, capture selection, legacy resolution, and
  desktop/mobile accessible picker behavior.

Dependencies: none. This identity contract precedes
[BUG-008](bug-008-captured-resume-selection.md) captured-selection presentation.
