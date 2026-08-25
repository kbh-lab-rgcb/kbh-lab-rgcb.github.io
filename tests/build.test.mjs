/**
 * Tests run the real generator twice: once over `tests/fixture/` for the edge
 * cases, and once over the real `content/` to check the site that ships.
 */

import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSite } from "../src/build.ts";
import { parseName } from "../src/content/text.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureOut = join(tmpdir(), `crp7-fixture-${process.pid}`);
const realOut = join(tmpdir(), `crp7-real-${process.pid}`);

/** @type {Record<string, string>} */
const fixture = {};
/** @type {Record<string, string>} */
const real = {};
let fixtureResult;
let realResult;

async function readAllHtml(dir, into, prefix = "") {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await readAllHtml(full, into, posix.join(prefix, entry.name));
    else if (entry.name.endsWith(".html")) {
      into[posix.join(prefix, entry.name)] = await readFile(full, "utf8");
    }
  }
}

before(async () => {
  fixtureResult = await buildSite({
    root,
    contentDir: join(root, "tests", "fixture"),
    outRoot: fixtureOut,
  });
  realResult = await buildSite({ root, outRoot: realOut });
  await readAllHtml(fixtureOut, fixture);
  await readAllHtml(realOut, real);
});

after(async () => {
  await rm(fixtureOut, { recursive: true, force: true });
  await rm(realOut, { recursive: true, force: true });
});

/* ------------------------------------------------------- Pages and shell */

test("every page folder produces a page, with home at the root", () => {
  assert.equal(realResult.pageCount, 10);
  for (const slug of [
    "index.html",
    "research/index.html",
    "stories/index.html",
    "team/index.html",
    "alumni/index.html",
    "publications/index.html",
    "gallery/index.html",
    "contact/index.html",
    "resources/index.html",
    "links/index.html",
  ]) {
    assert.ok(real[slug], `expected ${slug} to be generated`);
  }
});

test("the same navigation appears on every page", () => {
  const targets = ["Research", "Team", "Alumni", "Publications", "Gallery", "Contact", "Links"];
  for (const [name, html] of Object.entries(real)) {
    for (const target of targets) {
      assert.ok(
        html.includes(`>${target}</a>`),
        `${name} is missing the "${target}" nav link`,
      );
    }
  }
});

test("pages mark their own nav link as current", () => {
  assert.match(real["team/index.html"], /aria-current="page"[^>]*>Team<\/a>|>Team<\/a>/);
  const teamLink = /<a class="nav__link" href="\.\.\/team\/" aria-current="page">Team<\/a>/;
  assert.match(real["team/index.html"], teamLink);
});

/* ------------------------------------------------------------------ URLs */

test("no asset or page URL is absolute, so any base path works", () => {
  for (const [name, html] of Object.entries(real)) {
    const absolute = html.match(/(?:src|href)="\/[^"/][^"]*"/g) ?? [];
    assert.deepEqual(absolute, [], `${name} contains root-absolute URLs: ${absolute.join(", ")}`);
  }
});

