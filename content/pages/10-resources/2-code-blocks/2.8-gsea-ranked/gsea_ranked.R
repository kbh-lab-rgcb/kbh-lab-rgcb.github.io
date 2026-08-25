#!/usr/bin/env Rscript
# ============================================================================
#  Gene set enrichment (GSEA) from a ranked differential-expression table
# ----------------------------------------------------------------------------
#  Ranks every gene by its test statistic and asks which gene sets sit
#  disproportionately at the top or the bottom of that ranking. Unlike an
#  over-representation test it needs no fold-change cutoff, so it can find a
#  coordinated shift across many genes that individually miss significance.
#
#  INPUT   <input_dir>/<contrast>/deseq2_results_annotated.csv
#  OUTPUT  <output_dir>/<contrast>/<collection>/GSEA_results.csv
#          <output_dir>/<contrast>/<collection>/dotplot.{tiff,svg}
#          <output_dir>/<contrast>/<collection>/ridgeplot.{tiff,svg}
#          <output_dir>/<contrast>/GO/running_score_top.{tiff,svg}
#  NEXT    gsea_bubble_plots.R
#
#  Any organism, any collection. Which collections run is a CONFIG list.
# ============================================================================


# ============================================================================
#  CONFIG -- edit only this section
# ============================================================================

project_root <- "."
input_dir    <- file.path(project_root, "results", "02_deseq2")
output_dir   <- file.path(project_root, "results", "05_gsea")

# Run on every <contrast>/deseq2_results_annotated.csv under input_dir, or
# name a single file.
input_file <- NULL

# --- Column names ---------------------------------------------------------
# The statistic to rank on. DESeq2's `stat` is the Wald statistic and is the
# right choice: it already folds effect size and confidence into one number.
# For edgeR or limma output use the t statistic, or a signed -log10(p).
rank_column   <- "stat"
symbol_column <- "gene_symbol"
entrez_column <- "entrez_id"      # NA is fine; it will be looked up if missing
id_column     <- "gene_id"

# --- Organism -------------------------------------------------------------
# Change these to move species. See gene_id_conversion.R for the full list.
species_orgdb  <- "org.Hs.eg.db"        # org.Mm.eg.db, org.Dm.eg.db, ...
species_kegg   <- "hsa"                 # mmu, dme, ...
species_msigdb <- "Homo sapiens"        # "Mus musculus", ...

# --- Which collections ----------------------------------------------------
# Comment out anything you do not want. GO is the slowest; Hallmark is the
# most readable if you only have time for one.
collections <- c(
  "GO",           # Gene Ontology, via clusterProfiler
  "KEGG",         # KEGG pathways
  "Reactome",     # Reactome pathways (needs ReactomePA)
  "Hallmark",     # MSigDB H -- 50 broad, well-curated processes
  "WikiPathways"  # MSigDB C2 CP:WIKIPATHWAYS
)
# Others available through MSigDB: "C2", "C3", "C4", "C5", "C6", "C7", "C8"

# GO sub-ontology: "BP", "MF", "CC" or "ALL".
go_ontology <- "ALL"

# --- Statistics -----------------------------------------------------------
# Gene sets outside this size range are dropped: very small sets are noisy,
# very large ones are too vague to interpret.
min_gs_size <- 10
max_gs_size <- 500

pvalue_cutoff <- 0.05     # adjusted p-value; loosen to 0.25 for a first look
p_adjust_method <- "BH"

# GSEA is permutation-based, so fix the seed to get the same answer twice.
random_seed <- 123

# ---------------------------------------------------------------------------
#  PLOT SETTINGS
# ---------------------------------------------------------------------------

out_formats <- c("tiff", "svg")
plot_dpi    <- 300

show_categories <- 20     # terms per plot

dotplot_width  <- 8
dotplot_height <- 10

ridgeplot_width  <- 10
ridgeplot_height <- 14
draw_ridgeplot   <- TRUE

# Running-score curves for the strongest few terms -- the classic GSEA figure.
draw_running_score <- TRUE
running_score_n     <- 3
running_score_width  <- 7
running_score_height <- 6

base_size      <- 12
axis_text_size <- 10
label_wrap     <- 45      # wrap long term names at this many characters

# ============================================================================
#  end CONFIG
# ============================================================================


# ---------------------------------------------------------------- packages --

required <- c("clusterProfiler", "enrichplot", "ggplot2", species_orgdb)
if ("Reactome" %in% collections) required <- c(required, "ReactomePA")
if (any(collections %in% c("Hallmark", "WikiPathways", "C2", "C3", "C4", "C5", "C6", "C7", "C8"))) {
  required <- c(required, "msigdbr")
}

missing <- required[!vapply(required, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing) > 0) {
  stop("Missing package(s): ", paste(missing, collapse = ", "), "\n",
       "  install.packages(\"BiocManager\")\n",
       "  BiocManager::install(c(", paste0("\"", missing, "\"", collapse = ", "), "))")
}

