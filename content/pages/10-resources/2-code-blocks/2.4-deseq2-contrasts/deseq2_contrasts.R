#!/usr/bin/env Rscript
# ============================================================================
#  Differential expression across any number of groups
# ----------------------------------------------------------------------------
#  Reads one counts CSV per group, builds a DESeqDataSet for each contrast you
#  ask for, and writes a results table per contrast.
#
#  INPUT   one CSV per group: genes down the rows, samples across the columns
#  OUTPUT  <output_dir>/<contrast>/deseq2_results.csv
#          <output_dir>/dds_objects.rds   (for clustering and pathway scoring)
#  NEXT    gene_id_conversion.R, then volcano_heatmap.R
#
#  Two groups or ten: nothing in this script counts them. The counts can come
#  from anywhere that writes a genes-by-samples matrix -- featureCounts,
#  tximport, a GEO supplementary file, the GDC, a spreadsheet.
# ============================================================================


# ============================================================================
#  CONFIG -- edit only this section
# ============================================================================

project_root <- "."
output_dir   <- file.path(project_root, "results", "02_deseq2")

# --- The groups -----------------------------------------------------------
# Name -> path to that group's counts CSV. Add or remove entries freely.
groups <- list(
  control = file.path(project_root, "results", "01_counts", "control.csv"),
  treated = file.path(project_root, "results", "01_counts", "treated.csv")
)

# --- Which comparisons ----------------------------------------------------
# "all_pairs" compares every group with every other one.
# Or list them yourself, as c(numerator, denominator).
contrasts <- "all_pairs"
# contrasts <- list(
#   c("treated", "control")
# )

# --- Optional: merge groups, then compare the merged ones -----------------
# Pools several groups into one so it can be contrasted as a single group --
# for instance every mutant against wild type. Leave empty to skip.
meta_groups <- list()
# meta_groups <- list(
#   mutant = c("ko1", "ko2", "ko3")
# )
# Contrasts involving a merged group are written the same way:
# contrasts <- list(c("mutant", "wt"))

# --- Counts handling ------------------------------------------------------
# Strip Ensembl version suffixes: ENSG00000141510.16 -> ENSG00000141510.
# Turn off for matrices keyed by symbol or Entrez ID.
strip_ensembl_version <- TRUE

# Drop genes with fewer than this many reads summed across all samples. 10 is
# the DESeq2 vignette suggestion: it speeds things up and slightly improves
# the multiple-testing correction. Set to 0 to keep everything.
min_total_count <- 10

# Significance level for independent filtering and the printed summary.
alpha <- 0.05

# Shrink log2 fold changes. Gives better ranking for low-count genes and a
# more honest volcano plot, at the cost of some time. Needs the ashr package.
shrink_lfc <- FALSE

# ============================================================================
#  end CONFIG
# ============================================================================


# ---------------------------------------------------------------- packages --

required <- c("DESeq2")
if (shrink_lfc) required <- c(required, "ashr")

missing <- required[!vapply(required, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing) > 0) {
  stop(
    "Missing package(s): ", paste(missing, collapse = ", "), "\n",
    "  install.packages(\"BiocManager\")\n",
    "  BiocManager::install(c(", paste0("\"", missing, "\"", collapse = ", "), "))"
  )
}

suppressPackageStartupMessages(library(DESeq2))


# ----------------------------------------------------------------- helpers --

