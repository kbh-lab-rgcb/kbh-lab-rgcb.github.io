/**
 * The build: `content/` in, `docs/` out.
 *
 * Exported as a function so `build.ts`, `dev.ts` and the tests all drive the
 * exact same code path — there is no second renderer anywhere.
 */

import { build as esbuild } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadSite } from "./content/load.ts";
import type { Site, Warning } from "./content/types.ts";
import { renderDocument } from "./render/layout.ts";
import { descriptionFor, renderPageBody } from "./render/pages.ts";
import { profileDescription, profileShell, renderProfileBody } from "./render/profile.ts";
import { renderResourceBody, resourceDescription, resourceShell } from "./render/resource.ts";
import { depthOf, outputPath } from "./render/url.ts";

const STYLE_FILES = ["tokens.css", "base.css", "layout.css", "components.css"];

export type BuildResult = {
  site: Site;
  warnings: Warning[];
  pageCount: number;
  /** Personal pages written alongside them. Not part of `pageCount`. */
  profileCount: number;
  /** Repository and code-block pages. Also not part of `pageCount`. */
  resourceCount: number;
  ms: number;
};

export type BuildOptions = {
  root: string;
  /** Override the content directory. Tests point this at a fixture. */
  contentDir?: string;
  /** Override the output directory. Tests point this at a temp folder. */
  outRoot?: string;
  /** Injected into the page so the dev server can trigger a reload. */
  liveReload?: boolean;
};

/** Concatenate the stylesheets in order. Cascade order is meaningful. */
async function buildStyles(root: string): Promise<string> {
  const parts: string[] = [];
  for (const file of STYLE_FILES) {
    parts.push(await readFile(join(root, "src", "styles", file), "utf8"));
  }
  return parts.join("\n");
}

async function buildScript(root: string, liveReload: boolean): Promise<string> {
  const result = await esbuild({
    entryPoints: [join(root, "src", "client", "main.ts")],
    bundle: true,
    format: "iife",
    target: ["es2020"],
    minify: !liveReload,
    write: false,
    logLevel: "silent",
  });

  const code = result.outputFiles[0]?.text ?? "";
  if (!liveReload) return code;

  // Dev only: reconnecting EventSource that reloads when the build finishes.
  return `${code}\n(function(){var s=new EventSource("/__reload");s.onmessage=function(){location.reload()};s.onerror=function(){s.close();setTimeout(function(){location.reload()},1000)}})();`;
}

export async function buildSite(options: BuildOptions): Promise<BuildResult> {
  const started = Date.now();
  const { root, liveReload = false } = options;
  const outRoot = options.outRoot ?? join(root, "docs");
  const contentDir = options.contentDir ?? join(root, "content");
  const cacheRoot = join(root, ".cache");

  await rm(outRoot, { recursive: true, force: true });
  await mkdir(outRoot, { recursive: true });

  const site = await loadSite({ contentDir, outRoot, cacheRoot });

  for (const page of site.pages) {
    const depth = depthOf(page);
    const html = renderDocument({
      site,
      page,
      depth,
      body: renderPageBody(site, page, depth),
      description: descriptionFor(site, page),
    });
    const target = join(outRoot, outputPath(page));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, html);
  }

  // Anyone with `profile: yes` also gets a page of their own, written inside
  // their page's folder as `team/harikumar-kb/index.html`. These are not in
  // `site.pages` on purpose: they are reachable from the cards, but a
  // navigation bar with fourteen names in it would be no navigation at all.
  let profileCount = 0;
  for (const page of site.pages) {
    for (const member of page.members) {
      if (!member.profilePath) continue;
      const shell = profileShell(page, member);
      const depth = depthOf(shell);
      const html = renderDocument({
        site,
        page: shell,
        depth,
        body: renderProfileBody(site, page, member, depth),
        description: profileDescription(member),
      });
      const target = join(outRoot, outputPath(shell));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, html);
      profileCount += 1;
    }
  }

  // Every repository and code block gets a page of its own, for the same
  // reason people do: the folder is the unit somebody adds, and the thing they
  // wrote about it needs somewhere to live that is not a card.
  let resourceCount = 0;
  for (const page of site.pages) {
    for (const group of page.resourceGroups) {
      for (const item of group.items) {
        const shell = resourceShell(page, group, item);
        const depth = depthOf(shell);
        const html = renderDocument({
          site,
          page: shell,
          depth,
          body: renderResourceBody(page, group, item, depth),
          description: resourceDescription(item),
        });
        const target = join(outRoot, outputPath(shell));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, html);
        resourceCount += 1;
      }
    }
  }

  await writeFile(join(outRoot, "styles.css"), await buildStyles(root));
  await writeFile(join(outRoot, "main.js"), await buildScript(root, liveReload));

  // Tells GitHub Pages not to run Jekyll, which would eat underscore paths.
  await writeFile(join(outRoot, ".nojekyll"), "");

  const publicDir = join(root, "public");
  if (existsSync(publicDir)) {
    await cp(publicDir, outRoot, { recursive: true });
  }

  return {
    site,
    warnings: site.warnings,
    pageCount: site.pages.length,
    profileCount,
    resourceCount,
    ms: Date.now() - started,
  };
}

/**
 * Print warnings for a human and, in CI, as GitHub annotations.
 *
 * Warnings never fail the build — see the contract in `load.ts`.
 */
export function reportWarnings(warnings: Warning[]): void {
  if (warnings.length === 0) return;

  const inActions = Boolean(process.env.GITHUB_ACTIONS);
  console.log(`\n${warnings.length} thing${warnings.length === 1 ? "" : "s"} to look at:\n`);

  for (const warning of warnings) {
    if (inActions) {
      const file = warning.file.replace(/\\/g, "/");
      console.log(`::warning file=${file}::${warning.message} ${warning.fallback}`);
    }
    console.log(`  ${warning.file}`);
    console.log(`    ${warning.message}`);
    console.log(`    → ${warning.fallback}\n`);
  }
}
