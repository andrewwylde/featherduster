"""Delivery contracts and independent outcome reports."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sssf_core.data_types import EnvelopeBase, SSSFConfig

Text = Annotated[str, Field(min_length=1, pattern=r"\S")]
Identifier = Annotated[str, Field(pattern=r"^[a-zA-Z0-9_-]+$")]


class WorkflowRequest(BaseModel):
    task_id: int | None = None
    prompt_arg: str | None = None
    config: str | SSSFConfig
    adw_id: str | None = None
    skip_plan: bool = False
    dry_run: bool = False
    delivery_contract: str


class DeliveryModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ProductReference(DeliveryModel):
    path: Text
    convention: Text


class Scenario(DeliveryModel):
    id: Identifier
    environment: Literal["source", "fixture", "live"]
    state: Text
    data_volume: Text
    load: Text


class EvidenceCommand(DeliveryModel):
    id: Identifier
    kind: Literal["check", "browser", "live"]
    argv: list[Text] = Field(min_length=1)
    timeout_seconds: int = Field(default=120, ge=1, le=600)
    scenario_ids: list[Identifier] = Field(min_length=1)
    identity_argv: list[Text] = Field(default_factory=list)

    @model_validator(mode="after")
    def identity_required(self):
        if self.kind != "check" and not self.identity_argv:
            raise ValueError("browser/live evidence requires an independent served-build identity probe")
        return self


class DeliveryCriterion(DeliveryModel):
    id: Identifier
    outcome: Text
    command_ids: list[Identifier] = Field(min_length=1)


class DeliveryContract(DeliveryModel):
    id: Identifier
    revision: int = Field(ge=1)
    scope: Literal["engineering", "interactive", "live_incident"]
    interactive: bool
    delivery_extent: Literal["complete", "checkpoint"]
    user_checkpoint: Text
    explicitly_remaining_scope: str
    product_references: list[ProductReference]
    scenarios: list[Scenario] = Field(min_length=1)
    evidence_commands: list[EvidenceCommand] = Field(min_length=1)
    required_criteria: list[DeliveryCriterion] = Field(min_length=1)

    @model_validator(mode="after")
    def coherent(self):
        if (self.delivery_extent == "checkpoint") != bool(self.explicitly_remaining_scope.strip()):
            raise ValueError("checkpoint requires remaining scope; complete delivery must have no remaining scope")
        if self.scope == "interactive" and not self.interactive:
            raise ValueError("interactive scope must declare interactive: true")
        for name in ("scenarios", "evidence_commands", "required_criteria"):
            values = getattr(self, name)
            if len({v.id for v in values}) != len(values):
                raise ValueError(f"duplicate IDs in {name}")
        scenarios = {s.id for s in self.scenarios}
        commands = {c.id for c in self.evidence_commands}
        used_commands = set()
        for command in self.evidence_commands:
            if not set(command.scenario_ids) <= scenarios:
                raise ValueError(f"{command.id}: unknown scenario")
            if len(set(command.scenario_ids)) != len(command.scenario_ids):
                raise ValueError(f"{command.id}: duplicate scenarios")
        for criterion in self.required_criteria:
            if not set(criterion.command_ids) <= commands:
                raise ValueError(f"{criterion.id}: unknown evidence command")
            used_commands.update(criterion.command_ids)
        if used_commands != commands:
            raise ValueError("every evidence command must support a required criterion")
        covered = {s for c in self.evidence_commands for s in c.scenario_ids}
        if covered != scenarios:
            raise ValueError("every scenario must have an evidence command")
        if self.interactive:
            if not self.product_references or not any(c.kind == "browser" for c in self.evidence_commands):
                raise ValueError("interactive delivery requires product references and browser evidence")
        if self.scope == "live_incident":
            live = {s.id for s in self.scenarios if s.environment == "live"}
            if not live or not any(c.kind == "live" and set(c.scenario_ids) & live
                                   for c in self.evidence_commands):
                raise ValueError("live incident requires a live scenario and live evidence command")
        return self


class CapturedArtifact(DeliveryModel):
    path: Text
    kind: Literal["screenshot", "trace", "state"]


class CaptureManifest(DeliveryModel):
    """Written by a code-run capture command, never supplied by the builder report."""
    served_build_identity: Text
    outcome_identity: Text
    identity_method: Text
    observation: Text
    scenario_ids: list[Identifier] = Field(min_length=1)
    artifacts: list[CapturedArtifact] = Field(min_length=1)


class CurrentIdentity(DeliveryModel):
    served_build_identity: Text
    outcome_identity: Text


class CriterionVerdict(DeliveryModel):
    id: Identifier
    verdict: Literal["pass", "fail", "not_run"]
    observation: Text
    evidence_ids: list[Identifier]


class DeliveryReviewOutput(EnvelopeBase):
    model_config = ConfigDict(extra="forbid")
    contract_sha256: Text
    source_sha256: Text
    evidence_sha256: Text
    reviewer: Literal["delivery_reviewer"]
    entry_assessment: str
    criteria: list[CriterionVerdict]
    blocking_findings: list[Text]
