/**
 * Walks `content/` and produces the typed site model.
 *
 * The contract this file exists to keep: **loading never throws**. A missing
 * file, an empty folder, a photo with no matching text, a corrupt image — each
 * becomes a `Warning` plus a sensible fallback, and the site still builds. The
 * people editing this content do so in a browser and cannot debug a failed CI
 * run, so a degraded page always beats a red X.
 */

import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { esc } from "../html.ts";
import { createFilePipeline, type FilePipeline } from "./files.ts";
import { createImagePipeline, IMAGE_EXTENSIONS, listImages } from "./images.ts";
import {
  excerpt,
  field,
  flag,
  initialsOf,
  parseCitation,
  parseDoc,
  parseDoiList,
  parseProfile,
  parseEntries,
  renderBlock,
  parseName,
  plainText,
  profileLinks,
  renderMarkdown,
  boldAuthors,
  titleFromSlug,
} from "./text.ts";
import type {
  Album,
  Download,
  GalleryItem,
  Img,
  LinkItem,
  Member,
  Page,
  PageKind,
  Publication,
  ProfileLink,
  PublicationYear,
  ResourceGroup,
  ResourceItem,
  Roster,
  RosterEntry,
  Section,
  Site,
  SiteConfig,
  Story,
  Warning,
} from "./types.ts";

const TEXT_EXTENSIONS = [".txt", ".md", ".markdown"];

/** Folder-name patterns that select a page renderer. Order matters. */
const KIND_RULES: [RegExp, PageKind][] = [
  [/^(home|index|welcome|profile)$/, "home"],
  [/(team|people|members|group)/, "team"],
  [/alumni|former/, "alumni"],
  [/publication|papers/, "publications"],
  [/gallery|photos|album/, "gallery"],
  [/contact|reach|find-us/, "contact"],
  // Before the links rule, which would otherwise swallow `10-resources`.
  [/resource|download|toolkit|code|repo/, "resources"],
  [/link|outreach|elsewhere/, "links"],
];

function kindFor(slug: string): PageKind {
  for (const [pattern, kind] of KIND_RULES) {
    if (pattern.test(slug)) return kind;
  }
  // Anything unrecognised renders as prose sections with optional figures,
  // so adding `09-facilities/` gives a working page with no code change.
  return "research";
}

async function listTextFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter(
        (entry) =>
          entry.isFile() &&
          TEXT_EXTENSIONS.includes(extname(entry.name).toLowerCase()) &&
          !entry.name.startsWith(".") &&
          entry.name.toLowerCase() !== "readme.md",
      )
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  } catch {
    return [];
  }
}

async function listDirs(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  } catch {
    return [];
  }
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

const DEFAULT_CONFIG: SiteConfig = {
  name: "Research Lab",
  labName: "",
  url: "",
  shortName: "Lab",
  tagline: "",
  description: "",
  pi: { name: "", title: "", email: "" },
  institute: "",
  address: [],
  phones: [],
  emails: [],
  labAuthors: [],
  footerNote: "",
};

async function loadConfig(contentDir: string, warnings: Warning[]): Promise<SiteConfig> {
  const path = join(contentDir, "site.json");
  const raw = await readIfPresent(path);
  if (!raw) {
    warnings.push({
      file: "content/site.json",
      message: "Site settings file is missing.",
      fallback: "Placeholder lab details were used.",
    });
    return DEFAULT_CONFIG;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SiteConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      pi: { ...DEFAULT_CONFIG.pi, ...(parsed.pi ?? {}) },
      address: parsed.address ?? [],
      phones: parsed.phones ?? [],
      emails: parsed.emails ?? [],
      labAuthors: parsed.labAuthors ?? [],
    };
  } catch (error) {
    warnings.push({
      file: "content/site.json",
      message: `Site settings file is not valid JSON (${(error as Error).message}).`,
      fallback: "Placeholder lab details were used. Check for a missing comma or quote.",
    });
    return DEFAULT_CONFIG;
  }
}

/* ------------------------------------------------------------------ *
 * Loaders for each kind of folder
 * ------------------------------------------------------------------ */

type Ctx = {
  pageDir: string;
  relDir: string;
  slug: string;
  images: Awaited<ReturnType<typeof createImagePipeline>>;
  files: FilePipeline;
  warnings: Warning[];
};

/**
 * Below this, a banner is visibly soft.
 *
 * A banner is stretched the full width of the window, so it is the one place on
 * the site where a small image cannot hide. The usual culprit is a picture
 * pasted into Word or PowerPoint and exported as SVG: the result is a thumbnail
 * wrapped in a vector shell, and no amount of CSS can put the detail back.
 */
const BANNER_MIN_WIDTH = 1200;

