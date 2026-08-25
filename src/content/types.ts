/**
 * The shape of everything under `content/`.
 *
 * Guiding rule for this whole module: content is written by lab members through
 * GitHub's web UI, so every field that can be absent IS absent-able. Nothing here
 * throws; unusable input becomes a `Warning` and a sensible fallback.
 */

/**
 * One line of a profile section: a term and the detail beside it.
 *
 * A CV is two columns — a year and what happened, a post and where it was — so
 * that is what these render as.
 */
export type ProfileEntry = {
  term: string;
  detail: string;
};

/**
 * A `## Heading` block from a person's text file, shown on their own page.
 *
 * The block is either a list of entries or ordinary prose, never both: which
 * one is decided by the shape of what was written, not by anything the editor
 * has to declare. See `parseProfile` in `text.ts`.
 */
export type ProfileSection = {
  slug: string;
  title: string;
  /** Two-column entries. Empty when the block is prose. */
  entries: ProfileEntry[];
  /** Rendered markdown. Empty when the block is a list of entries. */
  html: string;
  /**
   * Citations, when the heading is a publications one and the block is a list
   * of papers. These are lifted out and merged into the page's publications
   * section rather than printed under a second heading of their own.
   */
  papers: Publication[];
};

/** A profile link that only renders when the editor actually supplied it. */
export type ProfileLink = {
  /** Key as written in the text file, e.g. `orcid`. */
  kind: string;
  /** Human label for the link, e.g. `ORCID`. */
  label: string;
  /** Fully-resolved absolute URL. */
  url: string;
};

/** An image discovered on disk, plus the responsive variants generated for it. */
export type Img = {
  /** Path relative to the site root, e.g. `assets/team/arun-v.jpg`. */
  src: string;
  width: number;
  height: number;
  /** `srcset` value; empty when only one size was produced. */
  srcset: string;
  /** Best-guess alt text; callers usually override with something specific. */
  alt: string;
};

/** A prose block: one `.txt`/`.md` file in a page's `text/` folder. */
export type Section = {
  slug: string;
  /** The `NN-` prefix from the filename; orders this against the stories. */
  order: number;
  title: string;
  /**
   * Two-column rows, when the body is a list of `term — detail` lines rather
   * than prose — a list of grants, a list of dates. Empty otherwise.
   */
  entries: ProfileEntry[];
  /** Rendered HTML of the body. */
  html: string;
  /** Plain-text body, used for meta descriptions and excerpts. */
  text: string;
  /** Paired image from the page's `figures/` folder, if one exists. */
  figure: Img | null;
  /** Caption for the figure, from a `caption:` key. */
  caption: string;
  /** Every `key: value` from the header, including ones we do not use. */
  fields: Record<string, string>;
};

/**
 * A research story: one `.txt` file in a page's `stories/` folder.
 *
 * A longer, publication-grounded piece than a `Section` — it carries a kicker,
 * a standfirst, a "why it matters" line and the papers it is built on. Every
 * one of those is optional and renders only when supplied, so a story file with
 * nothing but a body still produces a correct block.
 */
export type Story = {
  slug: string;
  /** The `NN-` prefix from the filename; orders this against the sections. */
  order: number;
  title: string;
  /** Kicker above the heading, from `tag:`. */
  tag: string;
  /** One-sentence standfirst under the heading, from `lead:`. */
  lead: string;
  /** The "why it matters" callout, from `why:`. */
  why: string;
  /** Short card copy for the home page, from `excerpt:`. */
  excerpt: string;
  /** DOIs of the papers behind the story, in the order written. */
  paperDois: string[];
  /**
   * Those DOIs looked up on the publications page, so a story's citations can
   * never drift from the list of papers itself. A DOI that is not listed there
   * still yields an entry — a bare DOI and its link — plus a build warning.
   */
  papers: Publication[];
  /** `home: no` keeps a story off the home page. Everything else is on. */
  onHome: boolean;
  html: string;
  text: string;
  figure: Img | null;
  caption: string;
  fields: Record<string, string>;
};

