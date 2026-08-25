/**
 * One renderer per page kind, dispatched from `renderPageBody`.
 *
 * Each renderer degrades to a helpful note when its folder is empty, telling
 * the editor which path to add files to rather than showing a blank page.
 */

import { esc, join } from "../html.ts";
import type {
  Album,
  GalleryItem,
  Member,
  Page,
  PublicationYear,
  ResourceGroup,
  ResourceItem,
  Site,
} from "../content/types.ts";
import {
  alumnusCard,
  emptyNote,
  image,
  leadPersonCard,
  linkList,
  personCard,
  reveal,
  rosterList,
  sectionBlock,
  sectionHead,
  statTile,
  storyBlock,
  storyCard,
} from "./components.ts";
import { excerpt } from "../content/text.ts";
import { icons } from "./icons.ts";
import { hrefTo, rel } from "./url.ts";

/** Find a page by kind, so the home page can borrow from the others. */
function pageOf(site: Site, kind: Page["kind"]): Page | undefined {
  return site.pages.find((page) => page.kind === kind);
}

function isLead(member: Member): boolean {
  return (
    /principal investigator|^pi$|group leader|scientist [a-z]$|professor/i.test(member.role) ||
    /^(yes|true)$/i.test(member.fields.lead ?? "")
  );
}

/* ------------------------------------------------------------ Team groups */

/**
 * How the team page is divided, in the order the sections appear.
 *
 * Membership is read from each person's `role:` line, so nobody has to maintain
 * a second list that can drift out of step with the cards themselves. Somebody
 * whose role does not match anything here still appears — under `Team` at the
 * end — because a person quietly vanishing from the page is far worse than a
 * person filed under a vague heading.
 *
 * The patterns are ordered and first match wins, which is what keeps
 * "Project Assistant" and "Project Associate" apart: they read almost the same
 * and belong in different sections.
 */
type TeamGroup = {
  id: string;
  title: string;
  /** Shown under the heading. Empty means no subtitle. */
  lead: string;
  match: RegExp;
};

const TEAM_GROUPS: TeamGroup[] = [
  {
    id: "scholars",
    title: "Research scholars",
    lead: "Doctoral students and research fellows.",
    match:
      /ph\.?\s?d|doctoral|research scholar|\bjrf\b|\bsrf\b|junior research fellow|senior research fellow|project associate|research fellow|postdoc|post-doctoral/i,
  },
  {
    id: "technical",
    title: "Laboratory management",
    lead: "Day-to-day running of the laboratory, consultancy services, and the animal house.",
    // "Lab Manager" has to be caught here rather than falling through to the
    // support group below, which matches lab *assistant* and nothing else.
    match:
      /technical manager|technical officer|technical assistant|technician|lab(oratory)?\s*manager|facility manager/i,
  },
  {
    id: "project",
    title: "Project staff",
    lead: "",
    match: /project assistant|project staff/i,
  },
  {
    id: "support",
    title: "Laboratory support",
    lead: "",
    match: /lab(oratory)?\s*(assistant|attendant|helper)|support staff/i,
  },
];

const UNGROUPED: TeamGroup = { id: "other", title: "Team", lead: "", match: /(?:)/ };

/**
 * The alumni page, in the order the sections appear.
 *
 * Post-doctoral fellows sit above doctoral students, and the MSc students who
 * did their final project here are given a section of their own at the same
 * weight rather than a footnote — that project is, for most of them, the whole
 * of their research training.
 */
const ALUMNI_GROUPS: TeamGroup[] = [
  {
    id: "postdoc",
    title: "Post-doctoral alumni",
    lead: "",
    match: /post-?\s?doc|research associate|\bpda\b/i,
  },
  {
    id: "phd",
    title: "PhD alumni",
    lead: "",
    match: /ph\.?\s?d|doctoral|research scholar/i,
  },
  {
    id: "msc",
    title: "BRIC-RGCB MSc alumni",
    lead: "MSc Biotechnology students who carried out their final project in the laboratory.",
    match: /m\.?\s?sc|masters?|dissertation student/i,
  },
  {
    id: "project",
    title: "Project associates and fellows",
    lead: "People who worked on funded projects in the laboratory before moving on.",
    match:
      /project associate|project assistant|project fellow|project staff|\bsrf\b|\bjrf\b|senior research fellow|junior research fellow|research fellow/i,
  },
];