/**
 * Spots a photo that was pasted into Word or PowerPoint and exported as SVG.
 *
 * That export is not a vector drawing. It is a small bitmap wrapped in an SVG
 * shell and blown up by a `transform`, so it looks right in the editor and
 * turns to mush the moment it is stretched across a banner. Its declared size
 * is no help either — the shell claims whatever the slide was, and the file
 * reports as 1600x900 while the actual picture inside it is 32 pixels wide.
 * Reading the markup is the only way to see the difference.
 *
 * @returns the embedded bitmap's width, or null if this is a real vector file.
 */
function embeddedBitmapWidth(svg: string): number | null {
  const tag = svg.match(/<image\b[^>]*>/i)?.[0];
  if (!tag || !/href="data:image\//i.test(tag)) return null;
  const width = Number(tag.match(/\bwidth="(\d+)"/i)?.[1]);
  return Number.isFinite(width) && width > 0 ? width : null;
}

/** Files that belong in a banner folder without being banners. */
const NOT_A_BANNER = /^(readme\.md|\.|.*\.bak$)/i;

async function loadBanners(ctx: Ctx): Promise<Img[]> {
  const dir = join(ctx.pageDir, "banner");
  const files = await listImages(dir);
  const banners: Img[] = [];

  /*
   * Say something about files that were dropped here and quietly ignored.
   * "I added the picture and nothing happened" is the worst thing that can
   * happen to an editor who cannot read a build log, so an unusable format is
   * named rather than skipped in silence.
   */
  if (existsSync(dir)) {
    const everything = await readdir(dir).catch(() => [] as string[]);
    for (const name of everything) {
      if (files.includes(name) || NOT_A_BANNER.test(name)) continue;
      ctx.warnings.push({
        file: `${ctx.relDir}/banner/${name}`,
        message: `This file is not an image format the site can publish, so it was skipped.`,
        fallback: `Save it as .jpg and add that instead. Accepted: ${IMAGE_EXTENSIONS.join(" ")}`,
      });
    }
  }

  for (const file of files) {
    const path = join(dir, file);
    const image = await ctx.images.process(path, `${ctx.slug}`, "");
    if (!image) continue;

    // Published either way — a soft banner is still a banner. The editor just
    // gets told why it looks the way it does, and what to do about it.
    const advice =
      `Save the original photo as a .jpg at least ${BANNER_MIN_WIDTH}px wide and ` +
      `put that in the banner folder instead.`;

    if (extname(file).toLowerCase() === ".svg") {
      const raw = await readFile(path, "utf8").catch(() => "");
      const bitmap = embeddedBitmapWidth(raw);
      if (bitmap !== null && bitmap < BANNER_MIN_WIDTH) {
        ctx.warnings.push({
          file: `${ctx.relDir}/banner/${file}`,
          message:
            `This looks like a photo exported to SVG from Word or PowerPoint: the ` +
            `picture inside it is only ${bitmap} pixels wide, however large the file claims to be.`,
          fallback: `It is on the site, but the banner will look blurry. ${advice}`,
        });
      }
    } else if (image.width > 0 && image.width < BANNER_MIN_WIDTH) {
      ctx.warnings.push({
        file: `${ctx.relDir}/banner/${file}`,
        message: `This banner image is only ${image.width}×${image.height} pixels.`,
        fallback: `It is on the site, but stretched across the banner it will look blurry. ${advice}`,
      });
    }

    banners.push(image);
  }

  return banners;
}

/**
 * Pairs a slug with an image in the page's `figures/` folder.
 *
 * The site's one filename rule, shared by sections and stories so that
 * `figures/04-pancreatic-stroma.jpg` pairs with `04-pancreatic-stroma.txt`
 * whichever of the two folders that file happens to live in.
 */
async function figurePairer(ctx: Ctx): Promise<(slug: string, alt: string) => Promise<Img | null>> {
  const figuresDir = join(ctx.pageDir, "figures");
  const bySlug = new Map<string, string>();
  for (const file of await listImages(figuresDir)) bySlug.set(parseName(file).slug, file);

  return async (slug, alt) => {
    const file = bySlug.get(slug);
    if (!file) return null;
    return ctx.images.process(join(figuresDir, file), `${ctx.slug}`, alt);
  };
}

async function loadSections(ctx: Ctx): Promise<Section[]> {
  const textDir = join(ctx.pageDir, "text");
  const files = await listTextFiles(textDir);
  const figureFor = await figurePairer(ctx);

  // Files already arrive in numeric-aware alphabetical order, so the `NN-`
  // prefix orders sections without any extra sorting here. `order` is kept
  // anyway, because the research page interleaves these with its stories.
  const sections: Section[] = [];
  for (const file of files) {
    const { order, slug } = parseName(file);
    const raw = (await readIfPresent(join(textDir, file))) ?? "";
    const { fields, body } = parseDoc(raw);

    if (!body.trim() && !field(fields, "title")) {
      ctx.warnings.push({
        file: `${ctx.relDir}/text/${file}`,
        message: "This text file is empty.",
        fallback: "A heading was shown using the file name.",
      });
    }

    // A section can be a list of grants as easily as a paragraph, and the same
    // `term — detail` convention reads it here as it does on a person's page.
    const entries = parseEntries(body);

    sections.push({
      slug,
      order,
      title: field(fields, "title", "heading") || titleFromSlug(slug),
      entries: entries ?? [],
      html: entries ? "" : renderBlock(body),
      text: plainText(body),
      figure: await figureFor(
        slug,
        field(fields, "caption", "alt") || field(fields, "title") || titleFromSlug(slug),
      ),
      caption: field(fields, "caption"),
      fields,
    });
  }
  return sections;
}

/**
 * Reads `stories/` into research stories.
 *
 * One file per story, and every line above the body is optional:
 *
 * ```text
 * title: From a spice-derived molecule to a colorectal cancer programme
 * tag: Natural products · Colorectal cancer
 * lead: One sentence saying what the work found.
 * why: Why it matters, in a sentence or two.
 * excerpt: The short version, used on the home page.
 * papers: 10.1038/s41598-017-14253-8, 10.3390/biom11050661
 *
 * The background research, in paragraphs.
 * ```
 *
 * Leave a line out and that part is simply not drawn — the same only-if-added
 * rule the profile links follow — so a file containing nothing but a title and
 * a paragraph is a perfectly good story, and someone filling one in over
 * several sittings never sees a half-built page.
 */
async function loadStories(ctx: Ctx): Promise<Story[]> {
  const dir = join(ctx.pageDir, "stories");
  if (!existsSync(dir)) return [];

  const figureFor = await figurePairer(ctx);
  const stories: Story[] = [];

  for (const file of await listTextFiles(dir)) {
    const { order, slug } = parseName(file);
    const raw = (await readIfPresent(join(dir, file))) ?? "";
    const { fields, body } = parseDoc(raw);
    const title = field(fields, "title", "heading") || titleFromSlug(slug);

    if (!body.trim() && !field(fields, "title")) {
      ctx.warnings.push({
        file: `${ctx.relDir}/stories/${file}`,
        message: "This story file is empty.",
        fallback: "A heading was shown using the file name. See the README in that folder.",
      });
    }

    const papers = field(fields, "papers", "paper", "publications", "doi");
    const paperDois = parseDoiList(papers);
    if (papers && paperDois.length === 0) {
      ctx.warnings.push({
        file: `${ctx.relDir}/stories/${file}`,
        message: `No DOI could be read from “papers: ${papers}”.`,
        fallback:
          "The story was published without its papers. A DOI looks like 10.3390/biom11050661.",
      });
    }

    stories.push({
      slug,
      order,
      title,
      tag: field(fields, "tag", "eyebrow", "kicker", "topic"),
      lead: field(fields, "lead", "standfirst", "summary"),
      why: field(fields, "why", "whyitmatters", "significance"),
      excerpt: field(fields, "excerpt", "card", "short"),
      paperDois,
      // Filled in once every page is loaded, by `resolveCitedPapers`.
      papers: [],
      // Silence is consent: a story is on the home page unless it says not to,
      // so adding a file is the only step there is.
      onHome: !/^(no|n|false|off|0)$/i.test(field(fields, "home", "homepage")),
      html: renderMarkdown(body),
      text: plainText(body),
      figure: await figureFor(slug, field(fields, "caption", "alt") || title),
      caption: field(fields, "caption"),
      fields,
    });
  }
  return stories;
}

/**
 * Load people from paired `photos/` and `text/` folders.
 *
 * The slug set is the **union** of both folders, which is the crux of the whole
 * design: a photo with no text still produces a card (name from the filename),
 * and text with no photo produces a card with an initials avatar. Neither is an
 * error, because both are normal intermediate states when two people are each
 * adding half of an entry.
 */
async function loadMembers(
  ctx: Ctx,
  isAlumni: boolean,
  labAuthors: string[],
): Promise<Member[]> {
  const photosDir = join(ctx.pageDir, "photos");
  const textDir = join(ctx.pageDir, "text");
  const photoFiles = await listImages(photosDir);
  const textFiles = await listTextFiles(textDir);

  type Entry = { order: number; photo?: string; text?: string };
  const entries = new Map<string, Entry>();

  const upsert = (slug: string, order: number, patch: Partial<Entry>) => {
    const existing = entries.get(slug) ?? { order };
    entries.set(slug, { ...existing, ...patch, order: Math.min(existing.order, order) });
  };

  for (const file of photoFiles) {
    const { order, slug } = parseName(file);
    upsert(slug, order, { photo: file });
  }
  for (const file of textFiles) {
    const { order, slug } = parseName(file);
    upsert(slug, order, { text: file });
  }

  const sorted = [...entries.entries()].sort(
    ([aSlug, a], [bSlug, b]) => a.order - b.order || aSlug.localeCompare(bSlug),
  );

  const members: Member[] = [];
  for (const [slug, entry] of sorted) {
    const raw = entry.text ? ((await readIfPresent(join(textDir, entry.text))) ?? "") : "";
    const { fields, body } = parseDoc(raw);

    if (!entry.text) {
      ctx.warnings.push({
        file: `${ctx.relDir}/photos/${entry.photo}`,
        message: "This photo has no matching text file.",
        fallback: `The name was taken from the file name. Add ${ctx.relDir}/text/${slug}.txt for a role and biography.`,
      });
    }

    const name = field(fields, "name") || titleFromSlug(slug);
    const photo = entry.photo
      ? await ctx.images.process(
          join(photosDir, entry.photo),
          ctx.slug,
          name,
        )
      : null;

    if (!photo && entry.text) {
      ctx.warnings.push({
        file: `${ctx.relDir}/text/${entry.text}`,
        message: "This person has no photo.",
        fallback: `Their initials are shown instead. Add ${ctx.relDir}/photos/${slug}.jpg for a portrait.`,
      });
    }

    // `## Heading` blocks are a CV, not a card. They are split off here so the
    // team page stays a page of cards however long anybody's CV becomes.
    const { intro, sections } = parseProfile(body, labAuthors);
    const wantsPage = flag(field(fields, "profile", "page", "ownpage"));

    if (sections.length > 0 && !wantsPage) {
      ctx.warnings.push({
        file: `${ctx.relDir}/text/${entry.text}`,
        message: "This person has extra `## sections` but no `profile: yes` line.",
        fallback:
          "The sections are shown on their card for now. Add `profile: yes` to give them a page of their own instead.",
      });
    }

    members.push({
      slug,
      name,
      role: field(fields, "role", "designation", "position") || (isAlumni ? "Alumnus" : "Lab member"),
      email: field(fields, "email"),
      focus: field(fields, "focus", "research", "topic", "project"),
      year: field(fields, "year", "graduated"),
      thesis: field(fields, "thesis", "title"),
      now: field(fields, "now", "current", "currentposition", "placement"),
      // Without a page to put them on, the sections stay on the card: content
      // somebody typed is never silently dropped.
      html: renderMarkdown(wantsPage ? intro : body),
      text: plainText(wantsPage ? intro : body),
      photo,
      initials: initialsOf(name),
      profilePath: wantsPage ? `${ctx.slug}/${slug}/` : "",
      sections,
      // Resolved against the publications page once every page is loaded, in
      // `resolveCitedPapers` — a DOI listed here that nobody has added to that
      // page still appears, as itself.
      paperDois: parseDoiList(field(fields, "papers", "publications")),
      papers: [],
      links: profileLinks(fields),
      fields,
    });
  }
  return members;
}

/**
 * One folder of `YYYY.txt` files.
 *
 * Called twice: once for `years/`, the lab's own papers, and once for `pi/`,
 * the ones the PI is on that are not this lab's work. Two folders rather than
 * a flag inside the files because the question "is this ours?" is answered by
 * moving a paragraph between two files, which is the one editing operation
 * everybody can already do.
 *
 * @param folder Subfolder to read, e.g. `years`.
 * @param loose Whether to fall back to the page folder itself when the
 *   subfolder is missing. True only for `years/`: without it a page that has
 *   no `pi/` folder would read every citation twice.
 */
async function loadPublications(
  ctx: Ctx,
  labAuthors: string[],
  folder: string,
  loose: boolean,
): Promise<PublicationYear[]> {
  // `years/` is the documented home, but tolerate files sitting directly in the
  // page folder too — an editor who drops `2025.txt` one level up still works.
  const yearsDir = existsSync(join(ctx.pageDir, folder))
    ? join(ctx.pageDir, folder)
    : loose
      ? ctx.pageDir
      : "";
  if (!yearsDir) return [];
  const files = (await listTextFiles(yearsDir)).filter((file) => /\d{4}/.test(file));

  const groups: PublicationYear[] = [];
  for (const file of files) {
    const year = /(\d{4})/.exec(basename(file))?.[1] ?? "";
    const raw = (await readIfPresent(join(yearsDir, file))) ?? "";
    const items: Publication[] = [];

    // Entries are separated by blank lines so a long citation may wrap across
    // several lines — which is what happens when someone pastes from a PDF.
    for (const block of raw.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
      const line = block.replace(/\n/g, " ").trim();
      if (!line || line.startsWith("#")) continue;
      const { citation, links } = parseCitation(line);
      if (!citation) continue;
      items.push({ year, citation, html: boldAuthors(citation, labAuthors), links });
    }

    if (items.length === 0) {
      ctx.warnings.push({
        file: `${ctx.relDir}/${folder}/${file}`,
        message: "No publications were found in this file.",
        fallback: "The year was left out. Put one citation per paragraph.",
      });
      continue;
    }
    groups.push({ year, items });
  }

  return groups.sort((a, b) => b.year.localeCompare(a.year));
}

async function loadLinks(ctx: Ctx): Promise<LinkItem[]> {
  const dir = existsSync(join(ctx.pageDir, "links")) ? join(ctx.pageDir, "links") : ctx.pageDir;
  const files = await listTextFiles(dir);
  const links: LinkItem[] = [];

  for (const file of files) {
    const { slug } = parseName(file);
    const raw = (await readIfPresent(join(dir, file))) ?? "";
    const { fields, body } = parseDoc(raw);
    const url = field(fields, "url", "link", "href");

    if (!url) {
      ctx.warnings.push({
        file: `${ctx.relDir}/links/${file}`,
        message: "This link has no web address.",
        fallback: "It was left out. Add a line such as `url: https://rgcb.res.in/...`.",
      });
      continue;
    }

    links.push({
      slug,
      title: field(fields, "title", "name") || titleFromSlug(slug),
      url,
      description: field(fields, "description", "summary") || excerpt(body, 160),
      featured: flag(field(fields, "featured", "front", "home")),
    });
  }
  return links;
}

/**
 * Reads `lists/` into collapsible name rosters.
 *
 * One file per list, one person per line. A card each would drown the alumni
 * page — these are the people who pass through in tens — so the format is as
 * close to typing out a list as it can be:
 *
 * ```text
 * title: Trainees from other institutions
 *
 * Anjali Nair — St Teresa's College, Ernakulam
 * Rahul Menon, Government College Kariavattom
 * ```
 *
 * The separator may be an em dash, an en dash, a hyphen or a comma, because
 * which one an editor reaches for depends entirely on their keyboard. A line
 * with no separator at all is still a valid entry — it is just a name.
 */
async function loadRosters(ctx: Ctx): Promise<Roster[]> {
  const dir = join(ctx.pageDir, "lists");
  if (!existsSync(dir)) return [];

  const rosters: Roster[] = [];
  for (const file of await listTextFiles(dir)) {
    const { slug } = parseName(file);
    const raw = (await readIfPresent(join(dir, file))) ?? "";
    const { fields, body } = parseDoc(raw);

    const entries: RosterEntry[] = [];
    for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
      const text = line.trim().replace(/^[-*•]\s*/, "");
      if (!text || text.startsWith("#")) continue;
      const [, name, affiliation = ""] = /^(.*?)(?:\s*[—–]\s*|\s+-\s+|\s*,\s*)(.*)$/.exec(text) ?? [
        "",
        text,
      ];
      if (name.trim()) entries.push({ name: name.trim(), affiliation: affiliation.trim() });
    }

    if (entries.length === 0) {
      ctx.warnings.push({
        file: `${ctx.relDir}/lists/${file}`,
        message: "This list has no names in it.",
        fallback: "It was left out. Add one person per line, as `Name — College`.",
      });
      continue;
    }

    rosters.push({
      title: field(fields, "title", "name") || titleFromSlug(slug),
      entries,
    });
  }
  return rosters;
}

