#!/usr/bin/env Rscript
# ============================================================================
#  PCA, UMAP and k-means on an expression matrix
# ----------------------------------------------------------------------------
#  Asks whether the samples separate by group without being told the groups.
#  If the k-means clusters line up with your labels, the effect is strong; if
#  they do not, it is subtle or confounded -- both worth knowing before you
#  read too much into a gene list.
#
#  INPUT   the dds_objects.rds written by deseq2_contrasts.R,
#          OR any counts CSV plus a sample sheet
#  OUTPUT  <output_dir>/PCA.{tiff,svg}, UMAP.{tiff,svg},
#          PCA_kmeans.{tiff,svg}, confusion_matrix.txt, sample_coordinates.csv
#
#  Any number of groups. The number of k-means clusters defaults to the number
#  of groups you have, whatever that is.
# ============================================================================


# ============================================================================
#  CONFIG -- edit only this section
# ============================================================================

project_root <- "."
output_dir   <- file.path(project_root, "results", "04_clustering")

# --- Input: pick ONE route ------------------------------------------------
# Route A -- the object written by deseq2_contrasts.R. Leave as-is to use it.
dds_file <- file.path(project_root, "results", "02_deseq2", "dds_objects.rds")
dds_name <- "__all_groups__"   # which element of that list to use

# Route B -- your own matrix. Set counts_file and the script ignores route A.
counts_file <- NULL
# counts_file <- file.path(project_root, "counts.csv")

# Sample sheet for route B: a CSV with a sample column and a group column.
sample_sheet <- NULL
# sample_sheet <- file.path(project_root, "results", "01_counts", "sample_sheet.csv")
sample_column <- "sample"
group_column  <- "group"

# --- Analysis -------------------------------------------------------------
# How many of the most variable genes to use. The point of restricting is to
# stop thousands of flat, uninformative genes drowning the signal; 500 to 2000
# is the usual range.
n_top_genes <- 500

# Variance-stabilising transform. "vst" is fast and fine above ~30 samples;
# "rlog" behaves better on very small experiments; "none" if you are supplying
# an already-normalised matrix through counts_file.
transform <- "vst"

# k-means clusters. NULL means "one per group".
n_clusters <- NULL

# Fixed so the same data gives the same clusters and the same UMAP every run.
random_seed <- 123

# Draw UMAP too. Needs the umap package, and it is meaningless below about
# 15 samples, so it is skipped automatically when there are too few.
do_umap <- TRUE
umap_min_samples <- 15

# ---------------------------------------------------------------------------
#  PLOT SETTINGS
# ---------------------------------------------------------------------------

out_formats <- c("tiff", "svg")
plot_dpi    <- 300

plot_width  <- 7
plot_height <- 5
base_size   <- 14

point_size  <- 3
point_alpha <- 0.9

# NULL uses ggplot's default palette, which handles any number of groups.
# Give a character vector of colours to fix them.
group_colours <- NULL

# Label each point with its sample name. Useful for spotting an outlier,
# cluttered above about 30 samples.
label_points <- FALSE
label_size   <- 2.5

draw_ellipses <- FALSE   # 95% confidence ellipse per group; needs >=4 per group
legend_pos    <- "right"

# ============================================================================
#  end CONFIG
# ============================================================================


# ---------------------------------------------------------------- packages --

required <- c("ggplot2", "matrixStats")
if (is.null(counts_file) || transform != "none") required <- c(required, "DESeq2")
if (do_umap) required <- c(required, "umap")
if (label_points) required <- c(required, "ggrepel")

missing <- required[!vapply(required, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing) > 0) {
  stop("Missing package(s): ", paste(missing, collapse = ", "), "\n",
       "  install.packages(\"BiocManager\")\n",
       "  BiocManager::install(c(", paste0("\"", missing, "\"", collapse = ", "), "))")
}

suppressPackageStartupMessages({
  library(ggplot2)
  library(matrixStats)
})


# ----------------------------------------------------------------- helpers --