const ALUMNI_UNGROUPED: TeamGroup = { id: "other", title: "Alumni", lead: "", match: /(?:)/ };

/** Alumni by group, in `ALUMNI_GROUPS` order, skipping groups nobody is in. */
function groupAlumni(members: Member[]): { group: TeamGroup; people: Member[] }[] {
  const resolve = (member: Member): TeamGroup => {
    const explicit = member.fields.group?.trim().toLowerCase();
    const named = explicit
      ? ALUMNI_GROUPS.find(
          (group) => group.id === explicit || group.title.toLowerCase() === explicit,
        )
      : undefined;
    return named ?? ALUMNI_GROUPS.find((g) => g.match.test(member.role)) ?? ALUMNI_UNGROUPED;
  };

  return [...ALUMNI_GROUPS, ALUMNI_UNGROUPED]
    .map((group) => ({ group, people: members.filter((member) => resolve(member) === group) }))
    .filter((section) => section.people.length > 0);
}

function groupFor(member: Member): TeamGroup {
  // An explicit `group:` line always wins, for the roles no pattern can guess.
  const explicit = member.fields.group?.trim().toLowerCase();
  if (explicit) {
    const named = TEAM_GROUPS.find(
      (group) => group.id === explicit || group.title.toLowerCase() === explicit,
    );
    if (named) return named;
  }
  return TEAM_GROUPS.find((group) => group.match.test(member.role)) ?? UNGROUPED;
}

/** Members by group, in `TEAM_GROUPS` order, skipping groups nobody is in. */
function groupTeam(members: Member[]): { group: TeamGroup; people: Member[] }[] {
  return [...TEAM_GROUPS, UNGROUPED]
    .map((group) => ({
      group,
      people: members.filter((member) => groupFor(member) === group),
    }))
    .filter((section) => section.people.length > 0);
}

/**
 * The people the home page previews.
 *
 * Laboratory management comes first — they are who a visitor, a collaborator or
 * a consultancy client actually deals with — and then the doctoral students and
 * fellows. Project and support staff appear in full on the team page.
 *
 * `sort` is stable, so within each of the two ranks people keep the order their
 * filenames give them.
 */
const HOME_GROUPS = ["technical", "scholars"];

function homePeople(members: Member[]): Member[] {
  return members
    .filter((member) => !isLead(member) && HOME_GROUPS.includes(groupFor(member).id))
    .sort((a, b) => HOME_GROUPS.indexOf(groupFor(a).id) - HOME_GROUPS.indexOf(groupFor(b).id));
}

/**
 * The page's prose blocks, in filename order.
 *
 * Sections and stories arrive from two different folders but share one
 * numbering: the `NN-` prefix decides where each one sits. Moving a story above
 * the overview is therefore a rename, which is the only ordering rule anybody
 * editing this site has to know.
 */
function sectionsBlock(page: Page, depth: number): string {
  const blocks = [
    // On a tie the section goes first: prose framing tends to introduce the
    // stories beneath it rather than follow them.
    ...page.sections.map((section) => ({
      order: section.order,
      tie: 0,
      render: () => sectionBlock(section, depth, true),
    })),
    ...page.stories.map((story) => ({
      order: story.order,
      tie: 1,
      render: () => storyBlock(story, depth),
    })),
  ].sort((a, b) => a.order - b.order || a.tie - b.tie);

  return blocks.map((block) => block.render()).join("");
}

/**
 * The page's opening prose: the body of `page.txt` followed by any `text/`
 * sections. Renders nothing at all when the page has neither.
 */
function introBlock(page: Page, depth: number): string {
  const parts = [
    page.introHtml ? `<div class="prose">${page.introHtml}</div>` : "",
    sectionsBlock(page, depth),
  ].filter(Boolean);
  if (parts.length === 0) return "";
  return `<section class="section"><div class="container">${parts.join("")}</div></section>`;
}

/* ------------------------------------------------------------------- Home */

