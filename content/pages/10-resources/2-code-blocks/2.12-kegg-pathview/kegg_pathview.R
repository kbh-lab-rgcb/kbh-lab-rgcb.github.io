#!/usr/bin/env Rscript
# ============================================================================
#  KEGG pathway diagrams coloured by fold change
# ----------------------------------------------------------------------------
#  Paints your differential-expression results onto the real KEGG pathway
#  diagram, so you can see where in a pathway the change actually sits --
#  receptor, kinase cascade, or transcriptional output.
#
#    red   = higher in the contrast numerator (positive log2FC)
#    green = higher in the denominator (negative log2FC)
#    grey  = measured but unchanged; white = not in your data
#
#  INPUT   <input_dir>/<contrast>/deseq2_results_annotated.csv
#  OUTPUT  <output_dir>/<contrast>/<pathway_id>.<suffix>.png
#  NEXT    nothing -- this is a terminal step
#
#  Any organism KEGG covers, any pathway. Pathview insists on writing to the
#  working directory, so this script changes into the output folder and
#  changes back on exit -- including if it errors partway.
# ============================================================================


# ============================================================================
#  CONFIG -- edit only this section
# ============================================================================

project_root <- "."
input_dir    <- file.path(project_root, "results", "02_deseq2")
output_dir   <- file.path(project_root, "results", "08_pathview")

# Draw for every <contrast>/deseq2_results_annotated.csv, or name one file.
input_file <- NULL

# --- Which pathways -------------------------------------------------------
# KEGG pathway IDs WITHOUT the species prefix -- the prefix is added from
# species_kegg below, so the same list works for any organism.
#
# Find IDs at https://www.genome.jp/kegg/pathway.html
#   04110 cell cycle          04151 PI3K-Akt
#   04010 MAPK                04630 JAK-STAT
#   04660 T cell receptor     04620 Toll-like receptor
#   04210 apoptosis           03320 PPAR
pathway_ids <- c("04110", "04151", "04010")

# Or take the top pathways straight from a GSEA run instead of listing them.
# Points at a KEGG GSEA_results.csv; set to NULL to use pathway_ids above.
pathways_from_gsea <- NULL
# pathways_from_gsea <- file.path(project_root, "results", "05_gsea")
top_n_from_gsea <- 5

# --- Organism -------------------------------------------------------------
# hsa human, mmu mouse, rno rat, dme fly, dre zebrafish, cel worm, sce yeast
species_kegg  <- "hsa"
species_orgdb <- "org.Hs.eg.db"

# --- Column names ---------------------------------------------------------
value_column  <- "log2FoldChange"   # what gets painted on
entrez_column <- "entrez_id"
symbol_column <- "gene_symbol"
id_column     <- "gene_id"

# Colour only genes that passed significance, leaving the rest grey. FALSE
# paints every measured gene, which shows the overall tilt of the pathway but
# can overstate a weak effect.
significant_only <- FALSE
padj_column <- "padj"
padj_cutoff <- 0.05

# ---------------------------------------------------------------------------
#  PLOT SETTINGS
# ---------------------------------------------------------------------------

# TRUE  the real KEGG diagram as a PNG -- what most people want
# FALSE a Graphviz re-layout, better for very dense pathways
kegg_native <- TRUE

# Colour limit. Fold changes beyond this saturate. Keep it fixed across
# contrasts so the colours mean the same thing in every figure.
value_limit <- 2

colour_low  <- "green"
colour_mid  <- "grey"
colour_high <- "red"

# Also write the unmarked reference diagram alongside the coloured one.
also_plain <- FALSE

# Appended to each output filename, so several runs can sit side by side.
file_suffix <- "de"

# ============================================================================
#  end CONFIG
# ============================================================================


# ---------------------------------------------------------------- packages --

required <- c("pathview")
missing  <- required[!vapply(required, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing) > 0) {
  stop("Missing package(s): ", paste(missing, collapse = ", "), "\n",
       "  install.packages(\"BiocManager\")\n",
       "  BiocManager::install(c(", paste0("\"", missing, "\"", collapse = ", "), "))")
}

suppressPackageStartupMessages(library(pathview))

have <- function(pkg) requireNamespace(pkg, quietly = TRUE)


# ----------------------------------------------------------------- helpers --

# Entrez IDs, looked up only if the table does not already carry them.
# Pathview maps onto KEGG nodes by Entrez ID and nothing else.
ensure_entrez <- function(df) {
  if (entrez_column %in% names(df) && sum(!is.na(df[[entrez_column]])) > 0) {
    return(df)
  }

  if (!have(species_orgdb) || !have("clusterProfiler")) {
    stop("This table has no '", entrez_column, "' column and it cannot be looked up.\n",
         "  Run gene_id_conversion.R first, or install ", species_orgdb,
         " and clusterProfiler.")
  }

  orgdb   <- getExportedValue(species_orgdb, species_orgdb)
  key_col <- if (symbol_column %in% names(df)) symbol_column else id_column
  from    <- if (identical(key_col, symbol_column)) "SYMBOL" else "ENSEMBL"

  mapped <- try(suppressMessages(
    clusterProfiler::bitr(unique(as.character(df[[key_col]])),
                          fromType = from, toType = "ENTREZID", OrgDb = orgdb)
  ), silent = TRUE)

  if (inherits(mapped, "try-error") || nrow(mapped) == 0) {
    stop("Could not map '", key_col, "' to Entrez IDs.")
  }

  mapped <- mapped[!duplicated(mapped[[from]]), ]
  df[[entrez_column]] <- mapped$ENTREZID[
    match(as.character(df[[key_col]]), mapped[[from]])
  ]
  df
}

