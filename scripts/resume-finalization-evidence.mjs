import { createHash } from 'node:crypto';

const canonical = value => JSON.stringify(value, (_, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const identity = value => `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;

// Inputs must be freshly observed served bytes and independently verified persisted outcomes.
// Do not pass an earlier manifest/identity in place of either observation.
export function currentIdentity(servedAssets, observedOutcome) {
  return { served_build_identity: identity(servedAssets), outcome_identity: identity(observedOutcome) };
}

export function captureManifest(current, scenarioIds, artifacts) {
  return {
    served_build_identity: current.served_build_identity,
    outcome_identity: current.outcome_identity,
    identity_method: 'Fetch and hash current served HTML, JavaScript and CSS bytes; independently re-read persisted job, artifact, input, draft revisions, events, finalization receipts and variants, enforce current-export freshness, and verify actual PDF text/page coverage and downloaded bytes. Identity probes repeat these observations without modifying captured files.',
    observation: 'Real fixture-backed generation, invalid editing, reactive stale-response rejection, draft save/reload, checker outage/retry, previous-PDF labeling/download, navigation guards, exact-revision finalization with lost-response recovery and current PDF download; keyboard Details, fuzzy variant search, and URLs default at 1440px and 375px without horizontal page overflow. Inspectable original Playwright records are in trace-actions.jsonl, trace-events.jsonl and trace-network.jsonl; archived API JSON bodies are resolved in trace-api.jsonl and observed UI/API progression is in interaction-journal.jsonl. PDF text/info, raw identity-probe stdout and regression rejection, evidence hash snapshots, and current build/test command logs are referenced alongside capture-state.json and trace.zip.',
    scenario_ids: scenarioIds,
    artifacts,
  };
}
