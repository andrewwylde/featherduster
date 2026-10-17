# Build Task

## Variables

### prompt

{{prompt}}

### previous_envelope

{{previous_envelope}}

### context_handoff_dir

{{context_handoff_dir}}

## Task

Implement the work described in `prompt`, following the plan in
`previous_envelope`. Retain the full delivery contract and original plan during
repairs. Run the engineering checks and demonstrate every required outcome;
passing tests alone does not confirm delivery. Report any unverified criterion.

The final JSON reports implementation readiness; the workflow independently
captures and reviews delivery afterward. Finish the assigned implementation and
engineering verification, and preserve unverified delivery criteria in notes.
Do not wait for a reviewer tool inside the builder or return a report-only result
while ordinary implementation remains possible. Final delivery acceptance stays
with the existing independent outcome gate.

## Report

CRITICAL: Respond with ONLY a raw JSON object matching `BuildOutput`. No prose:

```json
{
  "status": "success",
  "summary": "<one sentence summary of what you changed>",
  "changed_files": ["<relative path>", "..."],
  "artifacts": [],
  "commit_message": "<conventional commit subject, e.g. test: add coverage for evidence-files.ts>",
  "notes_for_next_agent": "<any known issues or follow-ups>"
}
```
