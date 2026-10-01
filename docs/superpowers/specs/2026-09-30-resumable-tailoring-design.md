# Resumable Tailoring

Date: 2026-09-30
Status: Approved for implementation planning on 2026-09-30.

## Purpose

Make Tailoring safe to leave and predictable to reopen. Protect user-entered content from the first edit, state clearly where it has been saved, and restore the specific work after refresh. Support multiple independent applications and manual resume drafts in the same workspace. Cross-device synchronization is out of scope.

The user approved this design through brainstorming and grilling. In particular, clicking Tailoring must always open the list; there is no automatic redirect to the latest draft and no special Continue draft banner. Each list item opens its own work.

## Existing behavior and constraints

- `packages/ui/src/routing.ts` identifies runs by `/tailor/<slug>`, but the active step is memory-only. `TailoringRun.tsx` defaults to the first unapproved step when reopened.
- Setup fields in `TailoringRunList.tsx` are memory-only until Create run.
- Analysis and alignment editors reset their drafts when server props change. File events can therefore erase local edits. Switching steps can also unmount unsaved editors.
- Proposal text is local until Save edit. Its editor currently closes before persistence finishes.
- `ResumeTailor.tsx` keeps manual edits and selected resume in memory. Its compiled `currentSpec` excludes unchecked bullets and is insufficient as a recovery snapshot.
- `packages/cli/src/tailoring/store.ts` stores run artifacts in `tailoring/<slug>/`. Existing individual writes are not a transaction across files.
- The orchestrator's `saveStep` validates content, changes step state, and invalidates downstream results. It must not be used for recovery autosave.
- Generation runs on the server and can survive a browser refresh. Server restart can interrupt generation. Base resumes are currently read live by ID.

Implementation must preserve unrelated uncommitted work and adapt to the current code at implementation time.

## User experience

### List and identity

`/tailor` always shows the list. Include setup drafts, active runs, manual drafts, and completed items. Each entry identifies its name or role, kind, current stage, last user edit time, and completion status. Opening a row restores that item's working context. Background polling and UI navigation do not change the last user edit time.

Allocate a stable draft ID on the first user content mutation. Opening an empty form alone creates no draft. Entering text or deliberately changing a setup selection counts as a mutation; initialized defaults do not. Further edits reuse that ID. Untitled drafts have a readable fallback name. Several drafts may use the same base resume.

Use `/tailor/drafts/<id>` for setup and manual drafts; preserve `/tailor/<slug>` for runs. Encode the selected run step in a query parameter. Store other working context with the draft. An explicit valid step in a URL takes precedence over remembered context; otherwise use the remembered step, falling back to the existing first-unapproved rule. Reserve route segments so they cannot be interpreted as run slugs.

Existing `/tailor/canvas` remains a manual-editor entry point and acquires a draft URL when content changes. It must not pick an arbitrary previous draft. Missing draft/run links show a recoverable unavailable state with a link to the list, not a silently substituted draft.

Creating a run transitions its setup draft into that run, retaining draft identity and recovery data. The list shows one item, not separate setup and run entries. Creation is idempotent by draft ID so a lost response or retry does not create duplicate runs.

### Restoration

Restore user content and meaningful working context: setup fields, selected base resume and runner, active step, selected proposal, an open inline text editor and its unfinished text, inclusion choices including unchecked bullets, and the mobile pane. Restore field text even when temporarily invalid. Do not reopen transient confirmation dialogs or reproduce a pending approval or model request. Exact scroll restoration is out of scope.

Keep draft state outside step components so changing steps does not erase edits. Server updates may refresh generation status and unchanged data, but cannot blindly replace edited fields. Remove prop-driven resets that overwrite draft state.

### Save status and explicit actions

Show a persistent, accessible status near the draft title:

- **Saving…** while workspace persistence is pending.
- **Draft saved · time** only when the current content revision is acknowledged by workspace storage.
- **Saved in this browser · Workspace save pending** when recovery storage succeeded but workspace storage is unavailable; retry automatically when connectivity returns.
- **Unsaved changes · Retry** when neither store holds the latest content. Retain the in-memory edits and warn before leaving.
- A conflict message when another version prevents a save; do not label that revision workspace-saved.

Use restrained live announcements for state transitions, not every keystroke. Timestamps must refer to actual acknowledged content, not an attempted request or stale response.

