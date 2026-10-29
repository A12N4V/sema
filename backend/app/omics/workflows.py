"""Workflow definitions, read straight from the sources.

Nothing here restates the science. Stages come from the script headers and the
notebook's markdown headings; parameters come from config.py (the Python port
of config.R) and the notebook's configuration cell. Change the source and the
workbench follows.

Two workflows, named for what each one counts:

  Plethos (πλῆθος, the multitude): bulk RNA-seq, one number per gene per
      animal, averaged over every cell in the dentate gyrus.
  Karyon (κάρυον, the kernel; the nucleus): single-nucleus RNA-seq, one
      profile per nucleus, eight animals' worth.
"""
from __future__ import annotations

import ast
import json
import re
from dataclasses import dataclass, field, asdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WORKFLOWS = REPO / "workflows"
BULK_DIR = WORKFLOWS / "bulk-r"
BULK_PY = WORKFLOWS / "bulk-py"
SNRNA_NB = WORKFLOWS / "snrna" / "AdoTHC_hippocampus_scanpy_AUTOMATED.ipynb"


@dataclass
class Param:
    name: str
    type: str            # bool | int | float | str | list
    default: object
    help: str = ""
    group: str = ""


@dataclass
class Stage:
    id: str
    title: str
    summary: str
    source: str = field(repr=False, default="")
    cells: list[int] = field(default_factory=list)   # notebook only
    sources: dict[str, str] = field(repr=False, default_factory=dict)  # engine -> code


@dataclass
class Workflow:
    id: str
    name: str            # the tab: Plethos | Karyon
    gloss: str           # what the name means, one line
    title: str           # what it is, plainly
    engines: list[str]   # first is the default: "python" | "R" | "notebook"
    design: str
    stages: list[Stage]
    params: list[Param]

    @property
    def engine(self) -> str:
        return self.engines[0]

    def public(self) -> dict:
        d = asdict(self)
        for s in d["stages"]:
            s.pop("source")
            s["engines"] = list(s.pop("sources")) or self.engines
        return d


# ------------------------------------------------------------------ bulk / R

# Paths and derived values are set by the runner, not by hand.
_R_SKIP = {"COUNTS_FILE", "META_FILE", "PAL", "PALETTES", "DIRS", "DIVERGE", "ANNOT_COLS"}
_R_ASSIGN = re.compile(r"^CFG\$(\w+)\s*<-\s*(.+)$")


def _split_comment(text: str) -> tuple[str, str]:
    """Split `value  # comment`, ignoring # inside quotes."""
    quote = None
    for i, ch in enumerate(text):
        if quote:
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
        elif ch == "#":
            return text[:i].strip(), text[i:].lstrip("#").strip()
    return text.strip(), ""


def _r_literal(v: str) -> tuple[str, object] | None:
    v = v.strip()
    if v in ("TRUE", "FALSE"):
        return "bool", v == "TRUE"
    if re.fullmatch(r"-?\d+", v):
        return "int", int(v)
    if re.fullmatch(r"-?\d*\.\d+(e-?\d+)?|-?\d+e-?\d+", v):
        return "float", float(v)
    if re.fullmatch(r'"[^"]*"', v):
        return "str", v[1:-1]
    if v == "character(0)":
        return "list", []
    m = re.fullmatch(r"c\((.*)\)", v)
    if m and re.fullmatch(r'\s*("[^"]*"\s*,\s*)*"[^"]*"\s*', m.group(1)):
        return "list", re.findall(r'"([^"]*)"', m.group(1))
    return None


def parse_config_r(text: str) -> list[Param]:
    params, group = [], ""
    for line in text.splitlines():
        h = re.match(r"^## ---- (.+?) -+", line)
        if h:
            group = h.group(1).strip().title()
            continue
        m = _R_ASSIGN.match(line)
        if not m or m.group(1) in _R_SKIP:
            continue
        value, comment = _split_comment(m.group(2))
        lit = _r_literal(value)
        if lit is None:
            continue
        params.append(Param(m.group(1), lit[0], lit[1], comment, group))
    return params


def _r_header(text: str) -> tuple[str, str]:
    """Title and summary from the `## NN_name.R  —  summary` banner."""
    lines = [l[2:].strip() for l in text.splitlines()[1:8] if l.startswith("##") and not l.startswith("## ===")]
    first = lines[0] if lines else ""
    parts = re.split(r"\s+[—-]\s+", first, maxsplit=1)
    rest = [l for l in lines[1:] if not l.startswith("--")]
    summary = parts[1] if len(parts) > 1 else (rest.pop(0) if rest else "")
    if rest:
        summary = (summary + " " + " ".join(rest[:2])).strip()
    summary = re.split(r"\s*(Inputs?\s*:|Outputs?\s*:)", summary)[0].strip()
    return parts[0].removesuffix(".R"), summary