function renderHome(site: Site, page: Page, depth: number): string {
  const teamPage = pageOf(site, "team");
  const publicationsPage = pageOf(site, "publications");
  const linksPage = pageOf(site, "links");

  /*
   * The page the research stories live on, found by the fact that it has them
   * rather than by its name. Moving the stories into a folder of their own, or
   * back in beside the research overview, is then a matter of moving files —
   * which is the only kind of change the people editing this site can make.
   */
  const storiesPage = site.pages.find((page) => page.stories.length > 0);

  /*
   * Every one of them, rather than the first few. The publications and people
   * below are cut down because their pages hold dozens; research stories are
   * written a few a year, and one silently missing from the front page is a far
   * worse surprise than a second row of cards. A story that should not be here
   * says `home: no` for itself.
   */
  const stories = (storiesPage?.stories ?? []).filter((story) => story.onHome);

  const members = teamPage?.members ?? [];
  const preview = homePeople(members).slice(0, 8);
  const lead = members.find(isLead);
  const recent = publicationsPage?.publicationYears[0];
  const featured = (linksPage?.links ?? []).filter((link) => link.featured);

  /*
   * The three headline counts, each with the parts that make it up.
   *
   * Every figure is derived from the same content the pages themselves render,
   * so a number here cannot fall out of step with the section it summarises —
   * add a person, and both the team page and this tile move together.
   */
  const alumniPage = pageOf(site, "alumni");
  const alumni = alumniPage?.members ?? [];
  const rosters = alumniPage?.rosters ?? [];
  const rosterTotal = rosters.reduce((total, roster) => total + roster.entries.length, 0);
  const papers = publicationsPage?.publicationYears ?? [];
  const paperTotal = papers.reduce((total, year) => total + year.items.length, 0);

  const tiles = [
    members.length > 0
      ? {
          value: String(members.length),
          label: "People in the lab",
          breakdown: groupTeam(members.filter((member) => !isLead(member))).map((section) => ({
            label: section.group.title,
            value: section.people.length,
          })),
        }
      : null,

    alumni.length + rosterTotal > 0
      ? {
          value: String(alumni.length + rosterTotal),
          label: "Alumni and trainees",
          breakdown: [
            ...groupAlumni(alumni).map((section) => ({
              label: section.group.title,
              value: section.people.length,
            })),
            ...rosters.map((roster) => ({ label: roster.title, value: roster.entries.length })),
          ],
        }
      : null,

    paperTotal > 0
      ? {
          value: String(paperTotal),
          label: "Selected publications",
          // The four most recent years; the rest are a click away on the page.
          breakdown: papers
            .slice(0, 4)
            .map((year) => ({ label: year.year, value: year.items.length })),
        }
      : null,
  ].filter((tile): tile is NonNullable<typeof tile> => tile !== null);

  return join([
    introBlock(page, depth) ||
      `<section class="section"><div class="container">${emptyNote(
        "Add an introduction by creating a text file in",
        "content/pages/01-home/text/01-welcome.txt",
      )}</div></section>`,

    tiles.length > 0
      ? join([
          '<section class="section"><div class="container"><div class="stats">',
          tiles.map((tile, index) => statTile({ ...tile, index })).join(""),
          "</div></div></section>",
        ])
      : "",

    stories.length > 0 && storiesPage
      ? join([
          '<section class="section"><div class="container">',
          sectionHead({ eyebrow: "Research", title: "What we are working on" }),
          '<div class="grid grid--cards">',
          stories
            .map((story, index) =>
              storyCard(
                {
                  title: story.title,
                  // Each fallback is a shorter thing the editor has already
                  // written, so a story that only got as far as a title and a
                  // paragraph still reads properly on the card.
                  body: story.excerpt || story.lead || excerpt(story.text, 160),
                  href: `${hrefTo(depth, storiesPage)}#${story.slug}`,
                  figure: story.figure,
                },
                depth,
                index,
              ),
            )
            .join(""),
          "</div>",
          `<p class="button-row"><a class="button button--ghost" href="${esc(hrefTo(depth, storiesPage))}">${esc(storiesPage.title)} ${icons.arrowRight}</a></p>`,
          "</div></section>",
        ])
      : "",

    lead
      ? join([
          '<section class="section section--sunken"><div class="container">',
          sectionHead({ eyebrow: "Principal investigator", title: lead.name }),
          leadPersonCard(lead, depth),
          "</div></section>",
        ])
      : "",

    recent && publicationsPage
      ? join([
          '<section class="section"><div class="container">',
          sectionHead({
            eyebrow: "Recent work",
            title: `Publications from ${recent.year}`,
          }),
          `<ul class="pub-list"${reveal()}>`,
          recent.items
            .slice(0, 4)
            .map(
              (item) =>
                `<li class="pub"><p class="pub__citation">${item.html}</p>${linkList(item.links, "pub__links")}</li>`,
            )
            .join(""),
          "</ul>",
          `<p class="button-row"><a class="button button--ghost" href="${esc(hrefTo(depth, publicationsPage))}">All publications ${icons.arrowRight}</a></p>`,
          "</div></section>",
        ])
      : "",

    // Laboratory management and the research scholars. Project and support
    // staff are listed in full on the team page rather than here.
    preview.length > 0 && teamPage
      ? join([
          '<section class="section section--sunken"><div class="container">',
          sectionHead({ eyebrow: "The lab", title: "Who you will work with" }),
          '<div class="grid grid--people">',
          preview.map((member, index) => personCard(member, depth, index)).join(""),
          "</div>",
          `<p class="button-row"><a class="button button--ghost" href="${esc(hrefTo(depth, teamPage))}">Full team ${icons.arrowRight}</a></p>`,
          "</div></section>",
        ])
      : "",

    featured.length > 0
      ? join([
          '<section class="section"><div class="container">',
          sectionHead({ eyebrow: "Elsewhere", title: "Institute resources" }),
          '<div class="grid grid--cards">',
          featured.map((link, index) => linkCard(link, index)).join(""),
          "</div></div></section>",
        ])
      : "",
  ]);
}

