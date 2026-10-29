# Contributing

Sema is three workbenches behind one launcher. Each one is a surface over tools that already do the science well:

| Workbench | Data | Engine underneath | Method notes |
|---|---|---|---|
| **Sema** | EEG, MEG, fNIRS (anything MNE reads) | MNE-Python | [MNE_CAPABILITY_MAP.md](docs/MNE_CAPABILITY_MAP.md), [EEGLAB_PARITY.md](docs/EEGLAB_PARITY.md) |
| **Plethos** | bulk RNA-seq counts + sample sheet | DESeq2 (R) or PyDESeq2, gseapy | [FORMAT_BULK_RNASEQ.md](docs/FORMAT_BULK_RNASEQ.md) |
| **Karyon** | snRNA-seq, CellBender / 10x `.h5` | scanpy, PyDESeq2 on pseudobulk | [FORMAT_SNRNASEQ.md](docs/FORMAT_SNRNASEQ.md) |

The project needs scientists as much as programmers. A sharp method review is worth more than most code.

## Ways in

- **Review a method.** Read a format doc and tell us where the statistics are wrong or the defaults are badly chosen. Use the *Method or statistics review* issue form.
- **Add an operation to Sema.** Decorate a function with `@sema.operation`; the form, the gating and the exported script line come from its signature (README → *Extending it*).
- **Add a stage or a figure to Plethos or Karyon.** Stages are read from the scripts' headers and the notebook's `##` headings, and parameters from the config file or cell. The workbench follows the source, so most changes are a change to `workflows/`. Figures are JSON specs drawn by `frontend/src/omics/figures/kinds.tsx`.
- **Propose a new format.** A fourth workbench needs a workflow under `workflows/`, a detector rule in `frontend/src/lib/detect.ts`, and a format doc in the shape of the two RNA-seq ones. Open a *New data format or workflow* issue first.
- **Pick up an issue** labelled `good first issue` or `help wanted`.

## Setup

```bash
./scripts/setup.sh     # backend venv (uv) + frontend deps
./dev.sh               # API on :8123, UI on :5173
```

The launcher has synthetic samples for all three workbenches, so you don't need real data to develop.

## Before you open a PR

```bash
./scripts/check.sh          # backend tests, typecheck, lint, frontend tests
./scripts/check.sh e2e      # plus the Playwright suite, if you touched the UI
```

CI runs the same script. Keep PRs to one idea. The template asks how you checked the change, so say what you ran and what you saw.

## House rules

1. **Nothing leaves the machine.** No telemetry, and no upload of user data to any service.
2. **Every step is reproducible.** A Sema operation lands in the ledger and the exported `pipeline.py`. A Plethos or Karyon setting lives in `config.py` / `config.R` / the notebook's configuration cell, not in the UI alone.
3. **The unit of inference is explicit.** Group comparisons are made between animals or subjects, never between cells, epochs or channels treated as replicates. The Design card in the Parameters pane shows this; keep it true.
4. **Don't reimplement the science.** Wrap the reference implementation (MNE, DESeq2, scanpy) and cite it.
5. **Show the truth in figures.** Simulated data says so on the figure. Exploratory hits are labelled exploratory.

## Code style

Match the surrounding code: its naming, its comment density, its idioms. Comments explain *why*, in plain sentences. Python is formatted with ruff and TypeScript is linted with oxlint (`npm run lint`).

## Conduct

Be kind and specific, and argue with the evidence, not the person. We follow the [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). Report problems privately to the maintainer through GitHub.

## Licence

By contributing you agree that your work is released under the [MIT licence](LICENSE).