Autosave stores recovery content only. **Apply changes** validates and commits a step's draft to workflow artifacts. Applying does not approve, generate, or finalize. An existing explicitly labeled Approve and continue action may still approve and start the next step, but only after the current edits have been successfully applied. Unapplied or invalid edits cannot be silently bypassed by approval or finalization. Display the distinction between Draft saved and Changes applied when relevant.

For the manual editor, saving a named resume variant is the explicit publication boundary. Recovery snapshots include the full editable model, not just the included bullets used for export.

**Back to list** keeps work. **Discard draft** explicitly deletes recovery state after confirmation. For a run, discarding unapplied edits does not delete previously applied artifacts or exported resumes; the confirmation explains this scope. It must not erase another tab's newer revision. No automatic expiry of unfinished drafts.

### Completion

Successful run finalization or manual Save variant marks the item Completed only after output persistence succeeds. Keep a completion snapshot and output identity so later drafts cannot alter the completed view. A failed finalization/save leaves the draft unfinished and recoverable.

Opening completed work shows its completed result. **Continue editing** creates a new linked draft with independent identity and content, preserving the completed version. For runs, carry forward the completed inputs and artifacts into an independent continuation; do not generate automatically. Further finalization/save creates a distinct output version rather than overwriting the preserved completed result. Existing output names may remain display labels; version identity must be unique.

## Storage and component boundaries

### Draft model and repository

Introduce a versioned recovery model separate from validated workflow schemas. A draft envelope contains ID, schema version, kind, lifecycle status, revision, created/edited timestamps, optional run slug, optional parent completion ID, base snapshot and fingerprint, editable payload, and working context. The payload validates structure and size without requiring fields to satisfy final workflow validation. Preserve stable editor item IDs across saves and reloads.

Store drafts under a dedicated workspace directory, `tailoring-drafts/`, outside run enumeration. Completion snapshots also live under this repository with explicit record type. The server exposes list/read/create/update/discard and completion/continuation operations using stable IDs. Return authoritative revision and save time on acknowledgement. Keep this repository responsible for recovery persistence, not model execution or workflow approval.

Updates use an expected revision; stale requests return a conflict with the current revision instead of overwriting data. Serialize writes per record, write via temporary file and replacement, and acknowledge only after successful persistence. A failed replacement must preserve the previous readable record. Detect external file changes using content fingerprints as well as revisions. Creation, completion, and continuation operations must be retry-safe.

### Client persistence coordinator

A focused coordinator owns hydration, local changes, recovery writes, queued workspace saves, save status, and reconciliation. Editors access content and mutation methods through this coordinator; they do not each implement storage logic.

Namespace browser recovery by workspace identity and draft ID. Persist each content mutation to browser recovery immediately, and debounce workspace saves by approximately 500 ms. Do not rely on an unload request for correctness. Keep context writes separate from content revision acknowledgements so moving between panes cannot claim unsaved text was saved. Handle browser-storage failures explicitly.

Hydration compares workspace data, the browser snapshot, and the revision from which local edits began. Restore newer recoverable local edits automatically only when the server still matches their base revision. Otherwise enter conflict resolution. Keep a local snapshot until its exact content revision is acknowledged; an older response cannot clear newer edits or advance the save indicator. Partition per-tab pending recovery so two tabs cannot overwrite each other's unsent text. Recovery records remain discoverable after a tab closes. Merge browser-only drafts into the list by draft ID and label their storage status; a first save failure must not make a new draft undiscoverable. When several divergent local snapshots exist, preserve them and offer a choice instead of choosing by timestamp alone.

Use browser coordination to discover other writers and revision checks as the authoritative protection. On conflict, preserve both versions and pause conflicting writes. Offer **Load newer version** or **Keep mine as a separate draft**. Keep a recovery copy until the user's choice has completed successfully. Do not silently retry a conflict as an unconditional write. A deleted record cannot be recreated by a stale queued save; explicit recovery into a new draft is allowed.

### Workflow integration

Keep recovery writes independent of the orchestrator's same-run generation lock. Apply changes uses existing validation and downstream invalidation semantics with expected artifact fingerprints, so external artifact changes are detected. Saving a recovery snapshot must not change step status.