/**
 * The photos in one folder, with their optional captions.
 *
 * Captions are genuinely optional — requiring a text file per photo would make
 * uploading an album unbearable. They are looked for in `captionDirs`, in
 * order: beside the photo, which is how an album is written so that one folder
 * holds everything about it, and then the page's `text/` folder, which is how
 * the flat gallery has always been written.
 */
async function loadPhotos(
  ctx: Ctx,
  photosDir: string,
  assetDir: string,
  captionDirs: string[],
): Promise<GalleryItem[]> {
  const textBySlug = new Map<string, string>();
  for (const dir of captionDirs) {
    for (const file of await listTextFiles(dir)) {
      const { slug } = parseName(file);
      // `album.txt` describes the folder itself, not a photo in it.
      if (slug === "album") continue;
      if (!textBySlug.has(slug)) textBySlug.set(slug, join(dir, file));
    }
  }

  const items: GalleryItem[] = [];
  for (const file of await listImages(photosDir)) {
    const { slug } = parseName(file);
    const textPath = textBySlug.get(slug);
    const raw = textPath ? ((await readIfPresent(textPath)) ?? "") : "";
    const { fields, body } = parseDoc(raw);
    const title = field(fields, "title", "caption") || titleFromSlug(slug);
    const photo = await ctx.images.process(join(photosDir, file), assetDir, title);
    if (!photo) continue;
    items.push({ slug, title, caption: field(fields, "caption") || plainText(body), photo });
  }
  return items;
}