/* --------------------------------------------------------------- Research */

function renderSectionsPage(page: Page, depth: number, folder: string): string {
  return (
    introBlock(page, depth) ||
    `<section class="section"><div class="container">${emptyNote(
      "Add content by creating a text file in",
      `${folder}/text/01-overview.txt`,
    )}</div></section>`
  );
}

/* ------------------------------------------------------------------- Team */

function renderTeam(page: Page, depth: number, folder: string): string {
  const lead = page.members.find(isLead);
  const rest = page.members.filter((member) => member !== lead);
  const sections = groupTeam(rest);

  return join([
    introBlock(page, depth),

    lead
      ? join([
          '<section class="section"><div class="container">',
          sectionHead({ eyebrow: "Principal investigator", title: lead.name }),
          leadPersonCard(lead, depth),
          "</div></section>",
        ])
      : "",

    // One section per group. Alternating the sunken background keeps the
    // divisions legible on a long page without adding rules between them.
    sections
      .map((section, index) =>
        join([
          `<section class="section${index % 2 === 0 ? " section--sunken" : ""}"><div class="container">`,
          sectionHead({
            eyebrow: index === 0 ? "Members" : "",
            title: section.group.title,
            lead: section.group.lead,
          }),
          '<div class="grid grid--people">',
          section.people.map((member, i) => personCard(member, depth, i)).join(""),
          "</div>",
          "</div></section>",
        ]),
      )
      .join(""),

    page.members.length === 0
      ? join([
          '<section class="section"><div class="container">',
          emptyNote(
            "Add a person by putting a photo and a matching text file in",
            `${folder}/photos/ and ${folder}/text/`,
          ),
          "</div></section>",
        ])
      : "",
  ]);
}

/* ----------------------------------------------------------------- Alumni */

function renderAlumni(page: Page, depth: number, folder: string): string {
  const sections = groupAlumni(page.members);

  return join([
    introBlock(page, depth),

    sections
      .map((section, index) =>
        join([
          `<section class="section${index % 2 === 0 ? "" : " section--sunken"}"><div class="container">`,
          sectionHead({ title: section.group.title, lead: section.group.lead }),
          '<div class="grid grid--people">',
          section.people.map((member, i) => alumnusCard(member, depth, i)).join(""),
          "</div>",
          "</div></section>",
        ]),
      )
      .join(""),

    // Short-term visitors close the page as a collapsed list. Everyone who did
    // an MSc project or held a project post here gets a card in a section
    // above — only people passing through briefly are folded away.
    page.rosters.length > 0
      ? join([
          '<section class="section"><div class="container">',
          sectionHead({
            eyebrow: "Also through the lab",
            title: "Short-term trainees",
            lead: "Open the list to see names and the college each person came from.",
          }),
          '<div class="roster-grid">',
          page.rosters.map((roster, index) => rosterList(roster, index)).join(""),
          "</div>",
          "</div></section>",
        ])
      : "",

    page.members.length === 0 && page.rosters.length === 0
      ? join([
          '<section class="section"><div class="container">',
          emptyNote("Add an alumnus by putting a text file in", `${folder}/text/`),
          "</div></section>",
        ])
      : "",
  ]);
}

