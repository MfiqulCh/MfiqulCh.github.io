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


# --------------------------------------------------------------------------
# null models (week 2)
# --------------------------------------------------------------------------
DERIVED = DATA / "derived"


def cached(name: str, compute, force: bool = False):
    """
    Run `compute()` and cache the result as JSON-lines under data/derived/.

    The week 2 null models take several minutes for 300 replicates, which makes
    a notebook nobody re-runs. Caching the replicates means the notebook renders
    in seconds and the numbers in the post stay reproducible — delete the file
    (or pass force=True) to recompute from scratch.
    """
    import json
    DERIVED.mkdir(parents=True, exist_ok=True)
    path = DERIVED / f"{name}.jsonl"
    if path.exists() and not force:
        rows = [json.loads(line) for line in open(path)]
        print(f"loaded {len(rows)} cached replicates from {path.relative_to(ROOT)}")
        return rows
    rows = compute()
    with open(path, "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    print(f"computed and cached {len(rows)} replicates -> {path.relative_to(ROOT)}")
    return rows


def directed_swap(G, nswap, seed):
    """
    Directed double-edge swap: A->B and C->D become A->D and C->B.

    NetworkX's double_edge_swap is undirected only, so reciprocity — which is a
    directed question — needs this. Every swap leaves all four nodes with the
    same in-degree AND the same out-degree, so the null knows the full directed
    degree sequence and nothing else.
    """
    rng = np.random.default_rng(seed)
    idx = {v: i for i, v in enumerate(G.nodes())}
    E = np.array([[idx[a], idx[b]] for a, b in G.edges()], dtype=np.int32)
    present = set(map(tuple, E.tolist()))
    m = len(E)
    done = 0
    while done < nswap:
        I, J = rng.integers(0, m, 8192), rng.integers(0, m, 8192)
        for i, j in zip(I, J):
            if i == j:
                continue
            a, b = E[i]
            c, d = E[j]
            if a == d or c == b or a == c or b == d:
                continue
            if (a, d) in present or (c, b) in present:
                continue
            present.discard((a, b))
            present.discard((c, d))
            present.add((a, d))
            present.add((c, b))
            E[i] = (a, d)
            E[j] = (c, b)
            done += 1
            if done >= nswap:
                break
    return E


def rewired(G, seed: int, per_edge: int = 10):
    """
    An undirected degree-preserving null: a copy of G with its edges shuffled by
    double-edge swaps (A-B and C-D become A-D and C-B).

    Every swap leaves all four endpoints with exactly the same degree, so the
    result has G's degree sequence and nothing else of G's structure. That is
    the null to compare against when a statistic could be a side effect of the
    degree sequence alone — clustering and assortativity both can be.

    `per_edge` swaps per edge; 10 is comfortably past the point where the
    statistics stop drifting. Swaps never create a multi-edge or a self-loop,
    so the result is still simple, and it may come apart into more components
    than G had — which does not matter for a statistic that is not about
    connectivity.
    """
    R = (G.to_undirected() if G.is_directed() else G).copy()
    nx.double_edge_swap(R, nswap=per_edge * R.number_of_edges(),
                        max_tries=10 ** 7, seed=seed)
    return R


def reciprocity_of(E) -> float:
    """Fraction of arrows whose reverse also exists, from an (m,2) edge array."""
    s = set(map(tuple, E.tolist()))
    return sum(1 for a, b in s if (b, a) in s) / len(s)


def zscore(real: float, null_values) -> float:
    a = np.asarray(null_values, dtype=float)
    sd = a.std()
    return float("nan") if sd < 1e-12 else (real - a.mean()) / sd


# --------------------------------------------------------------------------
# the philosopher network (week 4)
# --------------------------------------------------------------------------
def load_philosophers_nodes() -> pd.DataFrame:
    """1,444 philosophers born before 1900, with era and subfield labels."""
    return pd.read_csv(DATA / "week4_philosophers_nodes.tsv", sep="\t",
                       comment="#", quoting=3)


def load_philosophers(weighted: bool = True) -> nx.Graph:
    """
    The undirected philosopher network, weights summed over both directions.

    The edge file is directed and carries a weight (how many times A's article
    links to B's). The course works with the undirected version, so an A->B of
    3 and a B->A of 2 become one link of weight 5. Self-loops are dropped.

    Nodes are added before the edges, same as the Marvel loader: some
    philosophers appear in neither column and would vanish silently otherwise.
    """
    nodes = load_philosophers_nodes()
    edges = pd.read_csv(DATA / "week4_philosophers_edges.tsv", sep="\t",
                        comment="#", quoting=3)

    G = nx.Graph()
    G.add_nodes_from(nodes.node_id)
    for s, t, w in edges.itertuples(index=False):
        if s == t:
            continue
        if G.has_edge(s, t):
            G[s][t]["weight"] += w
        else:
            G.add_edge(s, t, weight=w)

    if not weighted:
        nx.set_edge_attributes(G, 1, "weight")

    nx.set_node_attributes(G, dict(zip(nodes.node_id, nodes.name)), "name")
    nx.set_node_attributes(G, dict(zip(nodes.node_id, nodes.era)), "era")
    nx.set_node_attributes(G, dict(zip(nodes.node_id, nodes.subfields.fillna("none"))),
                           "subfields")
    return G


def disparity_filter(G, alpha: float):
    """
    Serrano, Boguna & Vespignani (2009). Per-node null: node i's strength is
    spread uniformly at random over its k_i links, so the chance one link gets
    a share of at least p_ij = w_ij/s_i is (1 - p_ij)^(k_i - 1). Keep a link if
    it is significant at EITHER end — that is what stops the backbone from
    becoming the hubs talking to each other.

    Returns the filtered graph (isolated nodes dropped).
    """
    strength = dict(G.degree(weight="weight"))
    degree = dict(G.degree())

    def p_value(v, w):
        k = degree[v]
        return 1.0 if k < 2 else (1 - w / strength[v]) ** (k - 1)

    H = nx.Graph()
    for a, b, d in G.edges(data=True):
        w = d["weight"]
        if min(p_value(a, w), p_value(b, w)) < alpha:
            H.add_edge(a, b, weight=w)
    return H


def infomap_communities(G, weighted: bool = False, seed: int = 1, trials: int = 10):
    """
    Infomap (Rosvall & Bergstrom 2008): communities as compression. Returns a
    dict node -> module id. Requires `pip install infomap`.
    """
    import infomap as _ifm
    im = _ifm.Infomap(silent=True, num_trials=trials, seed=seed, two_level=True)
    idx = {v: i for i, v in enumerate(G.nodes())}
    for a, b, d in G.edges(data=True):
        im.add_link(idx[a], idx[b], float(d["weight"]) if weighted else 1.0)
    im.run()
    back = {i: v for v, i in idx.items()}
    return {back[nd.node_id]: nd.module_id for nd in im.tree if nd.is_leaf}


# --------------------------------------------------------------------------
# the Marvel pages as text (week 5)
# --------------------------------------------------------------------------
def load_pages() -> dict:
    """
    The 303 plain-text Wikipedia articles, keyed by node_id.

    Filenames are URL-encoded node ids (a few titles contain characters a
    filesystem refuses, e.g. Mark_Hazzard%3A_Merc), so the stem is unquoted to
    join straight onto the network.
    """
    import zipfile
    import urllib.parse
    pages = {}
    with zipfile.ZipFile(DATA / "marvel_pages.zip") as z:
        for f in z.namelist():
            if f.endswith(".txt") and not f.endswith("README.txt"):
                nid = urllib.parse.unquote(f.split("/", 1)[1][:-4])
                pages[nid] = z.read(f).decode("utf-8")
    return pages


_ABBR = ["No", "Vol", "Dr", "Mr", "Mrs", "Ms", "St", "vs", "Jr", "Sr", "Prof", "Gen", "Capt",
         "Lt", "Sgt", "Col", "Mt", "Inc", "Ltd", "Co", "ca", "c", "e.g", "i.e", "etc", "Jan",
         "Feb", "Mar", "Apr", "Aug", "Sept", "Sep", "Oct", "Nov", "Dec"]


def split_sentences(text: str) -> list:
    """
    A deliberately simple, rule-based sentence splitter.

    Paragraphs first (Wikipedia plain text puts headings and paragraphs on their
    own lines), then split after . ! ? when the next character starts a
    sentence. Abbreviations ("No. 1", "Vol. 2") and initials ("U.S.A.") are
    protected first. It is a stated preprocessing choice, not a model: no
    downloaded data, identical on every machine, and wrong in ways you can see.
    """
    import re
    abbr = re.compile(r"\b(" + "|".join(re.escape(a) for a in _ABBR) + r")\.")
    initials = re.compile(r"\b((?:[A-Z]\.){1,4})")
    out = []
    for para in re.split(r"\n+", text):
        para = para.strip()
        if not para:
            continue
        p = abbr.sub(lambda m: m.group(1) + "<DOT>", para)
        p = initials.sub(lambda m: m.group(1).replace(".", "<DOT>"), p)
        for s in re.split(r"(?<=[.!?])\s+(?=[\"“(A-Z0-9])", p):
            s = s.replace("<DOT>", ".").strip()
            if s:
                out.append(s)
    return out


def wilson(k: int, n: int, z: float = 1.96):
    """Wilson score interval for a proportion k/n — honest error bars on small samples."""
    if n == 0:
        return (float("nan"), float("nan"))
    p = k / n
    den = 1 + z * z / n
    mid = (p + z * z / (2 * n)) / den
    half = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (mid - half, mid + half)