/** Photos dropped straight into `photos/`, outside any album. */
async function loadGallery(ctx: Ctx): Promise<GalleryItem[]> {
  return loadPhotos(ctx, join(ctx.pageDir, "photos"), ctx.slug, [join(ctx.pageDir, "text")]);
}

/**
 * One album per subfolder of `photos/`.
 *
 * Making a folder the entire authoring interface is the point: an editor who
 * can drag photos into `photos/` can just as easily drag them into
 * `photos/christmas-2025/`, and that alone produces a titled album. `album.txt`
 * only exists for the cases where the folder name is not a good enough title.
 *
 * Order is by folder name, as everywhere else in this file, so `01-` prefixes
 * put albums in a deliberate sequence and unprefixed folders sort after them.
 */
async function loadAlbums(ctx: Ctx): Promise<Album[]> {
  const photosDir = join(ctx.pageDir, "photos");
  const albums: Album[] = [];

  for (const folder of await listDirs(photosDir)) {
    const { slug } = parseName(folder);
    const dir = join(photosDir, folder);
    const raw =
      (await readIfPresent(join(dir, "album.txt"))) ??
      (await readIfPresent(join(dir, "album.md"))) ??
      "";
    const { fields, body } = parseDoc(raw);

    // Each album gets its own folder under `assets/`, so a build output stays
    // as browsable as the content folder it came from.
    const items = await loadPhotos(ctx, dir, `${ctx.slug}/${slug}`, [
      dir,
      join(ctx.pageDir, "text"),
    ]);

    if (items.length === 0) {
      ctx.warnings.push({
        file: `${ctx.relDir}/photos/${folder}`,
        message: "This album folder has no photos in it.",
        fallback: "The album was left out. Add photos to the folder, or delete it.",
      });
      continue;
    }

    // The cover is the photo on top of the stack. Naming one is optional; the
    // first photo in the folder is a perfectly good cover.
    const wanted = field(fields, "cover", "thumbnail");
    const wantedSlug = wanted ? parseName(wanted).slug : "";
    const cover = items.find((item) => item.slug === wantedSlug) ?? items[0]!;
    if (wantedSlug && cover.slug !== wantedSlug) {
      ctx.warnings.push({
        file: `${ctx.relDir}/photos/${folder}/album.txt`,
        message: `No photo in this album is called "${wanted}", so it cannot be the cover.`,
        fallback: `The first photo in the folder is on top of the stack instead.`,
      });
    }

    albums.push({
      slug,
      title: field(fields, "title", "name") || titleFromSlug(slug),
      date: field(fields, "date", "when"),
      caption: field(fields, "caption", "description", "about") || plainText(body),
      cover,
      items,
    });
  }

  return albums;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * Turn every `papers:` DOI — a story's and a person's — back into the citation
 * the publications page prints.
 *
 * Runs once every page is loaded, because a story on the research page and a
 * person on the team page both cite papers listed on another page entirely.
 * The point of citing by DOI is that there is one copy of each citation on the
 * site: correct a typo in an author list and it is corrected everywhere it
 * appears.
 *
 * A DOI nobody has listed yet still renders — as itself, with a working link —
 * and produces a warning naming the folder to add it to. That is the usual
 * bargain here: the page is never worse than slightly plain, and the editor is
 * told what would make it better.
 */
/* ------------------------------------------------------------- Resources */

/**
 * Subfolders of a page that are never a resource branch.
 *
 * Everything else *is* one, which is the point: `1-repositories/` and
 * `2-code-blocks/` are not named anywhere in this file, so `3-datasets/`
 * becomes a third branch by existing.
 */
const RESERVED_FOLDERS = new Set([
  "banner",
  "text",
  "figures",
  "photos",
  "stories",
  "lists",
  "links",
  "years",
  "pi",
]);

/** Header keys on an `item.txt` that become links, in the order shown. */
const RESOURCE_LINK_KEYS: [string, string, string][] = [
  ["repo", "github", "Repository"],
  ["github", "github", "GitHub"],
  ["gitlab", "github", "GitLab"],
  ["colab", "external", "Open in Colab"],
  ["binder", "external", "Launch on Binder"],
  ["zenodo", "doi", "Zenodo"],
  ["doi", "doi", "DOI"],
  ["paper", "pubmed", "Paper"],
  ["docs", "document", "Documentation"],
  ["demo", "external", "Demo"],
  ["url", "url", "Website"],
  ["website", "url", "Website"],
];

/** A header value that is only useful if it is a real, absolute address. */
function absoluteUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^(www\.|github\.com|gitlab\.com)/i.test(trimmed)
      ? `https://${trimmed}`
      : // `owner/name` is how everybody writes a repository.
        /^[\w.-]+\/[\w.-]+$/.test(trimmed)
        ? `https://github.com/${trimmed}`
        : null;
  if (!withScheme) return null;
  try {
    return new URL(withScheme).href;
  } catch {
    return null;
  }
}

