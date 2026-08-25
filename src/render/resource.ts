/**
 * One repository or code block's own page:
 * `resources/code-blocks/deseq2-workflow/index.html`.
 *
 * The same bargain as a person's profile page — everything on it was written
 * by whoever added the folder, and anything they left out draws nothing at
 * all. What is different is the payload: a reader has come here to get a file
 * and to find out whether it does what they need, so the download and the code
 * itself are the page, and the prose is what frames them.
 */

import { esc, join } from "../html.ts";
import type { Download, Page, ProfileSection, ResourceGroup, ResourceItem } from "../content/types.ts";
import { cvList, linkList, reveal } from "./components.ts";
import { formatBytes } from "../content/files.ts";
import { excerpt } from "../content/text.ts";
import { icons } from "./icons.ts";
import { hrefTo, rel } from "./url.ts";

/**
 * Language label for a file, used for the preview's caption.
 *
 * Not syntax highlighting: a highlighter is a dependency, a colour scheme to
 * maintain in two themes, and a licence — for code that is being read once
 * before being downloaded and opened in a real editor.
 */
const LANGUAGES: Record<string, string> = {
  r: "R",
  rmd: "R Markdown",
  qmd: "Quarto",
  py: "Python",
  ipynb: "Jupyter notebook",
  sh: "Shell",
  bash: "Shell",
  jl: "Julia",
  sql: "SQL",
  pl: "Perl",
  m: "MATLAB",
  do: "Stata",
  nf: "Nextflow",
  smk: "Snakemake",
  cpp: "C++",
  c: "C",
  java: "Java",
  go: "Go",
  rs: "Rust",
  js: "JavaScript",
  ts: "TypeScript",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  csv: "CSV",
  tsv: "TSV",
  md: "Markdown",
  txt: "Text",
};

function languageOf(file: Download): string {
  return LANGUAGES[file.ext] ?? file.ext.toUpperCase();
}

/**
 * One download.
 *
 * `download` on the anchor asks the browser to save rather than navigate,
 * which matters most for the files it would otherwise render in a tab — a
 * `.txt` of parameters, an `.html` report.
 */
function downloadRow(file: Download, depth: number): string {
  return join([
    '<li class="download">',
    `<span class="download__icon" aria-hidden="true">${icons.document}</span>`,
    '<span class="download__text">',
    `<span class="download__name">${esc(file.name)}</span>`,
    `<span class="download__meta">${esc(languageOf(file))} · ${esc(formatBytes(file.bytes))}</span>`,
    "</span>",
    `<a class="button button--small download__action" href="${esc(rel(depth, file.src))}" download>`,
    `${icons.download}<span>Download</span></a>`,
    "</li>",
  ]);
}

/** Every file in the folder, as a list with a download button each. */
function downloadList(item: ResourceItem, depth: number): string {
  if (item.downloads.length === 0) return "";
  const total = item.downloads.reduce((sum, file) => sum + file.bytes, 0);

  return join([
    `<section class="profile-section"${reveal()}>`,
    '<h2 class="profile-section__title">Files',
    `<span class="profile-section__count">${item.downloads.length}</span></h2>`,
    `<ul class="download-list">${item.downloads.map((file) => downloadRow(file, depth)).join("")}</ul>`,
    `<p class="download-list__total">${esc(formatBytes(total))} in total.</p>`,
    "</section>",
  ]);
}

/**
 * The code itself, for the files that are worth reading on the page.
 *
 * Shown after the explanation and the download, in that order, because
 * somebody who already trusts the description should not have to scroll a
 * three-hundred-line script to reach the button.
 */
function previewList(item: ResourceItem): string {
  const previewable = item.downloads.filter((file) => file.preview.trim());
  if (previewable.length === 0) return "";

  return join(
    previewable.map((file, index) =>
      join([
        `<section class="profile-section"${reveal(index)}>`,
        '<div class="code-block">',
        '<div class="code-block__head">',
        `<span class="code-block__name">${esc(file.name)}</span>`,
        `<span class="code-block__lang">${esc(languageOf(file))}</span>`,
        `<button class="code-block__copy" type="button" data-copy aria-label="Copy ${esc(file.name)}">`,
        `<span class="code-block__copy-idle">${icons.copy}<span>Copy</span></span>`,
        `<span class="code-block__copy-done">${icons.check}<span>Copied</span></span>`,
        "</button>",
        "</div>",
        `<pre class="code-block__body"><code>${esc(file.preview.trimEnd())}</code></pre>`,
        "</div>",
        "</section>",
      ]),
    ),
  );
}

function itemSection(section: ProfileSection, index: number): string {
  return join([
    `<section class="profile-section"${reveal(index)}>`,
    `<h2 class="profile-section__title">${esc(section.title)}</h2>`,
    section.entries.length > 0
      ? cvList(section.entries)
      : `<div class="prose">${section.html}</div>`,
    "</section>",
  ]);
}

export function renderResourceBody(
  parent: Page,
  group: ResourceGroup,
  item: ResourceItem,
  depth: number,
): string {
  return join([
    '<section class="section"><div class="container container-narrow">',

    `<p class="profile__back"><a href="${esc(hrefTo(depth, parent))}#${esc(group.slug)}">${icons.chevronLeft}<span>Back to ${esc(group.title)}</span></a></p>`,

    `<div class="resource__head"${reveal()}>`,
    item.summary ? `<p class="profile__focus">${esc(item.summary)}</p>` : "",
    item.language ? `<p class="resource__language">${esc(item.language)}</p>` : "",
    item.repo
      ? join([
          '<p class="button-row">',
          `<a class="button" href="${esc(item.repo.url)}" target="_blank" rel="noopener noreferrer">`,
          `${icons.repo}<span>${esc(item.repo.label)}</span></a>`,
          "</p>",
        ])
      : "",
    linkList(item.links),
    "</div>",

    item.html ? `<div class="prose profile__bio"${reveal()}>${item.html}</div>` : "",

    item.sections.map((section, index) => itemSection(section, index)).join(""),

    downloadList(item, depth),
    previewList(item),

    "</div></section>",
  ]);
}

/** Meta description: what the editor wrote about it, where they wrote any. */
export function resourceDescription(item: ResourceItem): string {
  return item.summary || excerpt(item.text, 200) || item.title;
}

/**
 * The `Page` the shell is rendered against.
 *
 * Like a profile, an item borrows the Resources page's identity — its banner,
 * its highlighted nav link — and replaces only the title, the line under it
 * and where the file is written.
 */
export function resourceShell(parent: Page, group: ResourceGroup, item: ResourceItem): Page {
  return {
    ...parent,
    title: item.title,
    tagline: group.title,
    introHtml: "",
    outDir: item.path.replace(/\/+$/, ""),
  };
}