# Read one group's counts as a numeric matrix with gene IDs as rownames.
read_counts <- function(path, group_name) {
  if (!file.exists(path)) {
    stop(
      "Cannot find the counts file for group '", group_name, "':\n  ", path, "\n",
      "  Run gdc_download.R first, or point `groups` in CONFIG at your own files."
    )
  }

  raw <- read.csv(path, row.names = 1, check.names = FALSE)

  # A non-numeric column is usually an annotation column that travelled with
  # the matrix (gene_name, gene_type). Drop it rather than failing.
  numeric_cols <- vapply(raw, is.numeric, logical(1))
  if (any(!numeric_cols)) {
    message("  '", group_name, "': dropping non-numeric column(s): ",
            paste(names(raw)[!numeric_cols], collapse = ", "))
    raw <- raw[, numeric_cols, drop = FALSE]
  }
  if (ncol(raw) == 0) stop("Group '", group_name, "' has no numeric columns.")

  mat <- as.matrix(raw)

  if (strip_ensembl_version) {
    rownames(mat) <- sub("\\.[0-9]+$", "", rownames(mat))
  }

  # Version-stripping can create duplicate IDs. Sum them, so no counts are
  # silently discarded.
  if (any(duplicated(rownames(mat)))) {
    message("  '", group_name, "': summing ", sum(duplicated(rownames(mat))),
            " duplicate gene ID(s)")
    mat <- rowsum(mat, rownames(mat))
  }

  mat
}

# Every unordered pair of names, as c(numerator, denominator).
#
# The earlier group in `groups` becomes the denominator, so if groups are
# listed in increasing order of dose or severity a positive fold change reads
# as "up in the more treated group".
all_pairs_of <- function(names_vec) {
  if (length(names_vec) < 2) {
    stop("Need at least two groups to compare. Found: ", length(names_vec))
  }
  lapply(utils::combn(names_vec, 2, simplify = FALSE), function(p) c(p[2], p[1]))
}


# -------------------------------------------------------------- load counts --

message("Reading counts ...")

matrices <- list()
for (group_name in names(groups)) {
  matrices[[group_name]] <- read_counts(groups[[group_name]], group_name)
  message(sprintf("  %-14s %6d genes x %3d samples",
                  group_name,
                  nrow(matrices[[group_name]]),
                  ncol(matrices[[group_name]])))
}

# A merged group is an ordinary group from here on, which is why the rest of
# the script needs no notion of merging at all.
for (meta_name in names(meta_groups)) {
  parts <- meta_groups[[meta_name]]

  unknown <- setdiff(parts, names(matrices))
  if (length(unknown) > 0) {
    stop("meta_groups[\"", meta_name, "\"] refers to unknown group(s): ",
         paste(unknown, collapse = ", "))
  }
  if (meta_name %in% names(matrices)) {
    stop("meta_groups[\"", meta_name, "\"] has the same name as a real group.")
  }

  shared_parts <- Reduce(intersect, lapply(matrices[parts], rownames))
  matrices[[meta_name]] <- do.call(
    cbind,
    lapply(parts, function(p) matrices[[p]][shared_parts, , drop = FALSE])
  )

  message(sprintf("  %-14s %6d genes x %3d samples  (merged: %s)",
                  meta_name,
                  nrow(matrices[[meta_name]]),
                  ncol(matrices[[meta_name]]),
                  paste(parts, collapse = " + ")))
}


# --------------------------------------------------------- resolve contrasts --

contrast_list <- if (identical(contrasts, "all_pairs")) {
  all_pairs_of(names(groups))
} else {
  contrasts
}

if (length(contrast_list) == 0) stop("No contrasts to run.")

for (co in contrast_list) {
  if (length(co) != 2) {
    stop("Each contrast needs exactly two group names, got: ",
         paste(co, collapse = ", "))
  }
  unknown <- setdiff(co, names(matrices))
  if (length(unknown) > 0) {
    stop("Contrast ", paste(co, collapse = " vs "),
         " refers to unknown group(s): ", paste(unknown, collapse = ", "))
  }
}

message("\n", length(contrast_list), " contrast(s): ",
        paste(vapply(contrast_list,
                     function(x) paste(x, collapse = " vs "), character(1)),
              collapse = ", "))


# --------------------------------------------------------------- run DESeq2 --

