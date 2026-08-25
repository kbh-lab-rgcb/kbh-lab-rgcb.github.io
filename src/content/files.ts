/**
 * Files a reader can download: analysis scripts, notebooks, anything an item
 * folder holds.
 *
 * Deliberately not the image pipeline. An image is *processed* — resized,
 * re-encoded, renamed to a hash — because the browser is the consumer and only
 * the pixels matter. A script is the opposite: the person downloading it wants
 * the exact bytes the author committed, under the exact name they gave it, so
 * `run_deseq2.R` arrives as `run_deseq2.R` and not `a1b2c3d4-800.R`.
 *
 * Same contract as the rest of `content/`: nothing here throws. A file that
 * cannot be read is a warning and is left out.
 */

import { copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, join, posix } from "node:path";
import type { Download, Warning } from "./types.ts";

/**
 * Extensions shown inline on the item's page as well as offered for download.
 *
 * The point of a code block is to be *read* before it is run, so a reader can
 * see whether it does what they need without downloading anything. Anything
 * not on this list is still downloadable — it just has no preview.
 */
const PREVIEWABLE = new Set([
  "r",
  "rmd",
  "qmd",
  "py",
  "ipynb",
  "sh",
  "bash",
  "zsh",
  "pl",
  "jl",
  "sql",
  "do",
  "m",
  "nf",
  "smk",
  "snakefile",
  "awk",
  "c",
  "h",
  "cpp",
  "java",
  "go",
  "rs",
  "js",
  "ts",
  "css",
  "html",
  "xml",
  "json",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "txt",
  "md",
  "csv",
  "tsv",
  "env",
  "gitignore",
  "dockerfile",
  "makefile",
]);

/** Above this a preview stops being a preview and becomes a wall. */
const PREVIEW_LIMIT = 60_000;

/** Folders never worth publishing, whatever an editor drops in by accident. */
const SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", ".ipynb_checkpoints", ".venv"]);

/** How deep to walk an item folder. A repo dropped inside one still works. */
const MAX_DEPTH = 4;

export type FilePipeline = {
  /**
   * Copy one file into `assets/<relDir>/` and describe it.
   *
   * @param name Path shown to the reader, e.g. `scripts/qc.R`; also its path
   *   under `relDir`, so a nested folder survives the copy.
   */
  copy(srcPath: string, relDir: string, name: string): Promise<Download | null>;
  /** Every ordinary file under `dir`, depth-first, as `scripts/qc.R` style paths. */
  walk(dir: string, depth?: number): Promise<string[]>;
  warnings: Warning[];
};

/** `run_deseq2.R` -> `r`; `Makefile` -> `makefile`. */
function extensionOf(name: string): string {
  const ext = extname(name).replace(/^\./, "").toLowerCase();
  return ext || name.toLowerCase().replace(/^\./, "");
}

/**
 * A Jupyter notebook is JSON on disk and unreadable as JSON on a page, so its
 * preview is the source of its cells — the thing a reader actually wants to
 * look at — with the outputs and base64 image blobs left behind.
 */
function notebookSource(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as {
      cells?: { cell_type?: string; source?: string[] | string }[];
    };
    if (!Array.isArray(parsed.cells)) return null;

    return parsed.cells
      .map((cell) => {
        const source = Array.isArray(cell.source) ? cell.source.join("") : (cell.source ?? "");
        if (!source.trim()) return "";
        // Markdown cells are prose between the code; keeping them as comments
        // preserves the notebook's own narrative without pretending it is code.
        return cell.cell_type === "markdown"
          ? source.replace(/^/gm, "# ").trimEnd()
          : source.trimEnd();
      })
      .filter(Boolean)
      .join("\n\n");
  } catch {
    return null;
  }
}

export function createFilePipeline(options: { outRoot: string }): FilePipeline {
  const { outRoot } = options;
  const warnings: Warning[] = [];

  async function walk(dir: string, depth = 0): Promise<string[]> {
    if (depth > MAX_DEPTH) return [];
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const found: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".gitignore") continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
        for (const nested of await walk(join(dir, entry.name), depth + 1)) {
          found.push(posix.join(entry.name, nested));
        }
      } else if (entry.isFile()) {
        found.push(entry.name);
      }
    }
    return found.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  }

  return {
    warnings,
    walk,
    async copy(srcPath, relDir, name) {
      let bytes: Buffer;
      let size: number;
      try {
        size = (await stat(srcPath)).size;
        bytes = await readFile(srcPath);
      } catch {
        warnings.push({
          file: srcPath,
          message: "This file could not be read.",
          fallback: "It was left out of the downloads for this item.",
        });
        return null;
      }

      const target = join(outRoot, "assets", relDir, ...name.split("/"));
      try {
        await mkdir(dirname(target), { recursive: true });
        await copyFile(srcPath, target);
      } catch {
        warnings.push({
          file: srcPath,
          message: "This file could not be copied into the site.",
          fallback: "It was left out of the downloads for this item.",
        });
        return null;
      }

      const ext = extensionOf(name);
      let preview = "";
      if (PREVIEWABLE.has(ext) && size <= PREVIEW_LIMIT) {
        const text = bytes.toString("utf8");
        // A NUL byte means this was never text, whatever the extension said.
        if (!text.includes("\u0000")) {
          preview = (ext === "ipynb" ? (notebookSource(text) ?? "") : text).replace(/\r\n/g, "\n");
        }
      }

      return {
        src: posix.join("assets", relDir.split(/[\\/]/).join("/"), name),
        name,
        ext,
        bytes: size,
        preview,
      };
    },
  };
}

/** `1234` -> `1.2 KB`. Shown beside every download. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