/**
 * One repository or code block: one folder with an `item.txt` in it.
 *
 * A folder with no `item.txt` still becomes an item — titled from its own
 * name, with its files downloadable — because a script somebody uploaded and
 * has not described yet is far more useful published than withheld.
 */
async function loadResourceItem(
  ctx: Ctx,
  groupDir: string,
  groupRelDir: string,
  groupSlug: string,
  dirName: string,
): Promise<ResourceItem> {
  const { order, slug } = parseName(dirName);
  const itemDir = join(groupDir, dirName);

  const textFiles = await listTextFiles(itemDir);
  const descFile =
    textFiles.find((file) => /^(item|index)\.(txt|md|markdown)$/i.test(file)) ?? textFiles[0] ?? "";
  const doc = parseDoc(descFile ? ((await readIfPresent(join(itemDir, descFile))) ?? "") : "");
  const { intro, sections } = parseProfile(doc.body);

  const title = field(doc.fields, "title", "name") || titleFromSlug(slug);
  const text = plainText(intro);

  const links: ProfileLink[] = [];
  let repo: ProfileLink | null = null;
  for (const [key, kind, label] of RESOURCE_LINK_KEYS) {
    const url = absoluteUrl(field(doc.fields, key));
    if (!url || links.some((link) => link.url === url) || repo?.url === url) continue;
    const link: ProfileLink = { kind, label: field(doc.fields, `${key}label`) || label, url };
    // The repository is pulled out of the list because it is the headline
    // action on a repo card — and a code block may carry one too, pointing at
    // wherever the script actually lives.
    if (!repo && /^(repo|github|gitlab)$/.test(key)) repo = link;
    else links.push(link);
  }

  // Everything in the folder except the file that describes it. The walk is
  // recursive, so a whole repository dropped inside a code block keeps its
  // shape rather than collapsing into a flat pile.
  const downloads: Download[] = [];
  for (const name of await ctx.files.walk(itemDir)) {
    if (name === descFile || /^readme\.md$/i.test(name)) continue;
    const file = await ctx.files.copy(
      join(itemDir, ...name.split("/")),
      `${ctx.slug}/${groupSlug}/${slug}`,
      name,
    );
    if (file) downloads.push(file);
  }

  if (!descFile) {
    ctx.warnings.push({
      file: `${groupRelDir}/${dirName}/`,
      message: "This resource has no `item.txt`, so nothing explains what it is.",
      fallback: `It is listed as “${title}” with its files available to download.`,
    });
  }

  return {
    slug,
    order,
    title,
    summary:
      field(doc.fields, "summary", "description", "lead", "tagline") || excerpt(text, 160),
    html: renderMarkdown(intro),
    text,
    repo,
    links,
    language: field(doc.fields, "language", "lang", "runtime"),
    downloads,
    sections,
    path: `${ctx.slug}/${groupSlug}/${slug}/`,
    fields: doc.fields,
  };
}

