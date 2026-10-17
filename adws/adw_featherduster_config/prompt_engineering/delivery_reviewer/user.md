# Evaluate delivery outcomes

### prompt

{{prompt}}

### context_handoff_dir

{{context_handoff_dir}}

## Task

Evaluate the complete contract using the supplied captured artifacts and named
product references. Do not open other session records. Return the independent
verdict, not implementation work. Missing evidence never counts as a pass.

## Report

Return only JSON matching `DeliveryReviewOutput`:

```json
{
  "status": "success",
  "summary": "Independent review completed; one outcome is unverified",
  "artifacts": [],
  "notes_for_next_agent": "Explain the demonstrated boundary and required correction",
  "contract_sha256": "copy the supplied contract hash",
  "source_sha256": "copy the supplied source hash",
  "evidence_sha256": "copy the supplied evidence hash",
  "reviewer": "delivery_reviewer",
  "entry_assessment": "From the default screen: why stopped, next action, and where; or explain what is missing. Empty for noninteractive engineering work.",
  "criteria": [
    {
      "id": "criterion-id-from-contract",
      "verdict": "not_run",
      "observation": "Describe the actual observed evidence or its absence",
      "evidence_ids": ["evidence-command-id-from-contract"]
    }
  ],
  "blocking_findings": ["A required user outcome has not been demonstrated"]
}
```