# A named numeric vector: values keyed by Entrez ID, which is Pathview's
# `gene.data` argument.
build_gene_data <- function(df) {
  keep <- !is.na(df[[entrez_column]]) & !is.na(df[[value_column]])

  if (significant_only && padj_column %in% names(df)) {
    keep <- keep & !is.na(df[[padj_column]]) & df[[padj_column]] <= padj_cutoff
  }

  sub <- df[keep, , drop = FALSE]
  if (nrow(sub) == 0) return(NULL)

  # One Entrez ID can appear twice after conversion. Keep the strongest
  # change, so a gene is painted by its most striking measurement.
  sub <- sub[order(-abs(sub[[value_column]])), ]
  sub <- sub[!duplicated(as.character(sub[[entrez_column]])), ]

  values <- sub[[value_column]]
  names(values) <- as.character(sub[[entrez_column]])
  values
}

# Draw every requested pathway into `target_dir`.
#
# Pathview downloads the KGML and writes its PNGs into the WORKING DIRECTORY
# -- it has no output-path argument. So this changes directory and registers
# the way back with on.exit(), which runs even if pathview throws. That is
# why the work happens inside a function: on.exit() is scoped to a function
# call and does nothing at the top level of a script. Without it, one failed
# pathway leaves every later relative path in the session pointing at the
# wrong folder.
draw_pathways <- function(gene_data, ids, target_dir) {
  old_wd <- setwd(normalizePath(target_dir, mustWork = TRUE))
  on.exit(setwd(old_wd), add = TRUE)

  for (pid in ids) {
    full_id <- paste0(species_kegg, pid)

    result <- try(
      pathview(
        gene.data   = gene_data,
        pathway.id  = pid,
        species     = species_kegg,
        out.suffix  = file_suffix,
        kegg.native = kegg_native,
        limit       = list(gene = value_limit, cpd = 1),
        bins        = list(gene = 20, cpd = 10),
        low         = list(gene = colour_low,  cpd = "blue"),
        mid         = list(gene = colour_mid,  cpd = "gray"),
        high        = list(gene = colour_high, cpd = "yellow"),
        na.col      = "transparent",
        map.null    = also_plain,
        same.layer  = FALSE
      ),
      silent = TRUE
    )

    if (inherits(result, "try-error")) {
      message("    ", full_id, ": failed (",
              conditionMessage(attr(result, "condition")), ")")
    } else {
      message("    ", full_id, ": drawn")
    }
  }
}

# Pathway IDs from a KEGG GSEA run, most significant first.
pathways_from_results <- function(base_dir, contrast_name) {
  candidate <- file.path(base_dir, contrast_name, "KEGG", "GSEA_results.csv")
  if (!file.exists(candidate)) return(character(0))

  res <- read.csv(candidate, check.names = FALSE)
  if (!"ID" %in% names(res) || nrow(res) == 0) return(character(0))

  if ("p.adjust" %in% names(res)) res <- res[order(res$p.adjust), ]

  ids <- utils::head(as.character(res$ID), top_n_from_gsea)
  sub(paste0("^", species_kegg), "", ids)   # strip the prefix; it is re-added
}


# -------------------------------------------------------------------- run --

files <- if (!is.null(input_file)) {
  if (!file.exists(input_file)) stop("Cannot find '", input_file, "'.")
  input_file
} else {
  found <- list.files(input_dir, pattern = "^deseq2_results_annotated\\.csv$",
                      recursive = TRUE, full.names = TRUE)
  if (length(found) == 0) {
    stop("No deseq2_results_annotated.csv found under '", input_dir, "'.\n",
         "  Run deseq2_contrasts.R then gene_id_conversion.R first, ",
         "or set input_file in CONFIG.")
  }
  found
}

message(length(files), " table(s)\n")

for (path in files) {
  contrast_name <- basename(dirname(path))
  message(contrast_name)

  df <- read.csv(path, check.names = FALSE)

  if (!value_column %in% names(df)) {
    stop("Column '", value_column, "' is not in ", path, "\n",
         "  Columns present: ", paste(names(df), collapse = ", "))
  }

  df <- ensure_entrez(df)
  gene_data <- build_gene_data(df)

  if (is.null(gene_data)) {
    message("  no genes left to paint; skipped\n")
    next
  }
  message("  ", length(gene_data), " gene(s) mapped to Entrez IDs")

  ids <- if (!is.null(pathways_from_gsea)) {
    from_gsea <- pathways_from_results(pathways_from_gsea, contrast_name)
    if (length(from_gsea) == 0) {
      message("  no KEGG GSEA results found; falling back to pathway_ids")
      pathway_ids
    } else {
      from_gsea
    }
  } else {
    pathway_ids
  }

  if (length(ids) == 0) {
    message("  no pathways requested; skipped\n")
    next
  }

  target_dir <- file.path(output_dir, contrast_name)
  dir.create(target_dir, recursive = TRUE, showWarnings = FALSE)

  draw_pathways(gene_data, ids, target_dir)

  message("  -> ", target_dir, "\n")
}

message("Done.")
