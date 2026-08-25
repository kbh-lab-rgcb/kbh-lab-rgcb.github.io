#!/usr/bin/env Rscript
# ============================================================================
#  Per-sample pathway scores (ssGSEA / GSVA)
# ----------------------------------------------------------------------------
#  GSEA gives one enrichment score per comparison. ssGSEA gives one score per
#  pathway PER SAMPLE, which turns a pathway into an ordinary variable you can
#  plot, correlate against clinical data, or test between groups.
#
#  INPUT   the dds_objects.rds from deseq2_contrasts.R, or any counts CSV
#  OUTPUT  <output_dir>/<collection>/scores.csv       pathways x samples
#          <output_dir>/<collection>/heatmap.{tiff,svg}
#          <output_dir>/sample_groups.csv
#  NEXT    pathway_score_testing.R
#
#  Any organism, any collection, and any custom GMT file -- so an in-house
#  signature list works exactly like a published one.
# ============================================================================


# ============================================================================
#  CONFIG -- edit only this section
# ============================================================================

project_root <- "."
output_dir   <- file.path(project_root, "results", "06_ssgsea")

# --- Input: pick ONE route ------------------------------------------------
# Route A -- the object from deseq2_contrasts.R.
dds_file <- file.path(project_root, "results", "02_deseq2", "dds_objects.rds")
dds_name <- "__all_groups__"

# Route B -- your own matrix, plus a sample sheet naming each sample's group.
counts_file   <- NULL
sample_sheet  <- NULL
sample_column <- "sample"
group_column  <- "group"

# --- Organism -------------------------------------------------------------
species_orgdb  <- "org.Hs.eg.db"
species_msigdb <- "Homo sapiens"

# Row identifiers in your matrix: "ensembl", "symbol" or "entrez".
# MSigDB sets are matched on symbols, so anything else is converted first.
row_id_type <- "ensembl"

# --- Which gene sets ------------------------------------------------------
# MSigDB collections to score. Comment out what you do not need -- each one
# adds minutes.
collections <- c(
  "Hallmark"      # H  -- 50 broad processes, the usual starting point
  # "C2_REACTOME",  # C2 CP:REACTOME
  # "C2_WIKI",      # C2 CP:WIKIPATHWAYS
  # "C5_GO_BP",     # C5 GO:BP
  # "C6",           # oncogenic signatures
  # "C7"            # immunologic signatures
)

# Any number of your own GMT files: name -> path. Runs alongside the
# collections above, or instead of them if `collections` is empty.
custom_gmt <- list()
# custom_gmt <- list(
#   my_signatures = file.path(project_root, "gene_sets", "my_signatures.gmt")
# )

# --- Scoring --------------------------------------------------------------
# "ssgsea"  per-sample enrichment score, the usual choice
# "gsva"    GSVA's own kernel-based score
# "plage", "zscore"  simpler alternatives
method <- "ssgsea"

# Variance-stabilising transform applied before scoring. ssGSEA ranks genes
# within a sample, so it needs values on a comparable scale, not raw counts.
transform <- "vst"

# Drop sets with fewer / more than this many genes present in your matrix.
min_set_size <- 10
max_set_size <- 500

# ---------------------------------------------------------------------------
#  PLOT SETTINGS
# ---------------------------------------------------------------------------

out_formats <- c("tiff", "svg")
plot_dpi    <- 300

draw_heatmap  <- TRUE
top_n_pathways <- 25          # most variable pathways shown

heatmap_width  <- 10
heatmap_height <- 10
heatmap_colours <- c("#2166ac", "white", "#b2182b")
heatmap_fontsize_row <- 8
heatmap_cluster_rows <- TRUE
heatmap_cluster_cols <- FALSE   # FALSE keeps samples in group order
heatmap_show_colnames <- FALSE

# Trim long set names to keep the row labels readable.
max_name_length <- 55

# ============================================================================
#  end CONFIG
# ============================================================================


# ---------------------------------------------------------------- packages --

required <- c("GSVA", "pheatmap", "matrixStats")
if (length(collections) > 0) required <- c(required, "msigdbr")
if (length(custom_gmt) > 0)  required <- c(required, "GSEABase")
if (transform != "none")     required <- c(required, "DESeq2")
if (row_id_type != "symbol") required <- c(required, species_orgdb, "clusterProfiler")

missing <- required[!vapply(required, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing) > 0) {
  stop("Missing package(s): ", paste(missing, collapse = ", "), "\n",
       "  install.packages(\"BiocManager\")\n",
       "  BiocManager::install(c(", paste0("\"", missing, "\"", collapse = ", "), "))")
}

