"""The extension surface: add an MNE operation from outside this codebase.

EEGLAB's real advantage is not any one feature, it is that a hundred people
have been able to add features to it without touching its core. The operation
registry here is already the right shape for that; this module is the public
door to it.

    import sema, mne

    @sema.operation(label="Detrend", stage="Filter & repair")
    def detrend(raw, order: int = 1):
        raw.apply_function(lambda x: mne.filter.detrend(x, order), verbose="ERROR")

One decorator buys the same things a built-in gets: an entry in the command
palette, a form generated from the type hints, a gate on capabilities, a ledger
row, and a line in the exported pipeline.py. Nothing about a plugin operation is
second class, which is the only way an extension surface actually gets used.
"""
from __future__ import annotations

import inspect
from typing import Any, Callable, Iterable

from pydantic import Field, create_model

from app.core.containers import ContainerKind
from app.core.operations.base import Operation, OpParams, register

_KIND = {k.value: k for k in ContainerKind}


def _params_model(name: str, fn: Callable) -> type[OpParams]:
    """Build the param model from the function's own signature.

    The first parameter is the container and is skipped. Everything after it
    becomes a form field, using the annotation for the type and the default for
    the initial value. A parameter with no default is required, which is exactly
    how the generated form should treat it.
    """
    sig = inspect.signature(fn)
    fields: dict[str, tuple[Any, Any]] = {}
    for i, (pname, param) in enumerate(sig.parameters.items()):
        if i == 0:
            continue
        if param.kind in (param.VAR_POSITIONAL, param.VAR_KEYWORD):
            raise TypeError(
                f"{name}: *args/**kwargs cannot be turned into a form. "
                "Declare each parameter explicitly.")
        annotation = param.annotation if param.annotation is not inspect.Parameter.empty else float
        default = ... if param.default is inspect.Parameter.empty else param.default
        fields[pname] = (annotation, Field(default, description=pname.replace("_", " ")))
    return create_model(f"{name.title().replace('_', '')}Params", __base__=OpParams, **fields)


def operation(
    fn: Callable | None = None,
    *,
    id: str | None = None,
    label: str | None = None,
    stage: str = "Custom",
    inputs: str | Iterable[str] = "raw",
    output: str | None = None,
    requires: Iterable[str] = (),
    long_running: bool = False,
    doc: str | None = None,
):
    """Register a function as a first-class Sema operation.

    The function is called as ``fn(container, **params)`` and mutates it in
    place, the same contract the built-in operations use.
    """
    def decorate(f: Callable) -> Callable:
        op_id = id or f.__name__
        kinds = [inputs] if isinstance(inputs, str) else list(inputs)
        try:
            in_kinds = tuple(_KIND[k] for k in kinds)
        except KeyError as e:
            raise ValueError(f"{op_id}: unknown container kind {e.args[0]!r}. "
                             f"One of {sorted(_KIND)}") from None
        if output is not None and output not in _KIND:
            raise ValueError(f"{op_id}: unknown output kind {output!r}")

        model = _params_model(op_id, f)
        human = label or op_id.replace("_", " ").capitalize()

        def run(session, params) -> None:
            values = params.model_dump()
            target = session.raw if in_kinds[0] is ContainerKind.RAW else session.epochs
            if target is None:
                raise ValueError(f"{op_id} needs a {in_kinds[0].value} and this session has none")
            with session.lock:
                f(target, **values)
                # a plugin's step is recorded like any other, so it survives into
                # the provenance DAG and the exported script
                session.ledger.append(
                    op_id, values, label=human,
                    template=f"{op_id}(raw, **{values!r})  # plugin",
                    replayable=False,
                )

        register(Operation(
            id=op_id, stage=stage, label=human, inputs=in_kinds,
            output=_KIND[output] if output else None,
            params_model=model, run=run, requires=tuple(requires),
            long_running=long_running,
            doc=doc or (inspect.getdoc(f) or "").split("\n")[0],
        ))
        return f

    return decorate if fn is None else decorate(fn)
