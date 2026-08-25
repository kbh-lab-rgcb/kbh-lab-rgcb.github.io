/**
 * Parsing for the plain-text format lab members write.
 *
 *     key: value
 *     key: value
 *     <blank line>
 *     Body text, markdown allowed.
 *
 * Every function here is total: bad input produces a reasonable value rather
 * than an exception, because the person who typed it is editing in a browser
 * and will not see a stack trace.
 */

import { marked } from "marked";
import { esc } from "../html.ts";
import type { ProfileEntry, ProfileLink, ProfileSection, Publication } from "./types.ts";

marked.setOptions({ gfm: true, breaks: false });

export type Doc = {
  fields: Record<string, string>;
  body: string;
};

/**
 * Keys recognised even when written *below* the body rather than in the header.
 *
 * People add a profile link months after writing their biography, and the
 * natural move is to type it at the bottom of the file. Rejecting that would
 * mean the link silently never appears and the raw `orcid: …` shows up as prose
 * — two failures at once. So these specific keys are lifted out wherever they
 * sit on a line of their own.
 *
 * Kept deliberately narrow: only unambiguous keys, never prose-like ones such
 * as `title` or `thesis`.
 */
const LIFTABLE_KEYS = new Set([
  "orcid",
  "scholar",
  "researchgate",
  "linkedin",
  "pubmed",
  "github",
  "twitter",
  "x",
  "website",
  "email",
  "url",
  "featured",
]);

/**
 * Split a file into its `key: value` header and its body.
 *
 * The header ends at the first blank line. A file with no header at all is
 * treated as pure body, so someone can drop in a paragraph and have it work.
 */
export function parseDoc(raw: string): Doc {
  const normalized = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return { fields: {}, body: "" };

  const lines = normalized.split("\n");
  const fields: Record<string, string> = {};
  let index = 0;
  let lastKey = "";

  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      break;
    }
    const match = /^([A-Za-z][A-Za-z0-9 _-]{0,40}?)\s*:\s*(.*)$/.exec(line);
    if (!match) {
      /*
       * An indented line carries on the key above it. Some of these values are
       * whole sentences, and an editor whose window is narrower than the
       * sentence will wrap it — losing half a summary into the body, where it
       * would print as a stray paragraph, is a baffling way to be punished for
       * pressing Enter.
       */
      if (lastKey && /^\s+\S/.test(line)) {
        fields[lastKey] = `${fields[lastKey] ?? ""} ${line.trim()}`.trim();
        continue;
      }
      // Otherwise the header is over and this line is body. Bare prose files
      // therefore need no header at all.
      break;
    }
    lastKey = match[1]!.trim().toLowerCase().replace(/[\s_]+/g, "");
    fields[lastKey] = (match[2] ?? "").trim();
  }

  // Pull any liftable keys back out of the body, and drop those lines from it
  // so the raw `orcid: …` never renders as prose.
  const kept: string[] = [];
  for (const line of lines.slice(index)) {
    const match = /^([A-Za-z][A-Za-z0-9 _-]{0,20}?)\s*:\s*(\S.*)$/.exec(line.trim());
    const key = match ? match[1]!.trim().toLowerCase().replace(/[\s_]+/g, "") : "";
    if (match && LIFTABLE_KEYS.has(key) && !fields[key]) {
      fields[key] = match[2]!.trim();
    } else {
      kept.push(line);
    }
  }

  return { fields, body: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}

/** Read a field, treating missing and empty-but-present as the same thing. */
export function field(fields: Record<string, string>, ...names: string[]): string {
  for (const name of names) {
    const value = fields[name.toLowerCase().replace(/[\s_]+/g, "")];
    if (value && value.trim()) return value.trim();
  }
  return "";
}

/** True only for explicit affirmatives, so a stray value never enables a flag. */
export function flag(value: string): boolean {
  return /^(yes|y|true|on|1)$/i.test(value.trim());
}

