# Resources

Two levels of folder, and nothing else to learn.

```
10-resources/
  1-repositories/            <- a branch. Its own heading on the page.
    group.txt                   the branch's title and one-line description
    1.1-lab-website/         <- an item. Its own page.
      item.txt                  what it is, what it needs, how to run it
  2-code-blocks/             <- the other branch
    group.txt
    2.1-volcano-plot/
      item.txt
      volcano_plot.R         <- any file here becomes a download
```

**Add a folder, get a page.** Drop `1-repositories/1.3-coco-repo/` in with an
`item.txt` and it appears under Repositories with a page of its own. Nothing
else anywhere needs updating.

## Numbering

`1.1-`, `1.2-`, `2.1-` — the first number is the branch, the second is the
position inside it. Plain `01-`, `02-` works exactly the same; the dotted form
just reads better when you are looking at the folder tree on GitHub. Anything
with no number sorts to the end.

The part after the number becomes the address, so `1.3-coco-repo/` is published
at `resources/repositories/coco-repo/`.

## A third branch

Make a folder. `3-datasets/` with a `group.txt` in it becomes a third heading on
the page, in that order. Nothing in the code names the two that already exist.

## What goes in `item.txt`

```text
title: Bulk RNA-seq pipeline
repo: kbh-lab-rgcb/rnaseq-pipeline
language: Snakemake · Python 3.11
summary: One line for the card, before anyone opens the page.

A paragraph or two on what it does and why it exists.

## Requirements

R — 4.2 or newer
ggplot2 — the plot itself

## How to run it

Whatever someone needs to type, in the order they need to type it.
```

Everything is optional except the folder itself. **A line you leave out draws
nothing** — no empty heading, no "coming soon".

| Line | What it does |
| --- | --- |
| `title:` | The heading. Left out, the folder name is used. |
| `summary:` | The line on the card. Left out, the first sentence is used. |
| `repo:` | The repository button. `owner/name` or a full address. |
| `language:` | Shown under the title — `R`, `Python 3.11`, whatever fits. |
| `doi:` `paper:` `docs:` `colab:` `binder:` `zenodo:` `demo:` `url:` | One button each. |

A `## Heading` starts a section on the page. Lines of the form `thing — what it
is` become a two-column list; anything else stays as prose.

## Files and downloads

**Every file in the item's folder becomes a download**, under its own name, with
its size beside it. `item.txt` and `README.md` are the two exceptions — those
describe the item rather than being part of it.

Subfolders are kept, so a whole repository dropped inside a code block still
makes sense: `scripts/qc.R` is listed as `scripts/qc.R` and downloads as that.

Scripts and notebooks are also **shown on the page**, so somebody can read the
code before deciding to download it, with a button to copy it. A Jupyter
notebook shows the source of its cells rather than the JSON around them. Files
over about 60 KB, and anything that is not text, are download-only.

## A repository *and* files

Nothing stops an item having both. A code block that also lives in a repository
should say so with `repo:` — the button appears alongside the downloads, and the
reader can take whichever they need.

## Removing something

Delete the folder.
