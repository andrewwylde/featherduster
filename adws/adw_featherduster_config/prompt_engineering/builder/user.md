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
`previous_envelope`. Then run the test command to confirm success.

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