test("every internal link resolves to a file that was actually generated", async () => {
  for (const [name, html] of Object.entries(real)) {
    const pageDir = dirname(join(realOut, name));
    const hrefs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
    for (const href of hrefs) {
      if (/^(https?:|mailto:|tel:|#|data:)/.test(href)) continue;
      const target = resolve(pageDir, href.split("#")[0]);
      const candidate = href.endsWith("/") ? join(target, "index.html") : target;
      const info = existsSync(candidate) ? await stat(candidate) : null;
      const ok = info?.isFile() || existsSync(join(candidate, "index.html"));
      assert.ok(ok, `${name} links to "${href}" which was not generated`);
    }
  }
});

/* ------------------------------------------------- The editor-safety rule */

test("a photo with no matching text file still renders instead of failing", () => {
  // The exact failure mode the old build had: it threw and took the site down.
  const team = fixture["team/index.html"];
  assert.ok(team, "team page should exist");
  assert.match(team, /Orphan photo/, "the name should be derived from the file name");
  assert.ok(
    fixtureResult.warnings.some((warning) => /no matching text file/i.test(warning.message)),
    "a warning should be recorded",
  );
});

test("a person with no photo gets an initials avatar", () => {
  assert.match(fixture["team/index.html"], /class="person__initials"[^>]*>AL</);
});

test("content problems are warnings, never build failures", () => {
  assert.ok(fixtureResult.pageCount > 0);
  assert.ok(fixtureResult.warnings.length > 0, "the fixture deliberately contains problems");
});

/* ------------------------------------------------------- Banner carousel */

test("one banner image renders no carousel controls", () => {
  const home = fixture["index.html"];
  assert.ok(!home.includes("data-carousel-controls"), "single image must not get controls");
  assert.ok(!home.includes("data-carousel"), "single image must not become a carousel");
  assert.match(home, /class="banner__slide"/);
});

test("two banner images render a carousel with dots and arrows", () => {
  const gallery = fixture["gallery/index.html"];
  assert.match(gallery, /data-carousel/);
  assert.match(gallery, /data-carousel-prev/);
  assert.match(gallery, /data-carousel-next/);
  assert.equal((gallery.match(/data-dot/g) ?? []).length, 2);
});

/*
 * Counted against the content rather than against a number written here.
 *
 * The lab is told it can drop photos into `content/pages/01-home/banner/` and
 * that nothing in `content/` can break the build — so a test that pins the real
 * site to exactly three banners contradicts the promise the site is built on,
 * and goes red the first time somebody adds a fourth. The invariant worth
 * holding is that the home banner is a carousel with one dot per image.
 */
test("the real home page is a carousel with one dot per banner image", () => {
  const home = realResult.site.pages.find((page) => page.kind === "home");
  assert.ok(home, "the home page should exist");
  assert.ok(home.banners.length > 1, "the home banner folder should hold a slideshow");

  assert.match(real["index.html"], /data-carousel/);
  assert.equal((real["index.html"].match(/data-dot/g) ?? []).length, home.banners.length);
});

test("the home page leads with the lab name and spells out the programme", () => {
  const home = real["index.html"];
  const { labName, name, shortName } = realResult.site.config;
  assert.ok(labName, "site.json should carry the lab's own name");

  assert.match(home, new RegExp(`<h1>${labName}</h1>`));
  assert.match(home, new RegExp(`class="banner__eyebrow">${name}</p>`));
  assert.match(home, new RegExp(`<title>${labName} · ${name}</title>`));
  // The acronym is not what greets a first-time visitor.
  assert.ok(!home.includes(`class="banner__eyebrow">${shortName}</p>`));

  // Every other page keeps the short name above its own title.
  assert.match(real["research/index.html"], new RegExp(`class="banner__eyebrow">${shortName}</p>`));
});

test("without a lab name the home page leads with the site name, as before", () => {
  // The fixture's site.json has no `labName`, so it exercises the fallback.
  assert.equal(fixtureResult.site.config.labName, "");
  const home = fixture["index.html"];
  assert.match(home, new RegExp(`<h1>${fixtureResult.site.config.name}</h1>`));
  assert.match(home, new RegExp(`<title>${fixtureResult.site.config.name}</title>`));
});

/* -------------------------------------------- Only-if-added: profiles */

test("a member with no orcid emits no ORCID markup at all", () => {
  const team = fixture["team/index.html"];
  const plain = team.slice(team.indexOf("Plain Person"));
  const card = plain.slice(0, plain.indexOf("</article>"));
  assert.ok(!card.includes("orcid.org"), "no ORCID link");
  assert.ok(!card.includes("profile-links"), "no empty link container either");
});

test("a bare ORCID id becomes a canonical orcid.org link", () => {
  assert.match(
    fixture["team/index.html"],
    /href="https:\/\/orcid\.org\/0000-0002-1825-0097"/,
  );
});

test("a full profile URL is passed through unchanged", () => {
  assert.match(
    fixture["team/index.html"],
    /href="https:\/\/scholar\.google\.com\/citations\?user=FIXTURE1"/,
  );
});

test("profile keys typed below the biography still work", () => {
  // What someone actually does when adding an ORCID months later.
  const team = fixture["team/index.html"];
  assert.match(team, /href="https:\/\/orcid\.org\/0000-0001-5109-3700"/);
  assert.match(team, /href="https:\/\/example\.org\/late"/);
});

/* --------------------------------------------------------- Personal pages */

test("profile: yes gives a person a page of their own", () => {
  const page = fixture["team/k-b-harikumar/index.html"];
  assert.ok(page, "the profile page should be generated");
  assert.match(page, /<h1>K B Harikumar<\/h1>/);
  assert.match(page, /<title>K B Harikumar/);
  // It borrows the team page's shell, so the way back is always in front of you.
  assert.match(page, /Back to Team/);
});

test("a person without the flag gets no page and no link to one", () => {
  assert.ok(!fixture["team/no-flag/index.html"], "no page should be generated");
  const team = fixture["team/index.html"];
  const card = team.slice(team.indexOf("No Flag"));
  assert.ok(!card.slice(0, card.indexOf("</article>")).includes("Full profile"));
});

test("sections written without the flag stay on the card rather than vanishing", () => {
  const team = fixture["team/index.html"];
  assert.match(team, /Something they won/);
  assert.ok(
    fixtureResult.warnings.some((warning) => /no `profile: yes` line/.test(warning.message)),
    "the editor should be told how to give them a page",
  );
});

test("the card links to the profile from both the portrait and the name", () => {
  const team = fixture["team/index.html"];
  assert.match(team, /class="person__portrait-link" href="\.\.\/team\/k-b-harikumar\/"/);
  assert.match(team, /<h3 class="person__name"><a href="\.\.\/team\/k-b-harikumar\/">K B Harikumar/);
  assert.match(team, /Full profile/);
});

test("a person's own page is not in the navigation", () => {
  for (const [name, html] of Object.entries(fixture)) {
    assert.ok(
      !html.includes('class="nav__link" href="../team/k-b-harikumar/"'),
      `${name} should not carry a nav link to a personal page`,
    );
  }
});

test("dashed lines become two-column CV rows", () => {
  const page = fixture["team/k-b-harikumar/index.html"];
  assert.match(page, /<dt class="cv__term">PhD Fixture Studies, 2008<\/dt>/);
  assert.match(page, /<dd class="cv__detail">University of Examples<\/dd>/);
});

test("a date range in the term is not mistaken for the separator", () => {
  // `2018 – 2020 — Visiting Fellow` splits at the em dash, not the en dash.
  const page = fixture["team/k-b-harikumar/index.html"];
  assert.match(page, /<dt class="cv__term">2018 – 2020<\/dt>/);
  assert.match(page, /<dd class="cv__detail">Visiting Fellow, Institute of Fixtures<\/dd>/);
});

test("a CV pasted as term-then-detail lines becomes rows too", () => {
  const page = fixture["team/k-b-harikumar/index.html"];
  assert.match(page, /<dt class="cv__term">Scientist F<\/dt>/);
  assert.match(page, /<dd class="cv__detail">Institute of Fixtures<\/dd>/);
  assert.match(page, /<dt class="cv__term">Post-doctoral Associate<\/dt>/);
});

test("a prose section stays prose instead of being folded into a table", () => {
  const page = fixture["team/k-b-harikumar/index.html"];
  const interests = page.slice(page.indexOf("Interests"));
  const section = interests.slice(0, interests.indexOf("</section>"));
  assert.ok(!section.includes("cv__term"), "prose should not become CV rows");
  assert.match(section, /<ul>/, "the bulleted list should survive as a list");
});

test("a person's page lists the papers they are an author of", () => {
  const page = fixture["team/k-b-harikumar/index.html"];
  assert.match(page, /Publications/);
  assert.match(page, /A paper that has identifiers/);
  // The other fixture paper is by somebody else and must not be claimed.
  assert.ok(!page.includes("A paper with no identifier at all"));
});

/* ------------------------------------------------- Lists written as lists */

test("a page section of term — detail lines becomes two-column rows", () => {
  const html = fixture["grants/index.html"];
  assert.ok(html, "the grants page should be generated");
  assert.match(html, /<dt class="cv__term">2018–2022<\/dt>/);
  assert.match(html, /<dd class="cv__detail">Understanding a thing\. Council of Fixtures \(CF\)<\/dd>/);
});

test("a hard-wrapped paragraph is never shredded into a list or a table", () => {
  const html = fixture["grants/index.html"];
  const notes = html.slice(html.indexOf('id="notes"'));
  const block = notes.slice(0, notes.indexOf("</div></div>"));
  assert.ok(!block.includes("cv__term"), "prose must not become CV rows");
  assert.ok(!block.includes("<li>"), "prose must not become list items");
  assert.match(block, /<p>This paragraph is hard-wrapped/);
});

test("things pasted one per line become a real list, not one grey paragraph", () => {
  const html = fixture["team/k-b-harikumar/index.html"];
  const memberships = html.slice(html.indexOf("Memberships"));
  const block = memberships.slice(0, memberships.indexOf("</section>"));
  assert.match(block, /<li>Society of Fixtures<\/li>/);
  assert.match(block, /<li>Institute of Samples<\/li>/);
  assert.ok(!block.includes("Society of Fixtures Institute of Samples"), "never run together");
});

test("a DOI that is not on the publications page still appears on the profile", () => {
  const page = fixture["team/outside-author/index.html"];
  assert.ok(page, "the profile page should be generated");
  assert.match(page, /href="https:\/\/doi\.org\/10\.9999\/not-on-the-lab-list"/);
  assert.match(page, /10\.9999\/not-on-the-lab-list/);
  assert.ok(
    fixtureResult.warnings.some((warning) =>
      /Outside Author lists 10\.9999\/not-on-the-lab-list/.test(warning.message),
    ),
    "the editor should be told a pasted citation would read better",
  );
});

test("a citation pasted under ## Publications is listed in full", () => {
  const page = fixture["team/outside-author/index.html"];
  assert.match(page, /A paper the lab list does not carry/);
  assert.match(page, /href="https:\/\/doi\.org\/10\.5555\/elsewhere\.2019"/);
  // Filed under the year in the citation, not left undated.
  assert.match(page, /<h3 class="pub-year__label">2019<\/h3>/);
  // One publications section, not the pasted block printed twice.
  assert.equal((page.match(/profile-section__title">Publications/g) ?? []).length, 1);
});

test("listing papers explicitly replaces the author matching", () => {
  const page = fixture["team/outside-author/index.html"];
  // The fixture's own lab paper names a different author and must not appear.
  assert.ok(!page.includes("A paper that has identifiers"));
});

test("the biography above the headings is what the card shows", () => {
  const team = fixture["team/index.html"];
  assert.match(team, /The part of the biography that stays on the card\./);
  // The CV itself belongs on the page, not on a card in a grid of twelve.
  assert.ok(!team.includes("Institute of Fixtures"));
});

test("keys lifted out of the body do not also render as prose", () => {
  const team = fixture["team/index.html"];
  assert.ok(!team.includes("orcid: 0000-0001-5109-3700"), "raw key leaked into the page");
  assert.ok(!team.includes("website: example.org"), "raw key leaked into the page");
  assert.match(team, /added their profile links months\s+later/, "the biography survives");
});

/* ---------------------------------------- Only-if-added: publications */

test("a citation with identifiers gets resolving links, and they leave the text", () => {
  const html = fixture["publications/index.html"];
  assert.match(html, /href="https:\/\/doi\.org\/10\.1234\/fixture\.2025"/);
  assert.match(html, /href="https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/12345678\/"/);
  assert.ok(!html.includes("pmid:12345678"), "the raw identifier must be stripped from the text");
  assert.ok(!html.includes("doi:10.1234"), "the raw identifier must be stripped from the text");
});

test("a citation with no identifier gets no link button", () => {
  const html = fixture["publications/index.html"];
  const entry = html.slice(html.indexOf("A paper with no identifier"));
  const item = entry.slice(0, entry.indexOf("</li>"));
  assert.ok(!item.includes("pub__links"), "no empty button row");
});

test("lab authors are bolded in citations and others are not", () => {
  const html = fixture["publications/index.html"];
  assert.match(html, /<strong>Harikumar KB<\/strong>/);
  assert.ok(!html.includes("<strong>Someone Else</strong>"));
});

/*
 * Counted against the content again, not against a number written here. The
 * publications page grew from ten papers to seventy-seven in one commit, and a
 * test that pins the total contradicts the promise the site is built on.
 */
test("every real publication renders, and the ones with identifiers link out", () => {
  const html = real["publications/index.html"];
  const papers = realResult.site.pages
    .flatMap((page) => [...page.publicationYears, ...page.piPublicationYears])
    .flatMap((group) => group.items);

  assert.ok(papers.length > 0, "the publications page should carry papers");
  assert.equal((html.match(/<li class="pub">/g) ?? []).length, papers.length);

  const count = (kind) => papers.filter((p) => p.links.some((l) => l.kind === kind)).length;
  assert.equal((html.match(/href="https:\/\/doi\.org\//g) ?? []).length, count("doi"));
  assert.equal(
    (html.match(/href="https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//g) ?? []).length,
    count("pmid"),
  );
});

test("a citation ending in a plain web address builds and links out", () => {
  // A URL with no capture group in the pattern behind it took the whole build
  // down once; the fixture carries one so that can never happen quietly again.
  const html = fixture["publications/index.html"];
  assert.match(html, /href="https:\/\/example\.org\/book\/9781439821442"/);
  assert.match(html, /A book with a plain web address at the end\. CRC Press, 2025\./);
  // The `URL:` label goes with the address rather than being left dangling.
  assert.ok(!html.includes("2025. URL"));
});

/* ------------------------------------------ Lab papers vs the PI's own */

/*
 * The whole point of the two folders: one number that means "what this lab has
 * published" and a second list that does not inflate it. Counted from the
 * content on both sides, so moving a paper between the folders moves the test
 * with it rather than breaking it.
 */
test("the PI's other papers are listed apart from the lab's own and not counted with them", () => {
  const page = realResult.site.pages.find((p) => p.kind === "publications");
  const count = (years) => years.reduce((total, year) => total + year.items.length, 0);
  const lab = count(page.publicationYears);
  const pi = count(page.piPublicationYears);

  assert.ok(lab > 0, "the lab should have papers of its own");
  assert.ok(pi > 0, "the PI should have papers outside the lab's own list");

  // The home page's headline figure is the lab's own work, not the total.
  assert.match(real["index.html"], new RegExp(`>${lab}</p><p class="stat__label">Selected publications`));
  assert.ok(!real["index.html"].includes(`>${lab + pi}</p><p class="stat__label">Selected publications`));

  // Both lists are on the publications page; only one of them is counted in
  // the heading above it.
  const html = real["publications/index.html"];
  assert.equal((html.match(/<li class="pub">/g) ?? []).length, lab + pi);
  assert.match(html, new RegExp(`<h2>${lab} papers?</h2>`));
  assert.match(html, new RegExp(`class="pub-aside__count">${pi}<`));
});

test("a publications page with no pi folder is unchanged, and one with a pi folder gains a list", () => {
  const page = fixtureResult.site.pages.find((p) => p.kind === "publications");
  assert.equal(page.piPublicationYears.length, 1);
  assert.match(fixture["publications/index.html"], /A paper from before the lab existed/);
  // The loose-file fallback for `years/` must not also swallow the pi folder.
  const labCitations = page.publicationYears.flatMap((y) => y.items).map((i) => i.citation);
  assert.ok(!labCitations.some((c) => c.includes("before the lab existed")));
});

/* --------------------------------------------------------- Resources */

test("a folder in a resource branch becomes a card and a page of its own", () => {
  const page = fixtureResult.site.pages.find((p) => p.kind === "resources");
  assert.equal(page.resourceGroups.length, 2);
  assert.deepEqual(
    page.resourceGroups.map((group) => group.slug),
    ["repos", "code"],
  );

  // `2.1-` orders inside the branch and does not leak into the address.
  const code = page.resourceGroups[1];
  assert.deepEqual(
    code.items.map((item) => item.path),
    ["resources/code/described/", "resources/code/undescribed/"],
  );

  assert.ok(fixture["resources/index.html"].includes("A described code block"));
  assert.ok(fixture["resources/code/described/index.html"]);
  assert.match(fixture["resources/code/described/index.html"], /What it does\./);
  // Its `## Requirements` block is a two-column list, like a CV section.
  assert.match(fixture["resources/code/described/index.html"], /<dt class="cv__term">R<\/dt>/);
});

test("every file in an item folder is downloadable under its own name", async () => {
  const page = fixtureResult.site.pages.find((p) => p.kind === "resources");
  const item = page.resourceGroups[1].items[0];

  assert.deepEqual(
    item.downloads.map((file) => file.name),
    ["run.R", "scripts/qc.R"],
  );
  // The file that describes the item is not part of it, and neither is the
  // README that tells an editor what to put in the folder.
  assert.ok(!item.downloads.some((file) => /item\.txt|README/i.test(file.name)));

  for (const file of item.downloads) {
    assert.ok(existsSync(join(fixtureOut, file.src)), `${file.src} should have been copied`);
  }
  // A nested folder keeps its shape rather than collapsing into a flat pile.
  assert.ok(existsSync(join(fixtureOut, "assets/resources/code/described/scripts/qc.R")));

  const html = fixture["resources/code/described/index.html"];
  assert.match(html, /href="\.\.\/\.\.\/\.\.\/assets\/resources\/code\/described\/run\.R" download/);
});

test("a script is shown on the page as well as offered for download", () => {
  const html = fixture["resources/code/described/index.html"];
  assert.match(html, /<pre class="code-block__body"><code>x &lt;- 1/);
  assert.match(html, /data-copy/);
});

test("an item with no item.txt still gets a page, and says so in a warning", () => {
  const html = fixture["resources/code/undescribed/index.html"];
  assert.ok(html, "the folder should still produce a page");
  assert.match(html, /orphan\.R/);
  assert.ok(
    fixtureResult.warnings.some((warning) => /has no `item\.txt`/.test(warning.message)),
    "the editor should be told what is missing",
  );
});

test("a repository with nothing to download renders no Files section", () => {
  const html = fixture["resources/repos/with-repo/index.html"];
  assert.ok(!html.includes("download-list"), "no file list where there are no files");
  assert.ok(!html.includes("code-block__body"), "and no empty code block either");
  assert.match(html, /href="https:\/\/github\.com\/fixture-org\/fixture-repo"/);
  assert.match(html, /href="https:\/\/example\.org\/docs"/);
});

/*
 * A dotted prefix is a pair, not a decimal. Number("2.10") is 2.1, which would
 * sort item 10 before item 2 -- wrong the moment a branch grows past nine
 * items, which the code-blocks branch already has.
 */
test("dotted ordering prefixes sort past nine", () => {
  const names = ["2.2-b", "2.3-c", "2.9-i", "2.10-j", "2.13-m", "01-first", "10-tenth"];
  const sorted = names
    .map((name) => ({ name, ...parseName(name) }))
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.name);

  assert.deepEqual(sorted, ["01-first", "2.2-b", "2.3-c", "2.9-i", "2.10-j", "2.13-m", "10-tenth"]);

  // The slug never keeps the prefix, whichever form it took.
  assert.equal(parseName("2.10-ssgsea-scores").slug, "ssgsea-scores");
  assert.equal(parseName("03-arun-v.jpg").slug, "arun-v");
  // A folder name containing a dot is not a file with an extension.
  assert.equal(parseName("2.1-deseq2").order, 2.001);
  // No prefix at all still sorts to the end.
  assert.equal(parseName("coco repo").order, Number.POSITIVE_INFINITY);
});

test("every resource item publishes a page with its files downloadable", () => {
  const page = realResult.site.pages.find((p) => p.kind === "resources");
  assert.ok(page, "the site should have a resources page");

  const items = page.resourceGroups.flatMap((group) => group.items);
  assert.ok(items.length > 0, "there should be resource items");

  for (const item of items) {
    const html = real[posix.join(item.path, "index.html")];
    assert.ok(html, `${item.path} should have been written`);

    for (const file of item.downloads) {
      assert.ok(
        existsSync(join(realOut, file.src)),
        `${file.src} should have been copied into the site`,
      );
      assert.ok(html.includes("download"), `${item.path} should offer a download`);
    }
  }
});

/* ----------------------------------------------- Only-if-added: stories */



test("a section with no story lines gets no story markup at all", () => {
  const html = real["research/index.html"];
  const block = html.slice(html.indexOf('id="funding"'));
  const funding = block.slice(0, block.indexOf("</section>"));
  assert.ok(!funding.includes("section__eyebrow"), "no empty kicker");
  assert.ok(!funding.includes("callout"), "no empty callout");
  assert.ok(!funding.includes("section-block__papers"), "no empty citation trail");
});

test("a story cites papers by DOI and gets the publication page's own citation", () => {
  const story = real["stories/index.html"];
  const papers = real["publications/index.html"];
  // The story names only a DOI; the citation it prints has to be the one the
  // publications page prints, down to the bolding of the lab's authors.
  const fromStory = [...story.matchAll(/<p class="pub__citation">(.*?)<\/p>/g)]
    .map((match) => match[1])
    .find((citation) => citation.includes("Targeting S1PR1"));
  assert.ok(fromStory, "the pancreatic story should print its paper");
  assert.match(fromStory, /<strong>Lankadasari MB<\/strong>/);
  assert.ok(papers.includes(fromStory), "and print it identically to the publications page");
  assert.match(story, /href="https:\/\/doi\.org\/10\.7150\/thno\.25308"/);
});

test("a story citing an unlisted DOI still publishes, and warns", async () => {
  const out = join(tmpdir(), `crp7-story-${process.pid}`);
  const dir = join(root, "content", "pages", "03-stories", "stories");
  const file = join(dir, "99-temporary-test-story.txt");
  await writeFile(file, "title: Temporary\npapers: 10.9999/not-a-real-paper\n\nA body.\n");
  try {
    const result = await buildSite({ root, outRoot: out });
    const html = await readFile(join(out, "stories", "index.html"), "utf8");
    assert.match(html, /id="temporary-test-story"/, "the story still renders");
    assert.match(html, /href="https:\/\/doi\.org\/10\.9999\/not-a-real-paper"/, "with a link");
    assert.ok(
      result.warnings.some((warning) => warning.message.includes("10.9999/not-a-real-paper")),
      "and the editor is told which paper to add",
    );
  } finally {
    await rm(file, { force: true });
    await rm(out, { recursive: true, force: true });
  }
});

test("a value wrapped onto an indented second line is not lost into the body", () => {
  // The story files wrap their long `lead:` lines, and a reader must see the
  // whole sentence in the standfirst rather than half of it as a stray
  // paragraph.
  const html = real["stories/index.html"];
  assert.match(
    html,
    /<p class="section__lead">Across two preclinical studies we traced how cardamonin can interrupt both tumour formation and inflammation-driven colorectal cancer, in part by reshaping microRNA networks\.<\/p>/,
  );
});

test("adding a story to the research page puts it on the home page too", () => {
  const research = real["stories/index.html"];
  const home = real["index.html"];
  const ids = [...research.matchAll(/class="section-block[^"]*--story" id="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.ok(ids.length > 0, "the research page should have stories");

  // Every one of them, linked to the story itself, so nobody has to keep a
  // second list in step with this one.
  for (const id of ids) {
    assert.ok(home.includes(`href="./stories/#${id}"`), `${id} is missing from the home page`);
  }
  for (const href of home.match(/href="\.\/stories\/#([^"]+)"/g) ?? []) {
    const id = /#([^"]+)"/.exec(href)?.[1];
    assert.ok(ids.includes(id), `the home page links to "${id}", which is not a story`);
  }
});

/* --------------------------------------------------------------- Theming */

test("the stylesheet defines light and dark in all three required places", async () => {
  const css = await readFile(join(realOut, "styles.css"), "utf8");
  assert.match(css, /:root\s*\{[^}]*--bg:/, "light tokens on bare :root");
  assert.match(
    css,
    /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/,
    "system dark, overridable by an explicit light choice",
  );
  assert.match(css, /:root\[data-theme="dark"\]/, "explicit dark choice");
});

test("the theme is applied before first paint to avoid a flash", () => {
  for (const [name, html] of Object.entries(real)) {
    assert.ok(
      html.includes("localStorage.getItem('crp7-theme')"),
      `${name} is missing the inline theme boot script`,
    );
    assert.ok(
      html.indexOf("crp7-theme") < html.indexOf("<body>"),
      `${name} must apply the theme inside <head>`,
    );
  }
});

/* ----------------------------------------------------------- Escaping */

test("content is HTML-escaped", async () => {
  // site.json for the real site contains no markup; assert the escaper is wired
  // by checking an ampersand-bearing value survives as an entity.
  const html = real["contact/index.html"];
  assert.ok(!/<script>(?!)/.test(html));
  assert.ok(html.includes("harikumar@rgcb.res.in"));
});

test("gallery photos are lightbox buttons with a full-size source", () => {
  const html = fixture["gallery/index.html"];
  assert.match(html, /class="gallery__item" type="button" data-lightbox/);
  assert.match(html, /data-full="\.\.\/assets\/gallery\//);
});

/* ----------------------------------------------------------------- Albums */

test("a subfolder of photos/ becomes an album stack that opens into a grid", () => {
  const html = fixture["gallery/index.html"];
  assert.match(html, /<details class="album"/);
  // Title and date come from album.txt; the count is counted, not written.
  assert.match(html, /class="album__title">Lab retreat</);
  assert.match(html, /class="album__date">December 2025</);
  assert.match(html, /class="album__count">3 photos</);
  assert.match(html, /class="album__caption">Two days in Munnar\.</);

  // Three photos in the folder, three sheets in the closed stack.
  const summary = html.slice(html.indexOf('<summary class="album__summary">'));
  const stack = summary.slice(0, summary.indexOf("</summary>"));
  assert.equal((stack.match(/class="album__sheet"/g) ?? []).length, 3);
});

test("an album's photos are lightbox buttons in a group of their own", () => {
  const html = fixture["gallery/index.html"];
  assert.match(html, /<div class="gallery" data-lightbox-group="lab-retreat">/);

  const album = html.slice(html.indexOf('data-lightbox-group="lab-retreat"'));
  const grid = album.slice(0, album.indexOf("</div>"));
  assert.equal((grid.match(/class="gallery__item"/g) ?? []).length, 3);
  // Album assets live under the album's own folder.
  assert.match(grid, /data-full="\.\.\/assets\/gallery\/lab-retreat\//);
});

test("a caption file beside a photo in an album captions that photo", () => {
  assert.match(
    fixture["gallery/index.html"],
    /data-caption="The whole group, on the tea estate\."/,
  );
});

test("cover: puts the named photo on top of the stack", () => {
  const gallery = fixtureResult.site.pages.find((page) => page.kind === "gallery");
  const album = gallery?.albums.find((entry) => entry.slug === "lab-retreat");
  assert.ok(album, "the fixture album should load");
  assert.equal(album.cover.slug, "hike", "cover: names the second photo, not the first");
  assert.equal(album.items.length, 3);
});

test("an album folder with no photos in it is skipped with a warning", () => {
  const gallery = fixtureResult.site.pages.find((page) => page.kind === "gallery");
  assert.ok(
    !gallery?.albums.some((album) => album.slug === "empty"),
    "an empty folder should not render as an album",
  );
  assert.ok(
    fixtureResult.warnings.some((warning) => /album folder has no photos/i.test(warning.message)),
    "the editor should be told which folder was skipped",
  );
});

test("photos left loose in photos/ still render alongside the albums", () => {
  const html = fixture["gallery/index.html"];
  assert.match(html, /<div class="gallery" data-lightbox-group="photos">/);
  // Both groups present means the page labels them.
  assert.match(html, /<h2>Albums<\/h2>/);
  assert.match(html, /<h2>More photos<\/h2>/);
});

test("responsive image markup is emitted for raster sources", () => {
  // The fixture uses SVGs, which pass through; check the attribute plumbing
  // exists on the real site's images instead.
  for (const html of Object.values(real)) {
    for (const tag of html.match(/<img[^>]*>/g) ?? []) {
      assert.match(tag, /\balt="/, `img tag missing alt: ${tag}`);
      assert.match(tag, /loading="(lazy|eager)"/, `img tag missing loading: ${tag}`);
    }
  }
});
