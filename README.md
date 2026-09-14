# 303 Superheroes

Our group site for **02805 Social Graphs and Interactions** at DTU, autumn 2026.

Wikipedia's *Category: Marvel Comics superheroes* holds 303 characters. Whenever
one character's article links to another's, that's an edge — 1,784 of them, all
pointing one way. That network is the shared playground for the whole course, and
this repo is where we take it apart, one post per week.

**The site:** <https://mfiqulch.github.io>

| | | |
|---|---|---|
| **Week 1** | Networks — degrees, distributions, components | [post](https://mfiqulch.github.io/weeks/week1/week1.html) · [notebook](notebooks/week1_marvel_network.ipynb) |
| **Week 2** | Models and null models — auditing week 1 | [post](https://mfiqulch.github.io/weeks/week2/week2.html) · [notebook](notebooks/week2_null_models.ipynb) |

## How this fits together

Every figure on every page is written by the notebook for that week. Nothing is
drawn or touched by hand, and re-running a notebook overwrites the SVGs in place.
So if a number in a post ever disagrees with its notebook, the notebook is right
and the post needs fixing.

```
├── index.html              front page
├── weeks/
│   └── weekN/
│       ├── weekN.html      the post
│       └── figures/        SVGs, all written by the notebook
├── notebooks/              one per week — the actual analysis
├── src/marvel.py           shared helpers: loading, palette, binning, nulls
├── data/
│   ├── week1_*.tsv         the frozen course snapshot — never edited
│   └── derived/            cached null-model replicates (see below)
└── assets/
    ├── css/site.css        one stylesheet for every post
    └── js/flip.js          the flip-card panels in week 1
```

## Running the notebooks

```bash
pip install -r requirements.txt
jupyter notebook
```

Open anything in `notebooks/` and run it top to bottom. The paths in
`src/marvel.py` resolve relative to the repo, so it works from any working
directory — but keep the notebooks where they are.

**On `data/derived/`.** Week 2 builds 600 null networks, which takes several
minutes and makes for a notebook nobody re-runs. Those replicates are cached as
JSON-lines and committed, so the notebook renders in seconds and the numbers in
the post stay pinned to something reproducible. To recompute from scratch, delete
the files or pass `force=True` to `marvel.cached`.

`data/*.tsv` is the real input and is never modified. Anything in `data/derived/`
is output, and if it ever goes stale relative to the code, delete it and re-run
rather than trusting it.

## Data and attribution

The network is the course's frozen week-1 snapshot, taken from the English
Wikipedia on 26 August 2026. Edges come from links in the running text of each
article rather than from Wikipedia's link index, so navigation-box links are
excluded; redirects are resolved at both ends. Different choices there would
produce a genuinely different network.

Article text and titles from Wikipedia, licensed
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

Course materials: [socialgraphs2026](https://sunelehmann.com/socialgraphs2026-web/).