suppressPackageStartupMessages({
  library(GSVA)
  library(pheatmap)
  library(matrixStats)
})


# ----------------------------------------------------------------- helpers --

save_plot <- function(draw_fn, path_without_ext, width, height) {
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
    draw_fn()
    dev.off()
  }
}

# Relabel matrix rows as gene symbols, because that is the namespace MSigDB
# and most published GMT files use.
to_symbols <- function(mat) {
  if (row_id_type == "symbol") return(mat)

  orgdb <- getExportedValue(species_orgdb, species_orgdb)
  from  <- if (row_id_type == "entrez") "ENTREZID" else "ENSEMBL"

  mapped <- try(suppressMessages(
    clusterProfiler::bitr(rownames(mat), fromType = from,
                          toType = "SYMBOL", OrgDb = orgdb)
  ), silent = TRUE)

  if (inherits(mapped, "try-error") || nrow(mapped) == 0) {
    warning("Could not convert row IDs to symbols; using them as they are.")
    return(mat)
  }

  mapped <- mapped[!duplicated(mapped[[from]]), ]
  keep   <- rownames(mat) %in% mapped[[from]]
  out    <- mat[keep, , drop = FALSE]
  rownames(out) <- mapped$SYMBOL[match(rownames(out), mapped[[from]])]

  # A symbol arriving twice would be scored twice inside a set; keep the copy
  # with the most signal.
  out <- out[order(-rowVars(out)), , drop = FALSE]
  out[!duplicated(rownames(out)), , drop = FALSE]
}

msigdb_list <- function(key) {
  spec <- switch(
    key,
    Hallmark    = list(cat = "H",  sub = NULL),
    C2_REACTOME = list(cat = "C2", sub = "CP:REACTOME"),
    C2_WIKI     = list(cat = "C2", sub = "CP:WIKIPATHWAYS"),
    C2_KEGG     = list(cat = "C2", sub = "CP:KEGG"),
    C5_GO_BP    = list(cat = "C5", sub = "GO:BP"),
    C5_GO_CC    = list(cat = "C5", sub = "GO:CC"),
    C5_GO_MF    = list(cat = "C5", sub = "GO:MF"),
    list(cat = key, sub = NULL)
  )

  args <- list(species = species_msigdb, category = spec$cat)
  if (!is.null(spec$sub)) args$subcategory <- spec$sub

  sets <- try(do.call(msigdbr::msigdbr, args), silent = TRUE)
  if (inherits(sets, "try-error") || nrow(sets) == 0) return(NULL)

  split(as.character(sets$gene_symbol), sets$gs_name)
}

trim_names <- function(x) {
  ifelse(nchar(x) > max_name_length,
         paste0(substr(x, 1, max_name_length - 3), "..."),
         x)
}


# -------------------------------------------------------------- load input --

if (!is.null(counts_file)) {
  if (!file.exists(counts_file)) stop("Cannot find '", counts_file, "'.")

  raw  <- read.csv(counts_file, row.names = 1, check.names = FALSE)
  expr <- as.matrix(raw[, vapply(raw, is.numeric, logical(1)), drop = FALSE])

  if (is.null(sample_sheet) || !file.exists(sample_sheet)) {
    stop("counts_file needs a sample_sheet naming each sample's group.")
  }
  sheet  <- read.csv(sample_sheet, check.names = FALSE)
  shared <- intersect(colnames(expr), as.character(sheet[[sample_column]]))
  if (length(shared) == 0) stop("Counts and sample sheet share no sample names.")

  expr   <- expr[, shared, drop = FALSE]
  groups <- factor(sheet[[group_column]][match(shared, sheet[[sample_column]])])

  if (transform != "none") {
    suppressPackageStartupMessages(library(DESeq2))
    dds  <- DESeqDataSetFromMatrix(round(expr),
                                   data.frame(group = groups, row.names = shared),
                                   ~ group)
    expr <- assay(if (transform == "rlog") rlog(dds, blind = FALSE)
                  else vst(dds, blind = FALSE))
  }

} else {
  if (!file.exists(dds_file)) {
    stop("Cannot find '", dds_file, "'.\n",
         "  Run deseq2_contrasts.R first, or set counts_file in CONFIG.")
  }

  suppressPackageStartupMessages(library(DESeq2))
  objects <- readRDS(dds_file)

  if (!dds_name %in% names(objects)) {
    stop("'", dds_name, "' is not in that file.\n",
         "  Available: ", paste(names(objects), collapse = ", "))
  }

  dds <- objects[[dds_name]]
  group_col_found <- intersect(c("group", "condition"), names(colData(dds)))
  if (length(group_col_found) == 0) stop("No group column in that object.")
  groups <- factor(colData(dds)[[group_col_found[1]]])

  expr <- assay(if (transform == "rlog") rlog(dds, blind = FALSE)
                else if (transform == "vst") vst(dds, blind = FALSE)
                else dds)
}