/* ----------------------------------------------------------- Publications */

/** One year of papers: the heading and the list under it. */
function pubYearBlock(group: PublicationYear, level: 2 | 3 = 2): string {
  return join([
    `<div class="pub-year"${reveal()}>`,
    `<h${level} class="pub-year__label">${esc(group.year)}</h${level}>`,
    '<ul class="pub-list">',
    group.items
      .map(
        (item) =>
          `<li class="pub"><p class="pub__citation">${item.html}</p>${linkList(item.links, "pub__links")}</li>`,
      )
      .join(""),
    "</ul>",
    "</div>",
  ]);
}

/**
 * The lab's own papers, then the PI's other work below them.
 *
 * The two lists come from two folders and are counted separately, because
 * "how much has this lab published" and "what has the PI put his name to" are
 * different questions and one number cannot answer both. The second list is
 * collapsed: it is longer than the first and it is not what most readers came
 * for, but it is one click away rather than missing.
 */
function renderPublications(page: Page, depth: number, folder: string): string {
  const total = page.publicationYears.reduce((count, year) => count + year.items.length, 0);
  const piTotal = page.piPublicationYears.reduce((count, year) => count + year.items.length, 0);

  if (total === 0 && piTotal === 0) {
    return `<section class="section"><div class="container">${emptyNote(
      "Add papers by creating one file per year in",
      `${folder}/years/2026.txt`,
    )}</div></section>`;
  }

  const piTitle =
    page.fields.pititle || "Other publications from the principal investigator";
  const piLead =
    page.fields.pilead ||
    "Work from before the laboratory was established, and studies guided or " +
      "co-authored elsewhere. These are not counted as the laboratory's own output.";

  return join([
    introBlock(page, depth),
    '<section class="section"><div class="container">',
    total > 0
      ? join([
          sectionHead({
            eyebrow: "From the laboratory",
            title: `${total} paper${total === 1 ? "" : "s"}`,
            lead: page.fields.lablead || "Papers with laboratory members among the authors.",
          }),
          page.publicationYears.map((group) => pubYearBlock(group)).join(""),
        ])
      : emptyNote("Add the laboratory's own papers to", `${folder}/years/2026.txt`),
    "</div></section>",

    piTotal > 0
      ? join([
          '<section class="section section--sunken"><div class="container">',
          `<details class="pub-aside"${reveal()}>`,
          '<summary class="pub-aside__summary">',
          `<span class="pub-aside__title">${esc(piTitle)}</span>`,
          `<span class="pub-aside__count">${piTotal}</span>`,
          "</summary>",
          `<div class="pub-aside__body">`,
          `<p class="section__lead">${esc(piLead)}</p>`,
          page.piPublicationYears.map((group) => pubYearBlock(group, 3)).join(""),
          "</div>",
          "</details>",
          "</div></section>",
        ])
      : "",
  ]);
}

/* ---------------------------------------------------------------- Gallery */

/** One photo as a lightbox button. Shared by the loose grid and every album. */
function photoButton(item: GalleryItem, depth: number, index: number): string {
  return join([
    `<button class="gallery__item" type="button" data-lightbox`,
    // The lightbox shows the largest variant, not the thumbnail.
    ` data-full="${esc(rel(depth, item.photo.src))}"`,
    ` data-caption="${esc(item.caption || item.title)}"`,
    `${reveal(index)}>`,
    image(item.photo, depth, {
      alt: item.caption || item.title,
      sizes: "(max-width: 600px) 50vw, 14rem",
    }),
    item.caption ? `<span class="gallery__caption">${esc(item.caption)}</span>` : "",
    "</button>",
  ]);
}

/**
 * A grid of photos.
 *
 * `data-lightbox-group` scopes the arrows: open a photo from the conference
 * album and pressing → walks that album, rather than running on through every
 * photograph on the page.
 */
function photoGrid(items: GalleryItem[], depth: number, group: string): string {
  return join([
    `<div class="gallery" data-lightbox-group="${esc(group)}">`,
    items.map((item, index) => photoButton(item, depth, index)).join(""),
    "</div>",
  ]);
}