/**
 * The branches of a Resources page, each holding its items.
 *
 * Two levels of folder and nothing else: the branch is a folder, an item is a
 * folder inside it. Adding `1-repositories/03-coco-repo/` is the whole of
 * "publish a new repository" — the card, the page and the download all follow
 * from the folder being there.
 */
async function loadResourceGroups(ctx: Ctx): Promise<ResourceGroup[]> {
  const groups: ResourceGroup[] = [];

  for (const dirName of await listDirs(ctx.pageDir)) {
    if (RESERVED_FOLDERS.has(dirName.toLowerCase())) continue;

    const { order, slug } = parseName(dirName);
    const groupDir = join(ctx.pageDir, dirName);
    const groupRelDir = `${ctx.relDir}/${dirName}`;
    const meta = parseDoc((await readIfPresent(join(groupDir, "group.txt"))) ?? "");

    const items: ResourceItem[] = [];
    for (const itemDir of await listDirs(groupDir)) {
      items.push(await loadResourceItem(ctx, groupDir, groupRelDir, slug, itemDir));
    }
    items.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

    if (items.length === 0) {
      ctx.warnings.push({
        file: `${groupRelDir}/`,
        message: "This resource branch has no items in it yet.",
        fallback: `It was left off the page. Add a folder such as ${dirName}/01-my-repo/.`,
      });
      continue;
    }

    groups.push({
      slug,
      order,
      title: field(meta.fields, "title", "name") || titleFromSlug(slug),
      lead: field(meta.fields, "tagline", "lead", "summary") || plainText(meta.body),
      items,
    });
  }

  return groups.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
}