save_plot <- function(plot_obj, path_without_ext, width = plot_width, height = plot_height) {
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

# Shared styling, so PCA and UMAP cannot drift apart visually.
scatter <- function(df, x, y, colour_by, title, xlab, ylab) {
  p <- ggplot(df, aes(x = .data[[x]], y = .data[[y]], colour = .data[[colour_by]])) +
    geom_point(size = point_size, alpha = point_alpha) +
    labs(title = title, x = xlab, y = ylab, colour = NULL) +
    theme_minimal(base_size = base_size) +
    theme(legend.position = legend_pos, plot.title = element_text(face = "bold"))

  if (!is.null(group_colours)) p <- p + scale_colour_manual(values = group_colours)

  if (draw_ellipses && min(table(df[[colour_by]])) >= 4) {
    p <- p + stat_ellipse(level = 0.95, linewidth = 0.4, show.legend = FALSE)
  }

  if (label_points) {
    p <- p + ggrepel::geom_text_repel(
      aes(label = .data$sample), size = label_size,
      max.overlaps = Inf, show.legend = FALSE
    )
  }

  p
}


# -------------------------------------------------------------- load input --

if (!is.null(counts_file)) {
  if (!file.exists(counts_file)) stop("Cannot find '", counts_file, "'.")

  message("Reading ", counts_file)
  raw <- read.csv(counts_file, row.names = 1, check.names = FALSE)
  expr <- as.matrix(raw[, vapply(raw, is.numeric, logical(1)), drop = FALSE])

  if (is.null(sample_sheet) || !file.exists(sample_sheet)) {
    stop("counts_file needs a sample_sheet naming each sample's group.")
  }
  sheet <- read.csv(sample_sheet, check.names = FALSE)

  for (needed in c(sample_column, group_column)) {
    if (!needed %in% names(sheet)) {
      stop("Column '", needed, "' is not in the sample sheet.\n",
           "  Columns present: ", paste(names(sheet), collapse = ", "))
    }
  }

  shared <- intersect(colnames(expr), as.character(sheet[[sample_column]]))
  if (length(shared) == 0) {
    stop("No sample names are shared between the counts matrix and the sample sheet.")
  }
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

  message("Reading ", dds_file)
  suppressPackageStartupMessages(library(DESeq2))

  objects <- readRDS(dds_file)
  if (!dds_name %in% names(objects)) {
    stop("'", dds_name, "' is not in that file.\n",
         "  Available: ", paste(names(objects), collapse = ", "))
  }

  dds <- objects[[dds_name]]

  # The combined object is built with a `group` column; a per-contrast one
  # uses `condition`. Accept whichever is there.
  group_col_found <- intersect(c("group", "condition"), names(colData(dds)))
  if (length(group_col_found) == 0) {
    stop("No group column found in that object's colData.")
  }
  groups <- factor(colData(dds)[[group_col_found[1]]])

  expr <- assay(if (transform == "rlog") rlog(dds, blind = FALSE)
                else if (transform == "vst") vst(dds, blind = FALSE)
                else dds)
}

message("Matrix: ", nrow(expr), " genes x ", ncol(expr), " samples")
message("Groups: ", paste(sprintf("%s (%d)", levels(groups), table(groups)),
                          collapse = ", "))

if (ncol(expr) < 3) stop("Need at least three samples to cluster.")

dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)


# ------------------------------------------------- most variable genes --

n_use <- min(n_top_genes, nrow(expr))
vars  <- rowVars(expr)
top   <- order(vars, decreasing = TRUE)[seq_len(n_use)]
expr_top <- expr[top, , drop = FALSE]

message("Using the ", n_use, " most variable gene(s)")


# ------------------------------------------------------------------- PCA --

pca <- prcomp(t(expr_top))
pct <- round(100 * summary(pca)$importance[2, 1:2], 1)

coords <- data.frame(
  sample = colnames(expr_top),
  PC1    = pca$x[, 1],
  PC2    = pca$x[, 2],
  Group  = groups,
  row.names = NULL
)

save_plot(
  scatter(coords, "PC1", "PC2", "Group",
          "PCA by group",
          paste0("PC1 (", pct[1], "%)"),
          paste0("PC2 (", pct[2], "%)")),
  file.path(output_dir, "PCA")
)
message("  -> ", file.path(output_dir, "PCA.*"))


# --------------------------------------------------------------- k-means --

set.seed(random_seed)
k <- if (is.null(n_clusters)) nlevels(groups) else n_clusters

if (k >= 2 && k < ncol(expr_top)) {
  km <- kmeans(t(expr_top), centers = k, nstart = 25)
  coords$Cluster <- factor(km$cluster)

  save_plot(
    scatter(coords, "PC1", "PC2", "Cluster",
            paste0("PCA by k-means cluster (k = ", k, ")"),
            paste0("PC1 (", pct[1], "%)"),
            paste0("PC2 (", pct[2], "%)")),
    file.path(output_dir, "PCA_kmeans")
  )
  message("  -> ", file.path(output_dir, "PCA_kmeans.*"))

  # How well do the unsupervised clusters recover the labels? A clean
  # diagonal means the groups separate on expression alone.
  confusion <- table(Cluster = km$cluster, Group = groups)
  cat("\nCluster vs group:\n")
  print(confusion)

  agreement <- sum(apply(confusion, 1, max)) / sum(confusion)
  cat(sprintf("\nBest-case agreement: %.0f%%\n\n", 100 * agreement))

  write.table(confusion, file.path(output_dir, "confusion_matrix.txt"),
              sep = "\t", quote = FALSE, col.names = NA)
} else {
  message("  k-means skipped (k = ", k, " with ", ncol(expr_top), " samples)")
}


# ------------------------------------------------------------------ UMAP --

if (do_umap && ncol(expr_top) >= umap_min_samples) {
  set.seed(random_seed)
  layout <- umap::umap(t(expr_top))$layout

  coords$UMAP1 <- layout[, 1]
  coords$UMAP2 <- layout[, 2]

  save_plot(
    scatter(coords, "UMAP1", "UMAP2", "Group", "UMAP by group", "UMAP 1", "UMAP 2"),
    file.path(output_dir, "UMAP")
  )
  message("  -> ", file.path(output_dir, "UMAP.*"))

} else if (do_umap) {
  message("  UMAP skipped: ", ncol(expr_top), " samples, needs at least ",
          umap_min_samples)
}


write.csv(coords, file.path(output_dir, "sample_coordinates.csv"), row.names = FALSE)
message("  -> ", file.path(output_dir, "sample_coordinates.csv"))

message("\nDone.")