message("Matrix: ", nrow(expr), " genes x ", ncol(expr), " samples")

expr <- to_symbols(expr)
message("After ID conversion: ", nrow(expr), " genes")

dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)

sample_groups <- data.frame(sample = colnames(expr), group = as.character(groups))
write.csv(sample_groups, file.path(output_dir, "sample_groups.csv"), row.names = FALSE)

annotation <- data.frame(Group = groups)
rownames(annotation) <- colnames(expr)


# ------------------------------------------------------- assemble gene sets --

set_sources <- list()

for (key in collections) {
  sets <- msigdb_list(key)
  if (is.null(sets)) {
    message("Could not load MSigDB collection '", key, "'; skipped.")
    next
  }
  set_sources[[key]] <- sets
}

for (key in names(custom_gmt)) {
  path <- custom_gmt[[key]]
  if (!file.exists(path)) {
    message("GMT not found, skipped: ", path)
    next
  }
  gmt <- GSEABase::getGmt(path)
  set_sources[[key]] <- GSEABase::geneIds(gmt)
}

if (length(set_sources) == 0) {
  stop("No gene sets to score. Add a collection or a custom GMT in CONFIG.")
}


# ------------------------------------------------------------------- score --

for (key in names(set_sources)) {
  message("\n", key, ": ", length(set_sources[[key]]), " set(s)")

  # GSVA 2.x takes a parameter object; earlier versions took the arguments
  # directly. Support both so the script does not break on either.
  scores <- if (exists("ssgseaParam", where = asNamespace("GSVA"))) {
    param <- switch(
      method,
      ssgsea = GSVA::ssgseaParam(exprData = expr, geneSets = set_sources[[key]],
                                 minSize = min_set_size, maxSize = max_set_size),
      gsva   = GSVA::gsvaParam(exprData = expr, geneSets = set_sources[[key]],
                               minSize = min_set_size, maxSize = max_set_size),
      plage  = GSVA::plageParam(exprData = expr, geneSets = set_sources[[key]],
                                minSize = min_set_size, maxSize = max_set_size),
      zscore = GSVA::zscoreParam(exprData = expr, geneSets = set_sources[[key]],
                                 minSize = min_set_size, maxSize = max_set_size),
      stop("Unknown method: ", method)
    )
    GSVA::gsva(param, verbose = FALSE)
  } else {
    GSVA::gsva(expr, set_sources[[key]], method = method,
               min.sz = min_set_size, max.sz = max_set_size, verbose = FALSE)
  }

  if (nrow(scores) == 0) {
    message("  no set had enough genes present in the matrix; skipped")
    next
  }
  message("  scored ", nrow(scores), " set(s) across ", ncol(scores), " samples")

  target_dir <- file.path(output_dir, key)
  dir.create(target_dir, recursive = TRUE, showWarnings = FALSE)

  write.csv(scores, file.path(target_dir, "scores.csv"))
  message("  -> ", file.path(target_dir, "scores.csv"))

  if (draw_heatmap && nrow(scores) >= 2) {
    n_show <- min(top_n_pathways, nrow(scores))
    top    <- order(rowVars(scores), decreasing = TRUE)[seq_len(n_show)]
    sub    <- scores[top, , drop = FALSE]
    rownames(sub) <- trim_names(rownames(sub))

    save_plot(
      function() {
        pheatmap(
          sub,
          scale          = "row",
          annotation_col = annotation,
          cluster_rows   = heatmap_cluster_rows,
          cluster_cols   = heatmap_cluster_cols,
          color          = colorRampPalette(heatmap_colours)(50),
          fontsize_row   = heatmap_fontsize_row,
          show_colnames  = heatmap_show_colnames,
          main           = paste0(key, ": ", n_show, " most variable sets")
        )
      },
      file.path(target_dir, "heatmap"), heatmap_width, heatmap_height
    )
    message("  -> ", file.path(target_dir, "heatmap.*"))
  }
}

message("\nDone. Next: pathway_score_testing.R")