/**
 * Strip a `NN-` ordering prefix from a filename.
 *
 * `03-arun-v.jpg` -> order 3, slug `arun-v`. Files without a prefix sort after
 * prefixed ones, alphabetically.
 *
 * A dotted prefix is read as one number, so `2.1-deseq2` is item 1 of branch 2
 * and sorts before `2.2-...`. That form exists because a nested folder tree
 * reads much better on GitHub when the children carry their parent's number,
 * and someone who writes `01-` instead gets the same result.
 */
export function parseName(filename: string): { order: number; slug: string } {
  // Only a real extension is stripped, not everything after the last dot —
  // `2.1-deseq2` is a folder whose name contains a dot, not a file called `2`.
  const base = filename.replace(/\.[A-Za-z0-9]{1,8}$/, "");
  const match = /^(\d{1,4}(?:\.\d{1,4})?)[-_\s]+(.*)$/.exec(base) ??
    /^(\d{1,4})[-_.\s]+(.*)$/.exec(base);
  if (match && match[2]) {
    return { order: Number(match[1]), slug: slugify(match[2]) };
  }
  return { order: Number.POSITIVE_INFINITY, slug: slugify(base) };
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `sphingolipid-signalling` -> `Sphingolipid signalling`. */
export function titleFromSlug(slug: string): string {
  const words = slug.replace(/-/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

/** `Dr. K.B. Harikumar` -> `KH`. Used for the fallback avatar. */
export function initialsOf(name: string): string {
  const words = name
    .replace(/\b(dr|prof|mr|ms|mrs|shri|smt)\.?\s+/gi, "")
    .split(/[\s.]+/)
    .filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? words[words.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}

/** Markdown -> HTML for section and biography bodies. */
export function renderMarkdown(body: string): string {
  if (!body.trim()) return "";
  return marked.parse(body, { async: false }).trim();
}

/** Body text with markdown syntax removed, for meta tags and excerpts. */
export function plainText(body: string): string {
  return body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cut text to a whole word at or under `limit` characters. */
export function excerpt(text: string, limit: number): string {
  const clean = plainText(text);
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.]$/, "")}…`;
}

/* ------------------------------------------------------------------ *
 * Profile links
 * ------------------------------------------------------------------ */

type LinkSpec = {
  label: string;
  /** Turn a bare identifier into a full URL. */
  fromId: (id: string) => string;
  /** Reject bare ids that are obviously not ids for this service. */
  validId?: RegExp;
};

/**
 * Supported profile keys. A key absent from a member's file produces no markup
 * at all — that is the whole contract, so this table is the only place a new
 * service needs adding.
 */
const LINK_SPECS: Record<string, LinkSpec> = {
  orcid: {
    label: "ORCID",
    fromId: (id) => `https://orcid.org/${id}`,
    validId: /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i,
  },
  scholar: {
    label: "Google Scholar",
    fromId: (id) => `https://scholar.google.com/citations?user=${encodeURIComponent(id)}`,
  },
  researchgate: {
    label: "ResearchGate",
    fromId: (id) => `https://www.researchgate.net/profile/${encodeURIComponent(id)}`,
  },
  linkedin: {
    label: "LinkedIn",
    fromId: (id) => `https://www.linkedin.com/in/${encodeURIComponent(id)}`,
  },
  pubmed: {
    label: "PubMed",
    fromId: (id) =>
      /^\d+$/.test(id)
        ? `https://pubmed.ncbi.nlm.nih.gov/${id}/`
        : `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(id)}`,
  },
  github: {
    label: "GitHub",
    fromId: (id) => `https://github.com/${encodeURIComponent(id)}`,
  },
  twitter: {
    label: "X",
    fromId: (id) => `https://x.com/${encodeURIComponent(id.replace(/^@/, ""))}`,
  },
  website: {
    label: "Website",
    fromId: (id) => `https://${id}`,
  },
};

/** Order links are displayed in, regardless of the order they were written. */
const LINK_ORDER = [
  "orcid",
  "scholar",
  "pubmed",
  "researchgate",
  "website",
  "github",
  "linkedin",
  "twitter",
];

function normalizeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^www\./i.test(trimmed)
      ? `https://${trimmed}`
      : null;
  if (!withScheme) return null;
  try {
    return new URL(withScheme).href;
  } catch {
    return null;
  }
}