suppressPackageStartupMessages({
  library(clusterProfiler)
  library(enrichplot)
  library(ggplot2)
})

orgdb <- getExportedValue(species_orgdb, species_orgdb)


# ----------------------------------------------------------------- helpers --

save_plot <- function(plot_obj, path_without_ext, width, height) {
  for (fmt in out_formats) {
    path <- paste0(path_without_ext, ".", fmt)
    switch(
      fmt,
      tiff = tiff(path, width = width, height = height, units = "in",
                  res = plot_dpi, compression = "lzw"),
      png  = png(path, width = width, height = height, units = "in", res = plot_dpi),
      svg  = svg(path, width = width, height = height),
      pdf  = pdf(path, width = width, height = height),
      stop("Unknown output format: ", fmt)
    )
    print(plot_obj)
    dev.off()
  }
}

# A named, descending vector of statistics -- the input every GSEA wants.
#
# `key` chooses the namespace: "symbol" for GO and MSigDB, "entrez" for KEGG
# and Reactome, which only speak Entrez.
build_ranked_list <- function(df, key) {
  name_col <- if (key == "entrez") entrez_column else symbol_column

  if (!name_col %in% names(df)) {
    if (key == "entrez") return(NULL)
    name_col <- id_column
  }

  keep <- !is.na(df[[rank_column]]) & !is.na(df[[name_col]]) & nzchar(as.character(df[[name_col]]))
  sub  <- df[keep, , drop = FALSE]
  if (nrow(sub) == 0) return(NULL)

  # A gene appearing twice would be ranked twice and counted twice inside a
  # set. Keep the most extreme statistic for each.
  sub <- sub[order(-abs(sub[[rank_column]])), ]
  sub <- sub[!duplicated(as.character(sub[[name_col]])), ]

  ranked <- sub[[rank_column]]
  names(ranked) <- as.character(sub[[name_col]])
  sort(ranked, decreasing = TRUE)
}

# Entrez IDs, looked up only if the annotated table did not already carry them.
ensure_entrez <- function(df) {
  if (entrez_column %in% names(df) && any(!is.na(df[[entrez_column]]))) return(df)

  key_col <- if (symbol_column %in% names(df)) symbol_column else id_column
  from    <- if (identical(key_col, symbol_column)) "SYMBOL" else "ENSEMBL"

  mapped <- try(suppressMessages(
    bitr(unique(as.character(df[[key_col]])), fromType = from,
         toType = "ENTREZID", OrgDb = orgdb)
  ), silent = TRUE)

  if (inherits(mapped, "try-error") || nrow(mapped) == 0) {
    message("    could not map to Entrez IDs; KEGG and Reactome will be skipped")
    return(df)
  }

  mapped <- mapped[!duplicated(mapped[[from]]), ]
  df[[entrez_column]] <- mapped$ENTREZID[match(as.character(df[[key_col]]), mapped[[from]])]
  df
}

wrap_terms <- function(gsea_obj) {
  if (!is.null(label_wrap) && label_wrap > 0) {
    gsea_obj@result$Description <- strwrap_keep(gsea_obj@result$Description, label_wrap)
  }
  gsea_obj
}

strwrap_keep <- function(x, width) {
  vapply(x, function(s) paste(strwrap(s, width = width), collapse = "\n"),
         character(1), USE.NAMES = FALSE)
}

# One MSigDB collection as a TERM2GENE frame, in whichever namespace is asked.
msigdb_sets <- function(collection, subcollection = NULL, key = "symbol") {
  args <- list(species = species_msigdb, category = collection)
  if (!is.null(subcollection)) args$subcategory <- subcollection

  sets <- do.call(msigdbr::msigdbr, args)
  if (nrow(sets) == 0) return(NULL)

  # msigdbr renamed some columns between versions, so accept either spelling.
  gene_col <- if (key == "entrez") {
    intersect(c("entrez_gene", "ncbi_gene"), names(sets))[1]
  } else {
    intersect(c("gene_symbol", "gene_symbol_hgnc"), names(sets))[1]
  }
  if (is.na(gene_col)) return(NULL)

  data.frame(term = sets$gs_name, gene = as.character(sets[[gene_col]]),
             stringsAsFactors = FALSE)
}


# ----------------------------------------------------------- one collection --