Track the artifact revision underlying each edited step. When a model result or external edit arrives, retain pending edits and reconcile against that baseline. During generation, reconnect to status after refresh without restarting the request. If the server restarts and marks generation interrupted, show **Generation interrupted · Retry** while preserving drafts and completed outputs. Retry is explicit. Recovery writes may continue while apply/sync operations that would alter running inputs wait until generation stops.

### Base snapshot and upstream sync

Capture the selected base resume when a draft begins and use that snapshot for its generation, validation, application, and finalization. A deliberate base selection change in setup replaces the setup snapshot; after work has begun, upstream changes go through the sync flow. Never silently reread the live base during generation.

Compare the source resume fingerprint with the captured version. Show **Base resume updated** and **Sync upstream** when they differ. A missing source is shown as unavailable while the snapshot remains usable.

Sync previews a three-way merge of the old base, the user's draft, and the current upstream base. Automatically merge independent changes; require choices for overlapping edits and edit-versus-delete conflicts. Stable identities are used where available. Ambiguous matches and competing reorder operations are conflicts, never guessed by array index.

Cancel leaves the draft and base snapshot unchanged. Applying a resolved merge checks that upstream and draft revisions still match the preview; otherwise refresh the preview. Persist the merged draft and new base baseline together. Preserve pre-sync recovery until the update succeeds.

Flag affected generated results and approvals for review and block use of stale results in finalization. If dependencies cannot be determined reliably, conservatively mark all results dependent on the changed base as requiring review. Preserve the previous results for comparison; do not rerun automatically. Index-based proposal targets must be remapped unambiguously or flagged for review, never applied to a different bullet after a reorder.

## Compatibility and boundaries

Existing run URLs and saved resume files continue to work. Existing runs receive recovery records lazily when opened/edited; use existing approved artifacts as their baseline. Capture the currently available base for a legacy run on adoption and disclose that its historical base cannot be recovered. If this may change existing proposal targeting, require review rather than assuming historical equivalence.

Existing completed runs remain readable and can establish a completion snapshot before continuation. Malformed or unsupported recovery records must not be overwritten: show a recovery error and retain the original data. Workspace switching must never restore another workspace's draft.

This is one cohesive feature with separate persistence, routing, editor, workflow, and merge components. It does not introduce cross-device sync, automatic model retries, a general version-history browser, or exact scroll restoration.

## Acceptance and validation

Use focused repository, API, component, and browser tests at the boundaries where loss or unintended workflow actions can occur:

1. Enter setup content and refresh immediately before the workspace debounce expires. Recover text and selections at the same draft URL without creating a model run or duplicate list item.
2. Edit incomplete analysis text, alignment rationale, proposal text, and a manual resume with unchecked bullets. Switch steps, navigate away, refresh, and reopen; preserve exact editable content and relevant context.
3. Open `/tailor` from navigation and verify only the list appears. Direct links and refresh restore the intended draft/step. Missing IDs show unavailable states.
4. Deliver an older save acknowledgement after a newer edit. Verify the newer edit remains pending. Fail workspace storage, then both stores, and verify truthful status, recovery, retry, and leave protection.
5. Edit the same draft in two tabs or change its file externally. Verify conflict detection, preservation of both versions, and both resolution actions. Discard cannot be undone by a stale queued save.
6. Autosave invalid partial content without changing workflow state. Apply validates and invalidates downstream artifacts as appropriate. Approval/finalization cannot bypass unapplied edits or validation failures.
7. Receive file events or generation completion while an editor has pending changes. Verify no prop refresh erases them. Refresh during generation reconnects; server restart offers Retry without another model call.
8. Update a base resume externally. Verify the indicator, unchanged snapshot before sync, non-overlapping merge, overlapping/deletion/reorder conflicts, cancel behavior, concurrent upstream changes during preview, and review requirements after sync.
9. Finalize or save a variant, reopen Completed, and Continue editing. Verify distinct draft/output identities and immutable completed content. Failed completion leaves work unfinished.
10. Reopen legacy runs, switch workspaces, and encounter malformed recovery records. Verify compatibility, isolation, and preservation of original data.

Run existing tailoring, routing, and manual-editor checks alongside these targeted cases. This document-only change requires no application test run.

## Review outcome

Self-review: checked for incomplete requirements, conflicting save semantics, route ambiguity, scope drift, and silent overwrite paths. The user reviewed the written spec and requested an implementation plan.
