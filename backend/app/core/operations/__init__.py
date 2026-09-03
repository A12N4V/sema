"""Importing this package populates the operation REGISTRY.

Add a new stage module here and import it below so its ``register(...)`` calls
run at startup.
"""
from app.core.operations.base import (  # noqa: F401
    Operation,
    OpParams,
    REGISTRY,
    all_ops,
    get,
    ops_for,
    register,
)
from app.core.operations import preprocessing  # noqa: F401  (registers Raw-stage ops)
