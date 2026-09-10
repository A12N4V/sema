"""ICA classification: the feature that turns a wall of topographies into a
short list of decisions.

EEGLAB users reach for ICLabel by reflex. Without it, reviewing an ICA means
recognising a blink map by eye, twenty times, which is the single biggest
usability gap against the dominant tool.
"""
from __future__ import annotations

from pydantic import Field

from app.core.containers import ContainerKind
from app.core.operations.base import Operation, OpParams, register

ICA = (ContainerKind.ICA,)

# ICLabel's seven classes, in its own order.
IC_CLASSES = ("brain", "muscle artifact", "eye blink", "heart beat",
              "line noise", "channel noise", "other")
ARTIFACT_CLASSES = ("muscle artifact", "eye blink", "heart beat",
                    "line noise", "channel noise")


class LabelParams(OpParams):
    pass


register(Operation(
    id="label_ica", stage="Decompose", label="Classify components (ICLabel)",
    inputs=ICA, params_model=LabelParams,
    run=lambda s, p: s.label_ica(),
    requires=("ica",), long_running=True,
    doc=("Label every component brain / muscle / eye / heart / line noise / "
         "channel noise / other, with a probability. mne_icalabel.label_components"),
))


class AutoExcludeParams(OpParams):
    labels: list[str] = Field(
        list(ARTIFACT_CLASSES),
        description=f"Classes to mark for removal. One or more of {list(IC_CLASSES)}")
    min_prob: float = Field(0.8, ge=0.0, le=1.0,
                            description="Only mark a component the classifier is this sure about")


register(Operation(
    id="exclude_ica_by_label", stage="Decompose", label="Mark artifact components",
    inputs=ICA, params_model=AutoExcludeParams,
    run=lambda s, p: s.exclude_ica_by_label(p.labels, p.min_prob),
    requires=("ica", "ica_labels"),
    doc="Select components for removal from their ICLabel class and confidence.",
))
