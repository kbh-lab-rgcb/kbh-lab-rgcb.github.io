/**
 * A person's own page: `team/harikumar-kb/index.html`.
 *
 * Opt-in, one line in their text file. A lab page that gives every student an
 * empty CV page would be worse than no CV pages at all, so nobody gets one
 * until they write `profile: yes` — and the page they then get is built from
 * whatever they wrote and nothing else. No placeholders, no "coming soon".
 */

import { esc, join } from "../html.ts";
import type {
  Member,
  Page,
  ProfileSection,
  Publication,
  PublicationYear,
  Site,
} from "../content/types.ts";
import { cvList, image, linkList, reveal } from "./components.ts";
import { citedAs, excerpt, field, parseDoiList } from "../content/text.ts";
import { icons } from "./icons.ts";
import { hrefTo } from "./url.ts";

/** Group papers by year, newest first, with undated ones last. */
function byYear(items: Publication[]): PublicationYear[] {
  const groups = new Map<string, Publication[]>();
  for (const item of items) {
    const list = groups.get(item.year);
    if (list) list.push(item);
    else groups.set(item.year, [item]);
  }

  return [...groups.entries()]
    .map(([year, list]) => ({ year, items: list }))
    .sort((a, b) => {
      if (!a.year) return 1;
      if (!b.year) return -1;
      return b.year.localeCompare(a.year);
    });
}

/**
 * The papers on this person's page.
 *
 * Three sources, in this order, because they answer three different questions:
 *
 *  - `papers:` in their file — an explicit list of DOIs. Use it when a surname
 *    is too common for matching to be safe. **A DOI that is not on the lab's
 *    publications page still appears**, resolved in `load.ts` to the DOI itself
 *    with a working link, which is what makes work from a previous group or a
 *    collaboration possible to list here at all.
 *  - a `## Publications` heading in their file — citations pasted in full.
 *    Same purpose, better result: a real citation rather than a bare DOI. These
 *    are always added, whatever else is listed.
 *  - failing both, every paper on the publications page that names them as an
 *    author, so nobody has to maintain a second list of the lab's own work.
 *
 * `publications: no` turns the section off entirely.
 */
export function papersFor(site: Site, member: Member): PublicationYear[] {
  if (/^(no|off|none|hide|false)$/i.test(field(member.fields, "publications"))) return [];

  const pasted = member.sections.flatMap((section) => section.papers);
  const listed = member.papers.length > 0 || pasted.length > 0;

  // Both lists on the publications page, not just the lab's own: the PI's
  // page would otherwise lose his doctoral and post-doctoral work the moment
  // that work moved into its own folder, and nobody else is named in it.
  const own = listed
    ? [...member.papers, ...pasted]
    : site.pages.flatMap((page) =>
        [...page.publicationYears, ...page.piPublicationYears].flatMap((group) =>
          group.items.filter((item) => citedAs(item.citation, member.name)),
        ),
      );

  // The same paper written twice — once as a DOI, once pasted in full — is one
  // paper. The first spelling of it wins.
  const seen = new Set<string>();
  const unique = own.filter((item) => {
    const key =
      item.links.find((link) => link.kind === "doi")?.url.toLowerCase() ??
      item.citation.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return byYear(unique);
}

function profileSection(section: ProfileSection, index: number): string {
  return join([
    `<section class="profile-section"${reveal(index)}>`,
    `<h2 class="profile-section__title">${esc(section.title)}</h2>`,
    section.entries.length > 0
      ? cvList(section.entries)
      : `<div class="prose">${section.html}</div>`,
    "</section>",
  ]);
}

/** Alumni facts that would otherwise only exist on the card they came from. */
function facts(member: Member): string {
  const rows = [
    member.year && { term: "Finished", detail: member.year },
    member.thesis && { term: "Thesis", detail: member.thesis },
    member.now && { term: "Now", detail: member.now },
  ].filter(Boolean) as { term: string; detail: string }[];

  return cvList(rows, "facts");
}

export function renderProfileBody(
  site: Site,
  parent: Page,
  member: Member,
  depth: number,
): string {
  const years = papersFor(site, member);
  const total = years.reduce((count, group) => count + group.items.length, 0);

  return join([
    '<section class="section"><div class="container container-narrow">',

    `<p class="profile__back"><a href="${esc(hrefTo(depth, parent))}">${icons.chevronLeft}<span>Back to ${esc(parent.title)}</span></a></p>`,

    `<div class="profile__head"${reveal()}>`,
    '<div class="person__portrait profile__portrait">',
    member.photo
      ? image(member.photo, depth, {
          alt: `${member.name}, ${member.role}`,
          sizes: "(max-width: 640px) 60vw, 16rem",
          eager: true,
        })
      : `<div class="person__initials" aria-hidden="true">${esc(member.initials)}</div>`,
    "</div>",
    '<div class="profile__intro">',
    member.focus ? `<p class="profile__focus">${esc(member.focus)}</p>` : "",
    member.email
      ? `<p class="profile__email"><a href="mailto:${esc(member.email)}">${esc(member.email)}</a></p>`
      : "",
    linkList(member.links),
    "</div>",
    "</div>",

    facts(member),

    member.html ? `<div class="prose profile__bio"${reveal()}>${member.html}</div>` : "",

    // A `## Publications` block is not printed where it was written: its papers
    // are merged into the publications section below, so there is one list.
    member.sections
      .filter((section) => section.papers.length === 0)
      .map((section, index) => profileSection(section, index))
      .join(""),

    total > 0
      ? join([
          `<section class="profile-section"${reveal()}>`,
          `<h2 class="profile-section__title">Publications <span class="profile-section__count">${total}</span></h2>`,
          years
            .map((group) =>
              join([
                '<div class="pub-year">',
                // A paper listed only by DOI has no year to file it under.
                group.year ? `<h3 class="pub-year__label">${esc(group.year)}</h3>` : "",
                '<ul class="pub-list">',
                group.items
                  .map(
                    (item) =>
                      `<li class="pub"><p class="pub__citation">${item.html}</p>${linkList(item.links, "pub__links")}</li>`,
                  )
                  .join(""),
                "</ul>",
                "</div>",
              ]),
            )
            .join(""),
          "</section>",
        ])
      : "",

    "</div></section>",
  ]);
}

/** Meta description for a person's page: their own words, where they wrote any. */
export function profileDescription(member: Member): string {
  return excerpt(member.text, 200) || `${member.name} — ${member.role}`;
}

/**
 * The `Page` the shell is rendered against.
 *
 * A profile is not a page in the navigation — it borrows its parent's identity
 * so the Team link stays highlighted and the banner behind the name is the same
 * one the team page uses, and only replaces what is genuinely its own.
 */
export function profileShell(parent: Page, member: Member): Page {
  return {
    ...parent,
    title: member.name,
    tagline: member.role,
    introHtml: "",
    outDir: member.profilePath.replace(/\/+$/, ""),
  };
}