run_collection <- function(collection, ranked_symbol, ranked_entrez, out_dir) {
  set.seed(random_seed)

  common <- list(
    minGSSize    = min_gs_size,
    maxGSSize    = max_gs_size,
    pvalueCutoff = pvalue_cutoff,
    pAdjustMethod = p_adjust_method,
    verbose      = FALSE,
    seed         = TRUE
  )

  result <- try(switch(
    collection,

    GO = do.call(gseGO, c(list(
      geneList = ranked_symbol, OrgDb = orgdb,
      keyType = "SYMBOL", ont = go_ontology
    ), common)),

    KEGG = {
      if (is.null(ranked_entrez)) return(NULL)
      do.call(gseKEGG, c(list(
        geneList = ranked_entrez, organism = species_kegg, keyType = "kegg"
      ), common))
    },

    Reactome = {
      if (is.null(ranked_entrez)) return(NULL)
      reactome_species <- switch(
        species_kegg,
        hsa = "human", mmu = "mouse", rno = "rat",
        dme = "fly", dre = "zebrafish", cel = "celegans", sce = "yeast",
        "human"
      )
      do.call(ReactomePA::gsePathway, c(list(
        geneList = ranked_entrez, organism = reactome_species
      ), common))
    },

    # Everything else is an MSigDB collection.
    {
      spec <- switch(
        collection,
        Hallmark     = list(cat = "H",  sub = NULL),
        WikiPathways = list(cat = "C2", sub = "CP:WIKIPATHWAYS"),
        list(cat = collection, sub = NULL)
      )
      term2gene <- msigdb_sets(spec$cat, spec$sub, key = "symbol")
      if (is.null(term2gene)) return(NULL)

      do.call(GSEA, c(list(geneList = ranked_symbol, TERM2GENE = term2gene), common))
    }
  ), silent = TRUE)

  if (inherits(result, "try-error")) {
    message("    ", collection, ": failed (", conditionMessage(attr(result, "condition")), ")")
    return(NULL)
  }
  if (is.null(result) || nrow(as.data.frame(result)) == 0) {
    message("    ", collection, ": nothing significant at padj <= ", pvalue_cutoff)
    return(NULL)
  }

  df <- as.data.frame(result)
  message("    ", collection, ": ", nrow(df), " term(s) -- ",
          sum(df$NES > 0), " up, ", sum(df$NES < 0), " down")

  dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
  write.csv(df, file.path(out_dir, "GSEA_results.csv"), row.names = FALSE)

  wrapped <- wrap_terms(result)
  n_show  <- min(show_categories, nrow(df))

  styling <- theme(
    axis.text.y  = element_text(size = axis_text_size),
    plot.title   = element_text(face = "bold", hjust = 0.5)
  )

  save_plot(
    dotplot(wrapped, showCategory = n_show, split = ".sign") +
      facet_grid(. ~ .sign) +
      ggtitle(collection) +
      theme_bw(base_size = base_size) + styling,
    file.path(out_dir, "dotplot"), dotplot_width, dotplot_height
  )

  if (draw_ridgeplot) {
    ridge <- try(
      ridgeplot(wrapped, showCategory = n_show) +
        ggtitle(collection) +
        theme_bw(base_size = base_size) + styling,
      silent = TRUE
    )
    if (!inherits(ridge, "try-error")) {
      save_plot(ridge, file.path(out_dir, "ridgeplot"),
                ridgeplot_width, ridgeplot_height)
    }
  }

  result
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

message(length(files), " table(s) to analyse\n")

for (path in files) {
  contrast_name <- basename(dirname(path))
  message(contrast_name)

  df <- read.csv(path, check.names = FALSE)

  if (!rank_column %in% names(df)) {
    stop("Ranking column '", rank_column, "' is not in ", path, "\n",
         "  Columns present: ", paste(names(df), collapse = ", "))
  }

  needs_entrez <- any(c("KEGG", "Reactome") %in% collections)
  if (needs_entrez) df <- ensure_entrez(df)

  ranked_symbol <- build_ranked_list(df, "symbol")
  ranked_entrez <- if (needs_entrez) build_ranked_list(df, "entrez") else NULL

  if (is.null(ranked_symbol)) {
    message("  no usable ranked list; skipped\n")
    next
  }
  message("  ranked ", length(ranked_symbol), " gene(s)")

  first_go <- NULL

  for (collection in collections) {
    out_dir <- file.path(output_dir, contrast_name, collection)
    obj <- run_collection(collection, ranked_symbol, ranked_entrez, out_dir)
    if (collection == "GO" && !is.null(obj)) first_go <- obj
  }

  # The classic running-score curve, for the few strongest terms.
  if (draw_running_score && !is.null(first_go)) {
    res <- as.data.frame(first_go)
    res <- res[order(res$p.adjust), ]
    n   <- min(running_score_n, nrow(res))

    if (n > 0) {
      go_dir <- file.path(output_dir, contrast_name, "GO")
      curve <- try(
        gseaplot2(first_go, geneSetID = seq_len(n),
                  title = paste0(contrast_name, " -- top ", n, " GO terms")),
        silent = TRUE
      )
      if (!inherits(curve, "try-error")) {
        save_plot(curve, file.path(go_dir, "running_score_top"),
                  running_score_width, running_score_height)
        message("    running-score curves for the top ", n, " term(s)")
      }
    }
  }

  message("")
}

message("Done. Next: gsea_bubble_plots.R")
