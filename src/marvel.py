"""
Shared helpers for the 303 Superheroes site (02805 Social Graphs and Interactions).

Everything the weekly notebooks have in common lives here: loading the frozen
week-1 snapshot, the site colour palette, the log-binning scheme from week 1,
and a saver that writes SVGs straight into the right week's figures folder.

Usage from a notebook in notebooks/:

    import sys; sys.path.append("../src")
    import marvel
    G = marvel.load_graph()
"""

from pathlib import Path
from collections import Counter

import numpy as np
import pandas as pd
import networkx as nx
import matplotlib.pyplot as plt

# --------------------------------------------------------------------------
# paths — resolved relative to this file so notebooks work from any cwd
# --------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def figures_dir(week: int) -> Path:
    d = ROOT / "weeks" / f"week{week}" / "figures"
    d.mkdir(parents=True, exist_ok=True)
    return d


# --------------------------------------------------------------------------
# the site's visual language, so every figure matches the pages
# --------------------------------------------------------------------------
INK = "#16224C"
RED = "#D22B2B"
MUTED = "#8992A3"
RULE = "#C6CBC8"
CARD = "#F8F9F7"


def use_site_style():
    """Match matplotlib output to the site's palette and typography."""
    plt.rcParams.update({
        "font.family": "DejaVu Sans",
        "font.size": 11,
        "axes.edgecolor": INK,
        "axes.labelcolor": INK,
        "text.color": INK,
        "xtick.color": INK,
        "ytick.color": INK,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "savefig.transparent": True,
        "figure.dpi": 110,
    })


def save(fig, week: int, name: str):
    """Write an SVG into weeks/week<N>/figures/ and report where it went."""
    path = figures_dir(week) / f"{name}.svg"
    fig.savefig(path, bbox_inches="tight")
    print(f"wrote {path.relative_to(ROOT)}")
    return path


# --------------------------------------------------------------------------
# data
# --------------------------------------------------------------------------
def load_nodes() -> pd.DataFrame:
    """The 303-character roster. `quoting=3` keeps apostrophes in blurbs intact."""
    return pd.read_csv(DATA / "week1_nodes.tsv", sep="\t", comment="#", quoting=3)


def load_graph(directed: bool = True) -> nx.Graph:
    """
    Build the Marvel link network.

    The nodes are added BEFORE the edges on purpose. 17 characters appear in
    neither column of the edge list, so building from edges alone silently
    gives 286 nodes instead of 303 — no error, just a quietly wrong network.
    """
    nodes = load_nodes()
    edges = pd.read_csv(DATA / "week1_edges.tsv", sep="\t", comment="#",
                        names=["source", "target"])

    G = nx.DiGraph()
    G.add_nodes_from(nodes.node_id)                     # all 303 first
    G.add_edges_from(edges.itertuples(index=False))

    nx.set_node_attributes(G, dict(zip(nodes.node_id, nodes.name)), "name")
    nx.set_node_attributes(G, dict(zip(nodes.node_id, nodes.description)), "blurb")
    return G if directed else G.to_undirected()


def giant_component(G) -> nx.Graph:
    """The 277-character undirected giant component."""
    U = G.to_undirected() if G.is_directed() else G
    return U.subgraph(max(nx.connected_components(U), key=len)).copy()


def names(G) -> dict:
    return nx.get_node_attributes(G, "name")


# --------------------------------------------------------------------------
# degree distributions
# --------------------------------------------------------------------------
def distribution(degrees: dict):
    """Raw P(k): the fraction of nodes holding each observed degree."""
    n = len(degrees)
    counts = Counter(degrees.values())
    ks = np.array(sorted(counts))
    return ks, np.array([counts[k] for k in ks]) / n


def log_binned(degrees: dict, edges=None):
    """
    Week 1's binning scheme, on the shifted variable u = k + 1.

    Width-1 bins up to u = 7, then doubling: [8,16), [16,32), [32,64), [64,128).
    Each bin's count is divided by its OWN WIDTH, so a wide bin is not popular
    merely for being wide, and is plotted at the geometric mean of the integers
    it covers — the arithmetic middle would sit visibly right of centre on a
    log axis.

    Correctness check: where the bins are width 1 the result must land exactly
    on the raw P(k). See `check_binning` below.
    """
    n = len(degrees)
    u = np.array([v + 1 for v in degrees.values()])
    if edges is None:
        edges = list(range(1, 9)) + [16, 32, 64, 128, 256]

    xs, ys = [], []
    for lo, hi in zip(edges[:-1], edges[1:]):
        count = int(np.sum((u >= lo) & (u < hi)))
        if count == 0:
            continue
        width = hi - lo
        xs.append(float(np.exp(np.mean(np.log(np.arange(lo, hi))))))
        ys.append(count / n / width)
    return np.array(xs), np.array(ys)


def check_binning(degrees: dict, tol: float = 1e-12) -> bool:
    """Assert the width-1 bins reproduce the raw values exactly."""
    ks, ps = distribution(degrees)
    raw = dict(zip(ks + 1, ps))
    bx, by = log_binned(degrees)
    ok = True
    for x, y in zip(bx, by):
        u = round(x)
        if u <= 7:
            diff = abs(y - raw.get(u, 0.0))
            status = "OK" if diff < tol else "MISMATCH"
            if diff >= tol:
                ok = False
            print(f"  u={u:<3d} binned={y:.6f}  raw={raw.get(u, 0.0):.6f}  {status}")
    return ok