/**
 * An album: a stack of prints that opens into a grid.
 *
 * A native `<details>`, like the alumni rosters — it opens with JavaScript
 * switched off, it is keyboard operable for free, and the browser's own
 * find-in-page opens it to reveal a match inside. The closed state stacks three
 * of the album's photos on top of each other, because a single flat thumbnail
 * gives the reader no hint that there is more behind it.
 */
function albumBlock(album: Album, depth: number, index: number): string {
  const sheets = [album.cover, ...album.items.filter((item) => item !== album.cover)].slice(0, 3);
  const total = album.items.length;

  return join([
    `<details class="album"${reveal(index)}>`,
    '<summary class="album__summary">',
    '<span class="album__stack">',
    // Painted back to front, so the cover ends up on top with no z-index race.
    sheets
      .map((item, position) =>
        join([
          `<span class="album__sheet" data-sheet="${position + 1}">`,
          image(item.photo, depth, { alt: "", sizes: "(max-width: 700px) 45vw, 16rem" }),
          "</span>",
        ]),
      )
      .reverse()
      .join(""),
    "</span>",
    '<span class="album__meta">',
    `<span class="album__title">${esc(album.title)}</span>`,
    album.date ? `<span class="album__date">${esc(album.date)}</span>` : "",
    `<span class="album__count">${total} photo${total === 1 ? "" : "s"}</span>`,
    album.caption ? `<span class="album__caption">${esc(album.caption)}</span>` : "",
    "</span>",
    "</summary>",
    `<div class="album__body">`,
    photoGrid(album.items, depth, album.slug),
    "</div>",
    "</details>",
  ]);
}

function renderGallery(page: Page, depth: number, folder: string): string {
  const loose = page.gallery;
  const albums = page.albums;

  return join([
    introBlock(page, depth),
    '<section class="section"><div class="container">',
    albums.length > 0
      ? join([
          // The heading only earns its space when there is a second group of
          // photos below it to be distinguished from.
          loose.length > 0 ? sectionHead({ title: "Albums" }) : "",
          '<div class="album-grid">',
          albums.map((album, index) => albumBlock(album, depth, index)).join(""),
          "</div>",
        ])
      : "",
    loose.length > 0
      ? join([
          albums.length > 0 ? sectionHead({ title: "More photos" }) : "",
          photoGrid(loose, depth, "photos"),
        ])
      : "",
    loose.length === 0 && albums.length === 0
      ? emptyNote("Add photos to", `${folder}/photos/`)
      : "",
    "</div></section>",
  ]);
}

/* ---------------------------------------------------------------- Contact */

function renderContact(site: Site, page: Page, depth: number): string {
  const { config } = site;

  return join([
    '<section class="section"><div class="container">',
    '<div class="contact-grid">',

    config.address.length > 0
      ? join([
          `<div class="contact-card"${reveal(0)}>`,
          `<h3>${icons.pin} Address</h3>`,
          `<address>${config.address.map((line) => esc(line)).join("<br>")}</address>`,
          "</div>",
        ])
      : "",

    config.emails.length > 0
      ? join([
          `<div class="contact-card"${reveal(1)}>`,
          `<h3>${icons.mail} Email</h3><ul>`,
          config.emails
            .map(
              (entry) =>
                `<li><span class="contact-card__label">${esc(entry.label)}</span><a href="mailto:${esc(entry.value)}">${esc(entry.value)}</a></li>`,
            )
            .join(""),
          "</ul></div>",
        ])
      : "",

    config.phones.length > 0
      ? join([
          `<div class="contact-card"${reveal(2)}>`,
          `<h3>${icons.phone} Phone</h3><ul>`,
          config.phones
            .map(
              (entry) =>
                `<li><span class="contact-card__label">${esc(entry.label)}</span><a href="tel:${esc(entry.value.replace(/[^\d+]/g, ""))}">${esc(entry.value)}</a></li>`,
            )
            .join(""),
          "</ul></div>",
        ])
      : "",

    "</div>",
    "</div></section>",
    introBlock(page, depth),
  ]);
}

/* ------------------------------------------------------------------ Links */

function linkCard(
  link: { title: string; url: string; description: string },
  index = 0,
): string {
  let host = "";
  try {
    host = new URL(link.url).hostname.replace(/^www\./, "");
  } catch {
    host = link.url;
  }
  return join([
    `<article class="card card--link"${reveal(index)}>`,
    `<h3 class="card__title"><a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${esc(link.title)}</a></h3>`,
    link.description ? `<p class="card__body">${esc(link.description)}</p>` : "",
    `<p class="card__meta">${icons.external}<span>${esc(host)}</span></p>`,
    "</article>",
  ]);
}