# One contrast, start to finish.
#
# DIRECTION: results() is called as contrast = c("condition", g1, g2), so
#   positive log2FoldChange = higher in g1 (the first name)
#   negative log2FoldChange = higher in g2 (the second name)
# Every downstream block relies on that convention.
run_one_contrast <- function(g1, g2) {
  mat1 <- matrices[[g1]]
  mat2 <- matrices[[g2]]

  shared <- intersect(rownames(mat1), rownames(mat2))
  if (length(shared) == 0) {
    stop("Groups '", g1, "' and '", g2, "' share no gene IDs. ",
         "Are they annotated the same way?")
  }

  combined <- cbind(mat1[shared, , drop = FALSE], mat2[shared, , drop = FALSE])

  condition <- factor(
    c(rep(g1, ncol(mat1)), rep(g2, ncol(mat2))),
    levels = c(g2, g1)   # reference level first
  )

  coldata <- data.frame(condition = condition)
  rownames(coldata) <- colnames(combined)

  dds <- DESeqDataSetFromMatrix(
    countData = round(combined),
    colData   = coldata,
    design    = ~ condition
  )

  if (min_total_count > 0) {
    keep <- rowSums(counts(dds)) >= min_total_count
    message("  dropped ", sum(!keep), " low-count gene(s), ", sum(keep), " left")
    dds <- dds[keep, ]
  }

  dds <- DESeq(dds, quiet = TRUE)
  res <- results(dds, contrast = c("condition", g1, g2), alpha = alpha)

  if (shrink_lfc) {
    res <- lfcShrink(dds, contrast = c("condition", g1, g2), res = res, type = "ashr")
  }

  res_df <- as.data.frame(res)
  res_df$gene_id <- rownames(res_df)

  # Carried in the file so a table opened months later still says which way
  # round the comparison ran.
  res_df$contrast_numerator   <- g1
  res_df$contrast_denominator <- g2

  res_df <- res_df[order(res_df$padj, na.last = TRUE), ]

  list(res = res_df, dds = dds)
}

dds_objects <- list()

for (co in contrast_list) {
  g1 <- co[1]
  g2 <- co[2]
  name <- paste0(g1, "_vs_", g2)

  message("\n", name)
  out <- run_one_contrast(g1, g2)

  contrast_dir <- file.path(output_dir, name)
  dir.create(contrast_dir, recursive = TRUE, showWarnings = FALSE)

  write.csv(out$res, file.path(contrast_dir, "deseq2_results.csv"), row.names = FALSE)

  up   <- sum(out$res$padj <= alpha & out$res$log2FoldChange > 0, na.rm = TRUE)
  down <- sum(out$res$padj <= alpha & out$res$log2FoldChange < 0, na.rm = TRUE)
  message(sprintf("  %d up in %s, %d up in %s (padj <= %g)", up, g1, down, g2, alpha))
  message("  -> ", file.path(contrast_dir, "deseq2_results.csv"))

  dds_objects[[name]] <- out$dds
}


# ------------------------------------------------ one object for all groups --

# Clustering and pathway scoring look at every sample at once rather than a
# pair, so they get their own DESeqDataSet built from all the real groups.
# Merged groups are left out: their samples are already in the real ones, and
# including both would duplicate every column.
message("\nBuilding a combined object for clustering and pathway scoring ...")

real_groups <- names(groups)
shared_all  <- Reduce(intersect, lapply(matrices[real_groups], rownames))

if (length(shared_all) == 0) {
  warning("Groups share no gene IDs; the combined object was not built.")
} else {
  combined_all <- do.call(
    cbind,
    lapply(real_groups, function(g) matrices[[g]][shared_all, , drop = FALSE])
  )

  group_labels <- unlist(lapply(real_groups, function(g) rep(g, ncol(matrices[[g]]))))

  sample_info <- data.frame(group = factor(group_labels, levels = real_groups))
  rownames(sample_info) <- colnames(combined_all)

  dds_all <- DESeqDataSetFromMatrix(
    countData = round(combined_all),
    colData   = sample_info,
    design    = ~ group
  )

  if (min_total_count > 0) {
    dds_all <- dds_all[rowSums(counts(dds_all)) >= min_total_count, ]
  }

  dds_objects[["__all_groups__"]] <- dds_all
  message("  ", ncol(dds_all), " samples across ", length(real_groups), " group(s)")
}

dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
saveRDS(dds_objects, file.path(output_dir, "dds_objects.rds"))
message("  -> ", file.path(output_dir, "dds_objects.rds"))

message("\nDone. Next: gene_id_conversion.R")