_R_TITLES = {
    "01": "Load", "02": "QC + filter", "03": "Normalise", "04": "PCA", "05": "Differential expression",
    "06": "Volcano · MA · heatmaps", "07": "DG identity", "08": "GO ORA", "09": "GSEA",
    "10": "Targeted signatures", "11": "Integration", "12": "Figures", "13": "Report",
}


# config.py values that are paths or derived, not settings.
_PY_BULK_SKIP = {"PROJ_ROOT", "COUNTS_FILE", "META_FILE", "ANNOT_COLS", "GENESET_CACHE"}


def bulk_workflow() -> Workflow:
    stages = []
    for f in sorted(BULK_DIR.glob("[01][0-9]_*.R")):
        num = f.name[:2]
        if num == "00":
            continue
        r_src = f.read_text().replace("\r\n", "\n")
        _, summary = _r_header(r_src)
        py = BULK_PY / f"{f.stem}.py"
        sources = {"python": py.read_text()} if py.exists() else {}
        sources["R"] = r_src
        stages.append(Stage(f.stem, _R_TITLES.get(num, f.stem), summary, sources.get("python", r_src),
                            sources=sources))
    params = [p for p in parse_config_cell((BULK_PY / "config.py").read_text()) if p.name not in _PY_BULK_SKIP]
    return Workflow(
        id="bulk",
        name="Plethos",
        gloss="πλῆθος, the multitude: every cell in the dentate gyrus, averaged into one profile per animal",
        title="Dentate gyrus · bulk RNA-seq",
        engines=["python", "R"],
        design="DESeq2 · T vs V · Novogene counts",
        stages=stages,
        params=params,
    )


R_PARAM_NAMES = {p.name for p in parse_config_r((BULK_DIR / "config.R").read_text())}


# ------------------------------------------------------------- snRNA / notebook

_PY_SKIP = {"DATA_ROOT", "CELLBENDER_ROOT", "OUTPUT_ROOT", "GROUP"}


def load_notebook() -> dict:
    return json.loads(SNRNA_NB.read_text())


def parse_config_cell(src: str) -> list[Param]:
    tree = ast.parse(src)
    lines = src.splitlines()
    params = []
    for node in tree.body:
        if not (isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name)):
            continue
        name = node.targets[0].id
        if name in _PY_SKIP:
            continue
        try:
            value = ast.literal_eval(node.value)
        except ValueError:
            continue
        kind = {bool: "bool", int: "int", float: "float", str: "str", list: "list"}.get(type(value))
        if kind is None:
            continue
        # comment: inline, else the comment block directly above
        line = lines[node.lineno - 1]
        _, inline = _split_comment(line)
        above, i = [], node.lineno - 2
        while i >= 0 and lines[i].lstrip().startswith("#") and "=====" not in lines[i]:
            above.insert(0, lines[i].lstrip("# ").strip())
            i -= 1
        params.append(Param(name, kind, value, inline or " ".join(above)))
    # group by blank-line separated blocks, labelled by their leading comment
    group = "Design"
    by_line = {}
    for i, l in enumerate(lines):
        s = l.strip()
        if s.startswith("#") and "=====" not in s and (i == 0 or not lines[i - 1].strip()):
            group = s.lstrip("# -").split(":")[0].split(".")[0].strip()[:40]
        by_line[i] = group
    for p, node in zip(params, [n for n in tree.body if isinstance(n, ast.Assign)
                                and isinstance(n.targets[0], ast.Name) and n.targets[0].id in {q.name for q in params}]):
        p.group = by_line.get(node.lineno - 1, "")
    return params