function renderLinks(page: Page, depth: number, folder: string): string {
  return join([
    introBlock(page, depth),
    '<section class="section"><div class="container">',
    page.links.length > 0
      ? `<div class="grid grid--cards">${page.links.map((link, index) => linkCard(link, index)).join("")}</div>`
      : emptyNote("Add a link by creating a text file in", `${folder}/links/`),
    "</div></section>",
  ]);
}

/* ------------------------------------------------------------- Resources */

/**
 * One repository or code block as a card.
 *
 * The card links to the item's own page rather than straight out to GitHub,
 * because the page is where the explanation lives — what it does, what it
 * needs, how to run it — and that is the thing this section exists to add on
 * top of a bare repository listing.
 */
function resourceCard(item: ResourceItem, depth: number, index: number): string {
  const files = item.downloads.length;
  let host = "";
  if (item.repo) {
    try {
      host = new URL(item.repo.url).hostname.replace(/^www\./, "");
    } catch {
      host = "";
    }
  }
  const meta = [
    item.language,
    files > 0 ? `${files} file${files === 1 ? "" : "s"}` : "",
    host,
  ].filter(Boolean);

  return join([
    `<article class="card card--link resource-card"${reveal(index)}>`,
    `<p class="resource-card__icon" aria-hidden="true">${item.repo && files === 0 ? icons.repo : icons.code}</p>`,
    `<h3 class="card__title"><a href="${esc(rel(depth, item.path))}">${esc(item.title)}</a></h3>`,
    item.summary ? `<p class="card__body">${esc(item.summary)}</p>` : "",
    meta.length > 0
      ? `<p class="card__meta"><span>${meta.map((part) => esc(part)).join(" · ")}</span></p>`
      : "",
    "</article>",
  ]);
}

/**
 * The Resources landing page: every branch, with its items under it.
 *
 * Branches are rendered in folder order and named by their own folders, so the
 * page grows a section the day somebody adds one — the two the lab started
 * with are not special-cased anywhere.
 */
function renderResources(page: Page, depth: number, folder: string): string {
  if (page.resourceGroups.length === 0) {
    return join([
      introBlock(page, depth),
      `<section class="section"><div class="container">${emptyNote(
        "Add a repository or a code block by creating a folder in",
        `${folder}/1-repositories/01-my-repo/item.txt`,
      )}</div></section>`,
    ]);
  }

  return join([
    introBlock(page, depth),
    page.resourceGroups
      .map((group, index) =>
        join([
          `<section class="section${index % 2 === 1 ? " section--sunken" : ""}" id="${esc(group.slug)}">`,
          '<div class="container">',
          sectionHead({
            eyebrow: `${group.items.length} item${group.items.length === 1 ? "" : "s"}`,
            title: group.title,
            lead: group.lead,
          }),
          '<div class="grid grid--cards">',
          group.items.map((item, i) => resourceCard(item, depth, i)).join(""),
          "</div>",
          "</div></section>",
        ]),
      )
      .join(""),
  ]);
}

/* --------------------------------------------------------------- Dispatch */

export function renderPageBody(site: Site, page: Page, depth: number): string {
  const folder = `content/pages/${page.slug}`;
  switch (page.kind) {
    case "home":
      return renderHome(site, page, depth);
    case "team":
      return renderTeam(page, depth, folder);
    case "alumni":
      return renderAlumni(page, depth, folder);
    case "publications":
      return renderPublications(page, depth, folder);
    case "gallery":
      return renderGallery(page, depth, folder);
    case "contact":
      return renderContact(site, page, depth);
    case "links":
      return renderLinks(page, depth, folder);
    case "resources":
      return renderResources(page, depth, folder);
    default:
      return renderSectionsPage(page, depth, folder);
  }
}

/** Meta description: the page's own words where it has any. */
export function descriptionFor(site: Site, page: Page): string {
  const fromIntro = page.introHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const text =
    page.tagline ||
    fromIntro ||
    page.sections[0]?.text ||
    site.config.description ||
    site.config.tagline;
  return text.length > 300 ? `${text.slice(0, 297).trimEnd()}…` : text;
}