function resolveCitedPapers(
  pages: Page[],
  sources: { relDir: string; stories: Story[] }[],
  warnings: Warning[],
): void {
  const byDoi = new Map<string, Publication>();
  for (const page of pages) {
    for (const year of [...page.publicationYears, ...page.piPublicationYears]) {
      for (const item of year.items) {
        for (const link of item.links) {
          if (link.kind !== "doi") continue;
          const doi = link.url.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").toLowerCase();
          if (!byDoi.has(doi)) byDoi.set(doi, item);
        }
      }
    }
  }

  /** The DOI on its own, with a working link: never nothing. */
  const bare = (doi: string): Publication => ({
    year: "",
    citation: doi,
    html: esc(doi),
    links: [{ kind: "doi", label: "DOI", url: `https://doi.org/${doi}` }],
  });

  for (const { relDir, stories } of sources) {
    for (const story of stories) {
      story.papers = story.paperDois.map((doi) => {
        const known = byDoi.get(doi);
        if (known) return known;

        warnings.push({
          file: `${relDir}/stories/`,
          message: `“${story.title}” cites ${doi}, which is not on the publications page.`,
          fallback:
            "The DOI was shown on its own with a link. Add the paper to " +
            "content/pages/06-publications/years/ for the full citation.",
        });
        return bare(doi);
      });
    }
  }

  // The same bargain for a person's own `papers:` line — with one difference.
  // A paper somebody worked on before joining the lab has no business on the
  // lab's publications page, so an unknown DOI here is a perfectly ordinary
  // thing to write. It is shown either way; the warning only points out that a
  // pasted citation would read better than a bare DOI.
  for (const page of pages) {
    for (const member of page.members) {
      if (member.paperDois.length === 0) continue;
      member.papers = member.paperDois.map((doi) => {
        const known = byDoi.get(doi);
        if (known) return known;

        warnings.push({
          file: `content/pages/${page.slug}/text/`,
          message: `${member.name} lists ${doi}, which is not on the publications page.`,
          fallback:
            "The DOI was shown on their page with a link. Paste the full citation under a " +
            "`## Publications` heading in their file for a proper entry.",
        });
        return bare(doi);
      });
    }
  }
}