/** A person on the Team or Alumni page. */
export type Member = {
  slug: string;
  name: string;
  role: string;
  email: string;
  /** One-line research focus, shown under the role. */
  focus: string;
  /** Alumni only: year they finished. */
  year: string;
  /** Alumni only: thesis title. */
  thesis: string;
  /** Alumni only: where they are now. */
  now: string;
  html: string;
  text: string;
  photo: Img | null;
  /** Initials used for the fallback avatar when `photo` is null. */
  initials: string;
  /**
   * Where this person's own page lives, e.g. `team/harikumar-kb/`, or `""` when
   * they have not asked for one with `profile: yes`.
   *
   * Site-root-relative like `Img.src`, for the same reason: the page linking
   * to it resolves it against its own depth.
   */
  profilePath: string;
  /** `## Heading` blocks from below the biography, shown on that page. */
  sections: ProfileSection[];
  /** DOIs from a `papers:` line, in the order written. */
  paperDois: string[];
  /**
   * Those DOIs looked up on the publications page. A DOI nobody has listed
   * there still yields an entry — the DOI itself, with a working link — so a
   * paper that predates the lab's own list can still appear on a person's page.
   */
  papers: Publication[];
  /** Only the profile links the editor actually provided. */
  links: ProfileLink[];
  fields: Record<string, string>;
};

/** One paper. `links` is empty when no identifier was supplied. */
export type Publication = {
  year: string;
  /** The citation with any trailing identifiers stripped off. */
  citation: string;
  /** Citation HTML with lab-member surnames bolded. */
  html: string;
  links: ProfileLink[];
};

export type PublicationYear = {
  year: string;
  items: Publication[];
};

/** An outgoing link (RGCB pages, training, consultancy). */
export type LinkItem = {
  slug: string;
  title: string;
  url: string;
  description: string;
  /** `featured: yes` also surfaces this on the home page. */
  featured: boolean;
};

/** One gallery photo; caption is optional. */
export type GalleryItem = {
  slug: string;
  title: string;
  caption: string;
  photo: Img;
};

/**
 * A named group of photos: one subfolder of a gallery page's `photos/`.
 *
 * Albums exist because a gallery grows by the year — a Christmas dinner, a
 * conference, three thesis defences — and one endless grid of photographs
 * hides all of that. A folder is the whole authoring interface: drop
 * `photos/christmas-2025/` in and it becomes an album, with or without the
 * optional `album.txt` describing it.
 */
export type Album = {
  slug: string;
  title: string;
  /** Free-text line under the title, from `date:`. Never parsed as a date. */
  date: string;
  /** One-line description, from `caption:` or the body of `album.txt`. */
  caption: string;
  /** The photo shown on top of the stack; `items[0]` unless `cover:` says otherwise. */
  cover: GalleryItem;
  items: GalleryItem[];
};

/** What kind of content a page folder holds, inferred from its name. */
export type PageKind =
  | "home"
  | "research"
  | "team"
  | "alumni"
  | "publications"
  | "gallery"
  | "contact"
  | "links"
  | "resources";

/** One line of a roster: a person and where they came from. */
export type RosterEntry = {
  name: string;
  /** College or institution. Empty when the editor gave only a name. */
  affiliation: string;
};

/**
 * A plain list of people who pass through the lab in numbers too large for a
 * card each — visiting trainees, MSc project students. Rendered collapsed.
 */
export type Roster = {
  title: string;
  entries: RosterEntry[];
};

/**
 * One file a reader can download from a resource item.
 *
 * The file is copied out of `content/` verbatim under its own name, because a
 * hashed filename in the Downloads folder is useless to someone who has just
 * fetched three analysis scripts and wants to know which is which.
 */
export type Download = {
  /** Path relative to the site root, e.g. `assets/resources/code-blocks/deseq2/run.R`. */
  src: string;
  /** The filename as the editor wrote it, e.g. `run.R`. */
  name: string;
  /** Lowercase extension without the dot, e.g. `r`, `ipynb`, `py`. */
  ext: string;
  /** Size in bytes, shown next to the download so nobody is surprised. */
  bytes: number;
  /**
   * The file's own text, when it is small enough and plainly textual. Shown
   * on the page so a reader can judge a script before downloading it. Empty
   * for notebooks, archives and anything binary or oversized.
   */
  preview: string;
};

