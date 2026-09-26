# Plan Task

## Variables

### prompt

{{prompt}}

### previous_envelope

{{previous_envelope}}

### context_handoff_dir

{{context_handoff_dir}}

## Task

Produce an implementation plan for the TaskMaster task described in `prompt`.

Read any relevant source and test files from the monorepo first, then write your
plan to `{{context_handoff_dir}}/plan.md`.

## Report

CRITICAL: Respond with ONLY a raw JSON object. No prose outside the JSON:

```json
{
  "status": "success",
  "summary": "<one sentence describing the plan>",
  "artifacts": ["{{context_handoff_dir}}/plan.md"],
  "notes_for_next_agent": "<key decisions the builder must know>"
}
```