/**
 * Build the profile links a member actually supplied.
 *
 * Accepts either a full URL or a bare identifier for every service, because an
 * editor should not have to know which form is expected.
 */
export function profileLinks(fields: Record<string, string>): ProfileLink[] {
  const found: ProfileLink[] = [];

  for (const [kind, spec] of Object.entries(LINK_SPECS)) {
    const raw = field(fields, kind, kind === "twitter" ? "x" : kind);
    if (!raw) continue;

    const asUrl = normalizeUrl(raw);
    if (asUrl) {
      found.push({ kind, label: spec.label, url: asUrl });
      continue;
    }

    const id = raw.replace(/^@/, "").replace(/\/+$/, "");
    if (spec.validId && !spec.validId.test(id)) continue;
    found.push({ kind, label: spec.label, url: spec.fromId(id) });
  }

  return found.sort((a, b) => {
    const ai = LINK_ORDER.indexOf(a.kind);
    const bi = LINK_ORDER.indexOf(b.kind);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
}

/* ------------------------------------------------------------------ *
 * Publications
 * ------------------------------------------------------------------ */

const DOI_URL = /https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/\S+)/gi;
const DOI_KEY = /\bdoi\s*[:=]\s*(10\.\d{4,9}\/\S+)/gi;
const PMID_KEY = /\bpmid\s*[:=]\s*(\d{4,9})\b/gi;
const PMID_URL = /https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{4,9})\/?/gi;
const PMC_KEY = /\bpmc\s*[:=]\s*(PMC\d{4,9})\b/gi;
/*
 * A plain web address, with the label somebody typed in front of it.
 *
 * The capture group is not optional: `take` reads group 1, and a pattern
 * without one hands it the match offset instead — which is how a citation
 * ending `URL: https://…` took the whole build down. The label is swallowed
 * along with the address so the citation does not end in a dangling "URL:".
 */
const BARE_URL = /(?:\b(?:url|link|available(?:\s+at)?)\s*[:=]\s*)?(https?:\/\/\S+)/gi;

/** Trailing punctuation belongs to the sentence, not the identifier. */
function trimId(value: string): string {
  return value.replace(/[.,;)\]]+$/, "");
}

/**
 * Pull identifiers off a citation line.
 *
 * Returns the citation with the identifiers removed plus one link per
 * identifier found. A line with no identifier yields an empty `links` array,
 * and the renderer then draws no button — same only-if-added rule as profiles.
 */
export function parseCitation(line: string): { citation: string; links: ProfileLink[] } {
  let rest = line.trim();
  const links: ProfileLink[] = [];
  const seen = new Set<string>();

  const take = (pattern: RegExp, build: (id: string) => ProfileLink) => {
    rest = rest.replace(pattern, (match, captured: string) => {
      const id = trimId(captured);
      if (!id) return match;
      const link = build(id);
      if (!seen.has(link.url)) {
        seen.add(link.url);
        links.push(link);
      }
      return " ";
    });
  };

  // DOI and PubMed URLs are recognised before the generic URL sweep, so a
  // pasted doi.org link becomes a proper "DOI" button rather than "Link".
  take(DOI_URL, (id) => ({ kind: "doi", label: "DOI", url: `https://doi.org/${id}` }));
  take(DOI_KEY, (id) => ({ kind: "doi", label: "DOI", url: `https://doi.org/${id}` }));
  take(PMID_URL, (id) => ({
    kind: "pmid",
    label: "PubMed",
    url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
  }));
  take(PMID_KEY, (id) => ({
    kind: "pmid",
    label: "PubMed",
    url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
  }));
  take(PMC_KEY, (id) => ({
    kind: "pmc",
    label: "PMC",
    url: `https://www.ncbi.nlm.nih.gov/pmc/articles/${id}/`,
  }));
  take(BARE_URL, (id) => ({ kind: "url", label: "Full text", url: id }));

  const citation = rest
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;])/g, "$1")
    .replace(/[\s.,;]+$/, "")
    .trim();

  return { citation: citation ? `${citation}.` : "", links };
}

