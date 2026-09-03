"""The operation registry — the keystone of v2.

One ``Operation`` per MNE call. Each carries its input container kind(s), a
Pydantic param model, and a ``run`` that applies it to a ``Session``. From that
one definition the frontend gets: the command-palette entry, an auto-generated
param form (from the JSON schema), the ledger row, and eventually the
``pipeline.py`` line — no per-op route, form, or client wrapper.

Adding an MNE operation = one ``register(Operation(...))`` call in a module
under ``core/operations/``. See docs/BUILD_PLAN_V2.md P0.2.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, TYPE_CHECKING

from pydantic import BaseModel, ConfigDict

from app.core.containers import ContainerKind

if TYPE_CHECKING:
    from app.services.session_manager import Session


class OpParams(BaseModel):
    """Base for every operation's param model. Rejects unknown fields so a
    typo'd param is a 422, not a silently-ignored value."""

    model_config = ConfigDict(extra="forbid")


@dataclass(frozen=True)
class Operation:
    id: str
    stage: str                                   # grouping in the palette
    label: str                                   # human title
    inputs: tuple[ContainerKind, ...]            # container kinds this consumes
    params_model: type[BaseModel]
    run: Callable[["Session", Any], None]        # applies the op (holds the session lock upstream)
    output: ContainerKind | None = None          # None = mutates the input in place
    long_running: bool = False                   # → job queue once P0.3 lands
    requires: tuple[str, ...] = ()               # capability tokens (see session_capabilities)
    doc: str = ""

    def schema(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "stage": self.stage,
            "label": self.label,
            "inputs": [k.value for k in self.inputs],
            "output": self.output.value if self.output else None,
            "long_running": self.long_running,
            "requires": list(self.requires),
            "doc": self.doc,
            "params_schema": self.params_model.model_json_schema(),
        }


REGISTRY: dict[str, Operation] = {}


def register(op: Operation) -> Operation:
    if op.id in REGISTRY:
        raise ValueError(f"Duplicate operation id: {op.id!r}")
    REGISTRY[op.id] = op
    return op


def get(op_id: str) -> Operation | None:
    return REGISTRY.get(op_id)


def ops_for(kind: ContainerKind) -> list[Operation]:
    return [op for op in REGISTRY.values() if kind in op.inputs]


def all_ops() -> list[Operation]:
    return list(REGISTRY.values())