export async function loadSite(options: {
  contentDir: string;
  outRoot: string;
  cacheRoot: string;
}): Promise<Site> {
  const warnings: Warning[] = [];
  const config = await loadConfig(options.contentDir, warnings);
  const images = await createImagePipeline({
    outRoot: options.outRoot,
    cacheRoot: options.cacheRoot,
  });
  warnings.push(...images.warnings);
  const files = createFilePipeline({ outRoot: options.outRoot });

  const pagesRoot = join(options.contentDir, "pages");
  const folders = await listDirs(pagesRoot);

  if (folders.length === 0) {
    warnings.push({
      file: "content/pages",
      message: "No page folders were found.",
      fallback: "An empty site was produced.",
    });
  }

  const pages: Page[] = [];
  const storySources: { relDir: string; stories: Story[] }[] = [];
  for (const folder of folders) {
    const { order, slug } = parseName(folder);
    const pageDir = join(pagesRoot, folder);
    const relDir = `content/pages/${folder}`;
    const kind = kindFor(slug);

    const meta = parseDoc((await readIfPresent(join(pageDir, "page.txt"))) ?? "");
    const ctx: Ctx = { pageDir, relDir, slug, images, files, warnings };

    // On these pages `text/` pairs with `photos/` — the files in it are people
    // or captions, not prose sections. Loading them as both would print every
    // biography twice, so the page's own intro comes from `page.txt` instead.
    const textFolderIsPaired = kind === "team" || kind === "alumni" || kind === "gallery";

    const page: Page = {
      slug,
      title: field(meta.fields, "title", "nav", "name") || titleFromSlug(slug),
      tagline: field(meta.fields, "tagline", "subtitle", "summary"),
      introHtml: renderMarkdown(meta.body),
      kind,
      order: Number.isFinite(order) ? order : 500 + pages.length,
      outDir: kind === "home" ? "" : slug,
      banners: await loadBanners(ctx),
      sections: textFolderIsPaired ? [] : await loadSections(ctx),
      stories: await loadStories(ctx),
      members:
        kind === "team" || kind === "alumni"
          ? await loadMembers(ctx, kind === "alumni", config.labAuthors)
          : [],
      publicationYears:
        kind === "publications" ? await loadPublications(ctx, config.labAuthors, "years", true) : [],
      piPublicationYears:
        kind === "publications" ? await loadPublications(ctx, config.labAuthors, "pi", false) : [],
      links: kind === "links" ? await loadLinks(ctx) : [],
      resourceGroups: kind === "resources" ? await loadResourceGroups(ctx) : [],
      gallery: kind === "gallery" ? await loadGallery(ctx) : [],
      albums: kind === "gallery" ? await loadAlbums(ctx) : [],
      rosters: await loadRosters(ctx),
      fields: meta.fields,
    };

    pages.push(page);
    if (page.stories.length > 0) storySources.push({ relDir, stories: page.stories });
  }

  warnings.push(...files.warnings);

  resolveCitedPapers(pages, storySources, warnings);

  pages.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));

  // The home page must exist and must be first, otherwise the site has no
  // index.html and every relative link is computed against the wrong depth.
  const homeIndex = pages.findIndex((page) => page.kind === "home");
  if (homeIndex > 0) pages.unshift(...pages.splice(homeIndex, 1));
  if (homeIndex === -1 && pages[0]) {
    pages[0].kind = "home";
    pages[0].outDir = "";
    warnings.push({
      file: "content/pages",
      message: "No home page folder was found.",
      fallback: `"${pages[0].title}" is being used as the home page.`,
    });
  }

  return { config, pages, warnings };
}