/**
 * DOIs from a `papers:` line, however the editor pasted them.
 *
 * A bare DOI, a `doi:` prefix and a full doi.org address are all the same
 * thing to whoever copied it out of a paper, so all three are accepted and
 * separated by commas, semicolons or plain spaces. Anything that is not
 * recognisably a DOI is dropped rather than turned into a broken link — the
 * caller warns about the difference between what was written and what was
 * understood.
 *
 * Lower-cased because DOIs are case-insensitive and these are used as map keys.
 */
export function parseDoiList(value: string): string[] {
  const found: string[] = [];
  for (const token of value.split(/[\s,;]+/)) {
    const doi = trimId(
      token
        .trim()
        .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
        .replace(/^doi\s*[:=]\s*/i, ""),
    ).toLowerCase();
    if (/^10\.\d{4,9}\/\S+$/.test(doi) && !found.includes(doi)) found.push(doi);
  }
  return found;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Bold the lab's own authors in a citation.
 *
 * Matches the surname plus any following initials (`Harikumar KB`,
 * `Harikumar K B`), which is how these appear in every journal style.
 * Escaping happens first; surnames are plain letters so they survive it.
 */
export function boldAuthors(citation: string, surnames: string[]): string {
  let html = esc(citation);
  for (const surname of surnames) {
    if (!surname.trim()) continue;
    const pattern = new RegExp(
      `\\b${escapeRegExp(surname.trim())}(\\s+[A-Z](?:\\s?[A-Z])?)?(?![\\w-])`,
      "g",
    );
    html = html.replace(pattern, (match) => `<strong>${match}</strong>`);
  }
  return html;
}

/* ---------------------------------------------------------------- Profiles */

/**
 * The dashes people type between a term and its detail, strongest first.
 *
 * Order is the whole point. A CV line reads `2022 – present — Senior Research
 * Fellow, RGCB`: the term itself contains an en dash, and splitting at the
 * first dash of any kind would cut it in half. Looking for the em dash first
 * means the long dash somebody reached for as the separator wins over the short
 * one inside a date range.
 */
const ENTRY_DASHES = [" — ", " – ", " - "];

/** Split one line into `term` and `detail`, or null when it carries no dash. */
function splitEntry(line: string): ProfileEntry | null {
  for (const dash of ENTRY_DASHES) {
    const at = line.indexOf(dash);
    if (at <= 0) continue;
    const term = line.slice(0, at).trim();
    const detail = line.slice(at + dash.length).trim();
    if (term && detail) return { term, detail };
  }
  return null;
}

/** A line that markdown owns: a list, a quote, a table, a code fence. */
const MARKDOWN_LINE = /^\s*(?:[-*+>|]|\d+[.)]\s|```|~~~)/;

/**
 * Read a `## Heading` block as a list of two-column entries, or return null
 * when it is ordinary prose and should stay prose.
 *
 * The test is the shape of what was written, so nothing has to be declared:
 *
 *  - every line carrying a dash — `2015 — Travel award, ASBMB` — is a list of
 *    one entry per line, which is the same `term — detail` convention the
 *    alumni rosters already use;
 *  - blank-line-separated blocks of two or more lines are a list too, with the
 *    first line as the term and the rest as its detail, which is how a CV
 *    pasted out of a document arrives;
 *  - anything else is prose.
 *
 * Deliberately conservative: a bulleted list of societies has no dashes and no
 * blank lines between items, so it stays a bulleted list rather than being
 * folded into pairs that were never meant to be pairs.
 */
export function parseEntries(body: string): ProfileEntry[] | null {
  const lines = body.split("\n");
  if (lines.some((line) => MARKDOWN_LINE.test(line))) return null;

  const filled = lines.map((line) => line.trim()).filter(Boolean);
  if (filled.length === 0) return null;

  const split = filled.map((line) => splitEntry(line));
  if (split.every((entry) => entry !== null)) {
    return split as ProfileEntry[];
  }

  const blocks = paragraphsOf(body);

  // One line on its own is a paragraph, not a term missing its detail — and the
  // first line has to read like a label, or the opening line of an ordinary
  // two-paragraph section would be mistaken for the term of the first row.
  if (blocks.length >= 2 && blocks.every((block) => block.length >= 2 && isLabel(block[0]!))) {
    return blocks.map((block) => ({
      term: block[0]!,
      detail: block.slice(1).join(" "),
    }));
  }

  return null;
}

/** The paragraphs of a block, each as its non-empty lines. */
function paragraphsOf(body: string): string[][] {
  return body
    .split(/\n\s*\n/)
    .map((block) => block.split("\n").map((line) => line.trim()).filter(Boolean))
    .filter((block) => block.length > 0);
}

/**
 * Does this line read as a label rather than as a sentence?
 *
 * A CV term is short, starts with a capital or a year, and does not end in the
 * punctuation that carries a sentence on. A line of hard-wrapped prose fails on
 * length long before any of the rest is asked, which is what keeps an ordinary
 * paragraph out of the two-column layout.
 */
function isLabel(line: string, limit = 60): boolean {
  return (
    line.length <= limit &&
    /^[A-Z0-9"'(]/.test(line) &&
    !/[.,;:]$/.test(line) &&
    !CONTINUATION.test(line)
  );
}

/**
 * Words a wrapped sentence breaks after, and a list item never ends on.
 *
 * This is what tells a pasted list of societies apart from a paragraph someone
 * hard-wrapped at eighty columns. `…returning to India as a DBT Ramalingaswami`
 * ends on "a" and is plainly mid-sentence; `Society of Biological Chemists
 * (India)` is plainly an item.
 */
const CONTINUATION =
  /\b(?:a|an|the|and|or|of|in|on|at|to|for|with|from|by|as|is|are|was|were|has|have|that|which|into|than|between|its|their|his|her)$/i;

/**
 * Read a block as a plain list: one thing per line, with no detail beside it.
 *
 * Memberships, committees, conferences attended — people paste these one per
 * line, and markdown would otherwise run the whole lot together into a single
 * grey paragraph, which is exactly what it looks like when it goes wrong.
 *
 * Held to the same `isLabel` test as a CV term, so a wrapped paragraph is never
 * shredded into bullets. Blank lines between the items are allowed, because
 * half the people who paste a list leave them in.
 */
export function parseItems(body: string): string[] | null {
  if (body.split("\n").some((line) => MARKDOWN_LINE.test(line))) return null;

  // Blank lines between the items or none at all: people paste both.
  const lines = paragraphsOf(body).flat();
  if (lines.length < 2) return null;

  // Longer than a CV term is allowed — an institution's full name runs long —
  // so `isLabel` is carrying the weight here: every line has to start like an
  // item and end like an item, which a wrapped sentence does not.
  return lines.every((line) => isLabel(line, 120)) ? lines : null;
}

/**
 * The HTML for a block that is not a list of two-column entries.
 *
 * A plain list — one thing per line — is turned into a real list rather than
 * left to markdown, which would join the lines into one grey paragraph.
 * Everything else is rendered as the markdown it is.
 */
export function renderBlock(body: string): string {
  const items = parseItems(body);
  return renderMarkdown(items ? items.map((item) => `- ${item}`).join("\n") : body);
}
/** Headings under which a block of text is a list of papers, not prose. */
const PAPERS_HEADING = /^(?:selected|recent|key|other)?\s*(?:publications?|papers|preprints|articles)$/i;

/**
 * The year a citation refers to.
 *
 * Taken as the last four-digit year in the line, because that is where journal
 * styles put it — `J Adv Res. 2024;65:73-87` — and a year in the *title* of a
 * paper would otherwise win. Empty when there is nothing that looks like one,
 * which only costs the paper its year heading.
 */
function yearOfCitation(citation: string): string {
  const found = citation.match(/\b(?:19|20)\d{2}\b/g);
  return found ? found[found.length - 1]! : "";
}

/**
 * Read a block as pasted citations: one per paragraph, exactly as the
 * publications page is written.
 *
 * This is what lets somebody list a paper the lab's own publications page does
 * not carry — work from a previous group, a preprint, a paper with another
 * lab — without it having to be added to the lab list first.
 */
export function parsePapers(body: string, labAuthors: string[]): Publication[] {
  const papers: Publication[] = [];
  for (const block of body.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    const line = block.replace(/\n/g, " ").trim().replace(/^[-*•]\s*/, "");
    if (!line || line.startsWith("#")) continue;
    const { citation, links } = parseCitation(line);
    if (!citation) continue;
    papers.push({
      year: yearOfCitation(citation),
      citation,
      html: boldAuthors(citation, labAuthors),
      links,
    });
  }
  return papers;
}

/**
 * Split a biography into the part that stays on the card and the `## Heading`
 * blocks that go on the person's own page.
 *
 * The rule is worth stating plainly because editors have to hold it in their
 * heads: **everything above the first heading is the card, everything below it
 * is the page.** That keeps a team page of twelve cards readable no matter how
 * long anybody's CV grows.
 */
export function parseProfile(
  body: string,
  labAuthors: string[] = [],
): { intro: string; sections: ProfileSection[] } {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const intro: string[] = [];
  const blocks: { title: string; lines: string[] }[] = [];

  let fenced = false;
  for (const line of lines) {
    if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^\s{0,3}#{2,4}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      blocks.push({ title: heading[1]!.trim(), lines: [] });
      continue;
    }
    (blocks.length > 0 ? blocks[blocks.length - 1]!.lines : intro).push(line);
  }

  const sections: ProfileSection[] = [];
  for (const block of blocks) {
    const text = block.lines.join("\n").trim();
    const papers = PAPERS_HEADING.test(block.title) ? parsePapers(text, labAuthors) : [];
    const entries = papers.length > 0 ? null : parseEntries(text);
    sections.push({
      slug: slugify(block.title) || `section-${sections.length + 1}`,
      title: block.title,
      entries: entries ?? [],
      html: entries || papers.length > 0 ? "" : renderBlock(text),
      papers,
    });
  }

  return { intro: intro.join("\n").trim(), sections };
}

/**
 * Is this person one of the authors of this citation?
 *
 * Matches the three forms journals print — `Harikumar KB`, `KB Harikumar` and
 * `K B Harikumar` — so a person's page can list their own papers without
 * anybody maintaining a second list of DOIs by hand. Where a name is written
 * initial-last, as `Arun V`, the *first* word is the surname; that is the
 * convention half this lab writes their name in.
 */
export function citedAs(citation: string, name: string): boolean {
  const words = name
    .replace(/\b(dr|prof|mr|ms|mrs|shri|smt)\.?\s*/gi, "")
    .split(/[\s.]+/)
    .filter(Boolean);
  if (words.length === 0) return false;

  let surname = words[words.length - 1]!;
  let rest = words.slice(0, -1);
  if (surname.length <= 2 && words.length > 1) {
    surname = words[0]!;
    rest = words.slice(1);
  }
  if (surname.length < 3) return false;

  const family = escapeRegExp(surname);
  const initial = rest[0]?.[0];
  const patterns = initial
    ? [
        `\\b${family}\\s+${initial}[A-Za-z]?\\b`,
        `\\b${initial}[A-Za-z]?\\s+${family}\\b`,
        `\\b${rest.map((word) => escapeRegExp(word)).join("\\s+")}\\s+${family}\\b`,
      ]
    : [`\\b${family}\\b`];

  return patterns.some((pattern) => new RegExp(pattern, "i").test(citation));
}