/**
 * One repository or code block: a folder with an `item.txt` in it.
 *
 * The folder is the whole authoring interface. Drop `03-coco-repo/` into
 * `1-repositories/` and it becomes a card on the Resources page and a page of
 * its own — no list to update anywhere else.
 */
export type ResourceItem = {
  slug: string;
  order: number;
  title: string;
  /** One-line summary for the card, from `summary:` or the first sentence. */
  summary: string;
  /** What it does / how to run it: the body of `item.txt`, as HTML. */
  html: string;
  text: string;
  /**
   * The repository this item lives in, when there is one. A code block may
   * carry one too — a script pulled out of a repo is still worth linking back.
   */
  repo: ProfileLink | null;
  /** Any other links given in the header: `doi:`, `docs:`, `paper:`, `url:`. */
  links: ProfileLink[];
  /** Free-text line under the title, from `language:` — `R`, `Python`, … */
  language: string;
  /** Files in the item's folder, offered for download. */
  downloads: Download[];
  /** `## Heading` blocks, rendered in order below the body. */
  sections: ProfileSection[];
  /** Where this item's page lives, e.g. `resources/code-blocks/deseq2/`. */
  path: string;
  fields: Record<string, string>;
};

/**
 * A branch of the Resources page: one subfolder holding items.
 *
 * Repositories and code blocks are the two the lab started with, but nothing
 * here names them — a third folder becomes a third branch with no code change.
 */
export type ResourceGroup = {
  slug: string;
  order: number;
  title: string;
  /** Shown under the heading, from `group.txt`. */
  lead: string;
  items: ResourceItem[];
};

export type Page = {
  /** URL slug with the ordering prefix removed, e.g. `research`. */
  slug: string;
  /** Nav label, from `page.txt` `title:` or derived from the folder name. */
  title: string;
  /** Short line rendered under the page title in the banner. */
  tagline: string;
  /** Rendered body of `page.txt`, shown above the page's main content. */
  introHtml: string;
  kind: PageKind;
  order: number;
  /** Output path relative to the site root; `""` for the home page. */
  outDir: string;
  /** Images in `banner/`. 0 = gradient, 1 = static banner, 2+ = carousel. */
  banners: Img[];
  sections: Section[];
  /** Research stories from `stories/`, merged with `sections` by `order`. */
  stories: Story[];
  members: Member[];
  publicationYears: PublicationYear[];
  /**
   * Papers the PI is on that are not the lab's own work — his doctoral and
   * post-doctoral years, and the studies he has guided or collaborated on
   * elsewhere. Kept apart from `publicationYears` so the lab's own output can
   * be counted and read on its own, and maintained in its own folder so
   * moving a paper between the two is a matter of moving a paragraph.
   */
  piPublicationYears: PublicationYear[];
  links: LinkItem[];
  /** Branches of a Resources page: repositories, code blocks, anything else. */
  resourceGroups: ResourceGroup[];
  gallery: GalleryItem[];
  /** Photo albums from subfolders of `photos/`, shown as stacks. */
  albums: Album[];
  /** Collapsible name lists from `lists/`, shown below the cards. */
  rosters: Roster[];
  fields: Record<string, string>;
};

export type SiteConfig = {
  name: string;
  /**
   * The lab's own name, e.g. `KBH Lab`, when it differs from the programme
   * name. Shown as the home page heading, with `name` above it. Left out, the
   * home page leads with `name` as it always has.
   */
  labName: string;
  /** Where the site is published, e.g. `https://kbh-lab-rgcb.github.io`. Used
   * only for the absolute URLs that link previews and search engines need. */
  url: string;
  shortName: string;
  tagline: string;
  description: string;
  pi: { name: string; title: string; email: string };
  institute: string;
  address: string[];
  phones: { label: string; value: string }[];
  emails: { label: string; value: string }[];
  /** Surnames auto-bolded in citations. */
  labAuthors: string[];
  footerNote: string;
};

export type Warning = {
  /** Path relative to the repo root, so the message points at a real file. */
  file: string;
  message: string;
  /** What the build did instead. */
  fallback: string;
};

export type Site = {
  config: SiteConfig;
  pages: Page[];
  warnings: Warning[];
};