# The notebook is written in Portuguese; the workbench labels it in English and
# keeps the original text in the source view.
_SN_TITLES = {
    "S00": "Environment", "S01": "Manifest + CellBender check", "S02": "Nucleus QC + Scrublet",
    "S03": "HVG · PCA · UMAP · Leiden", "S04": "Markers + broad annotation", "S05": "Composition by animal",
    "S06": "Pseudobulk", "S07": "Animal-level DE (PyDESeq2)", "S08": "GO-BP + preranked GSEA",
    "S09": "Leave-one-animal-out", "S10": "Workbook + report",
}
_SN_SUMMARY = {
    "S00": "Imports, version guard, output folders.",
    "S01": "Find exactly one uniform *_lr5e5_filtered.h5 per sample; hash and record it.",
    "S02": "Fixed floors plus a per-sample 5-MAD ceiling; Scrublet per library; concatenate raw counts.",
    "S03": "seurat_v3 HVGs by sample, technical genes masked from PCA, UMAP, Leiden sweep at two levels.",
    "S04": "Wilcoxon markers, marker-module scores, softmax confidence; low-confidence clusters stay Unannotated.",
    "S05": "Fractions per animal; bootstrap CI and the exact 70-way permutation test.",
    "S06": "Sum raw counts per animal × broad type; eligibility by nuclei and library size.",
    "S07": "PyDESeq2 ~group per eligible type, THC vs VEH, animal as the replicate.",
    "S08": "Enrichr GO-BP on up/down sets and preranked GSEA on the Wald stat (needs internet).",
    "S09": "Refit DE eight times, each time leaving one animal out; sign concordance.",
    "S10": "Excel workbook, run manifest, automatic summary, final h5ad.",
}
_SN_GROUPS = {
    "Coloque aqui os 8 arquivos finais uniformes *_lr5e5_filtered": "Design",
    "Segurança contra mistura da primeira rodada e da rodada learning-rate 5e-5": "Inputs",
    "QC de núcleos": "Nucleus QC", "Representação e clusters": "Representation + clusters",
    "Anotação": "Annotation", "Pseudobulk animal × tipo amplo": "Pseudobulk + DE", "Retomada": "Resume",
}


def snrna_workflow() -> Workflow:
    nb = load_notebook()
    cells = nb["cells"]
    config_src = "".join(cells[1]["source"])
    stages: list[Stage] = []
    current: Stage | None = None
    for i, c in enumerate(cells):
        src = "".join(c["source"])
        if c["cell_type"] == "markdown":
            m = re.match(r"^##\s+(\d+)\.\s+(.+)", src)
            if m:
                current = Stage(f"S{int(m.group(1)):02d}", m.group(2).strip(), "", "")
                stages.append(current)
            elif current is not None and src.startswith("## "):
                current = None   # closing notes ("Ordem de revisão…")
            continue
        if current is not None:
            current.cells.append(i)
            current.source += ("\n\n" if current.source else "") + src
    for s in stages:
        s.title = _SN_TITLES.get(s.id, s.title)
        s.summary = _SN_SUMMARY.get(s.id, "")
    params = parse_config_cell(config_src)
    for p in params:
        p.group = next((v for k, v in _SN_GROUPS.items() if p.group.startswith(k[:30])), p.group)
    # not the notebook's: the workbench's, applied in a cell after the environment cell
    params.append(Param("FIG_THEME", "str", "dark",
                        '"dark" = the workbench ground; "paper" = the notebook\'s own white figures', "Workbench"))
    return Workflow(
        id="snrna",
        name="Karyon",
        gloss="κάρυον, the kernel, the nucleus: one profile per nucleus, eight animals",
        title="Hippocampus · snRNA-seq",
        engines=["notebook"],
        design="scanpy · 4 VEH vs 4 THC · CellBender lr5e5",
        stages=stages,
        params=params,
    )


def all_workflows() -> dict[str, Workflow]:
    return {"bulk": bulk_workflow(), "snrna": snrna_workflow()}


# ----------------------------------------------------------------- literals

def to_r(kind: str, v) -> str:
    if kind == "bool":
        return "TRUE" if v else "FALSE"
    if kind in ("int", "float"):
        return repr(float(v) if kind == "float" else int(v))
    if kind == "str":
        return '"' + str(v).replace("\\", "\\\\").replace('"', '\\"') + '"'
    if kind == "list":
        return "character(0)" if not v else "c(" + ", ".join(to_r("str", x) for x in v) + ")"
    raise ValueError(kind)


def coerce(p: Param, v):
    """Validate a user value against the parameter's type. Raises ValueError."""
    if p.type == "bool":
        if not isinstance(v, bool):
            raise ValueError(f"{p.name}: expected true/false")
        return v
    if p.type == "int":
        if isinstance(v, bool) or not float(v).is_integer():
            raise ValueError(f"{p.name}: expected an integer")
        return int(v)
    if p.type == "float":
        return float(v)
    if p.type == "str":
        return str(v)
    if p.type == "list":
        if not isinstance(v, list):
            raise ValueError(f"{p.name}: expected a list")
        inner = type(p.default[0]) if p.default else str
        return [inner(x) for x in v]
    raise ValueError(p.name)
