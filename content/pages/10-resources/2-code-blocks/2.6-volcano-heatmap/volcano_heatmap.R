#!/usr/bin/env Rscript
# ============================================================================
#  Volcano plot and heatmap from any differential-expression table
# ----------------------------------------------------------------------------
#  INPUT   a DE results CSV with log2FoldChange and padj columns, plus
#          optionally the counts matrices used to produce it (for the heatmap)
#  OUTPUT  <output_dir>/<contrast>/volcano.{tiff,svg}
#          <output_dir>/<contrast>/heatmap.{tiff,svg}
#          <output_dir>/<contrast>/significant_genes.csv
#  NEXT    gsea_ranked.R
#
#  Works with DESeq2, edgeR or limma output -- anything with a fold-change
#  column and an adjusted p-value column, named in CONFIG.
# ============================================================================


# ============================================================================
#  CONFIG -- edit only this section
# ============================================================================

project_root <- "."
input_dir    <- file.path(project_root, "results", "02_deseq2")
output_dir   <- file.path(project_root, "results", "03_figures")

# Plot every <contrast>/deseq2_results_annotated.csv under input_dir.
# Set to one path to plot just that file.
input_file <- NULL

# --- Column names ---------------------------------------------------------
# Rename these to match your table if it did not come from DESeq2.
lfc_column    <- "log2FoldChange"
padj_column   <- "padj"
symbol_column <- "gene_symbol"   # falls back to the ID column if absent
id_column     <- "gene_id"

# --- Thresholds -----------------------------------------------------------
# One cutoff drives the guide lines, the colouring and the heatmap gene set,
# so they can never disagree with each other.
lfc_cutoff  <- 1
padj_cutoff <- 0.05

# --- Heatmap input --------------------------------------------------------
# Counts CSVs, keyed by group name, exactly as in deseq2_contrasts.R. Needed
# only for the heatmap; leave empty and only the volcano is drawn.
groups <- list(
  control = file.path(project_root, "results", "01_counts", "control.csv"),
  treated = file.path(project_root, "results", "01_counts", "treated.csv")
)

# Strip Ensembl version suffixes when reading counts. Match what you used in
# deseq2_contrasts.R, or the gene IDs will not line up.
strip_ensembl_version <- TRUE

# Cap the heatmap at the most significant N genes. Set to Inf for all of them
# -- readable up to a few hundred rows, a smear beyond that.
heatmap_max_genes <- 60

# ---------------------------------------------------------------------------
#  PLOT SETTINGS
# ---------------------------------------------------------------------------

out_formats <- c("tiff", "svg")   # any of tiff, svg, png, pdf
plot_dpi    <- 300

# --- Volcano --------------------------------------------------------------
volcano_width  <- 10
volcano_height <- 8
volcano_base_size <- 20

point_size  <- 2
point_alpha <- 0.6
point_stroke <- 0.5

col_up   <- "#bb0c00"
col_down <- "#00AFBB"
col_ns   <- "grey"

label_up   <- 30    # most significant up genes to label; 0 for none
label_down <- 15
label_size <- 3

# NULL fits the data; give c(min, max) to pin the axes across contrasts so
# several volcanoes can be compared side by side.
volcano_xlim <- NULL
volcano_ylim <- NULL

x_break_step <- 2   # tick every N units on the fold-change axis

# --- Heatmap --------------------------------------------------------------
heatmap_width  <- 8
heatmap_height <- 12
heatmap_colours <- c("#2166ac", "white", "#b2182b")   # low, mid, high
heatmap_fontsize_row <- 6
heatmap_cluster_rows <- TRUE
heatmap_cluster_cols <- FALSE   # FALSE keeps samples grouped by condition
heatmap_show_colnames <- FALSE

# ============================================================================
#  end CONFIG
# ============================================================================


# ---------------------------------------------------------------- packages --

required <- c("ggplot2", "ggrepel", "pheatmap", "grid")
missing  <- required[!vapply(required, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing) > 0) {
  stop("Missing package(s): ", paste(missing, collapse = ", "), "\n",
       "  install.packages(c(", paste0("\"", missing, "\"", collapse = ", "), "))")
}

suppressPackageStartupMessages({
  library(ggplot2)
  library(ggrepel)
  library(pheatmap)
  library(grid)
})


# ----------------------------------------------------------------- helpers --

# Write one plot in every requested format.
#
# Note svg() and pdf() take no `res` argument -- passing one is an error, which
# is why the device call is branched rather than shared.
save_plot <- function(plot_obj, path_without_ext, width, height, draw = print) {
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

    draw(plot_obj)
    dev.off()
  }
}

read_counts <- function(path, group_name) {
  raw <- read.csv(path, row.names = 1, check.names = FALSE)
  raw <- raw[, vapply(raw, is.numeric, logical(1)), drop = FALSE]
  mat <- as.matrix(raw)
  if (strip_ensembl_version) rownames(mat) <- sub("\\.[0-9]+$", "", rownames(mat))
  if (any(duplicated(rownames(mat)))) mat <- rowsum(mat, rownames(mat))
  mat
}


# ------------------------------------------------------------------ volcano --

make_volcano <- function(df, title) {
  # Three-way classification from the same two cutoffs the guide lines use.
  df$direction <- "Not significant"
  df$direction[df[[padj_column]] <= padj_cutoff &
                 df[[lfc_column]] >=  lfc_cutoff] <- "Up"
  df$direction[df[[padj_column]] <= padj_cutoff &
                 df[[lfc_column]] <= -lfc_cutoff] <- "Down"
  df$direction <- factor(df$direction, levels = c("Up", "Down", "Not significant"))

  # padj can underflow to exactly 0, and log10(0) is -Inf, which silently
  # drops the very genes the plot exists to show. Floor it at the smallest
  # non-zero value present.
  positive <- df[[padj_column]][df[[padj_column]] > 0]
  floor_p  <- if (length(positive) > 0) min(positive, na.rm = TRUE) else 1e-300
  df$plot_y <- -log10(pmax(df[[padj_column]], floor_p))

  # Label the most significant genes on each side, not the largest fold
  # changes: a huge fold change on a barely-expressed gene is the usual way a
  # volcano plot ends up labelling noise.
  to_label <- df[0, ]
  for (side in c("Up", "Down")) {
    n <- if (side == "Up") label_up else label_down
    if (n <= 0) next
    hits <- df[df$direction == side, ]
    if (nrow(hits) == 0) next
    hits <- hits[order(hits[[padj_column]]), ]
    to_label <- rbind(to_label, utils::head(hits, n))
  }

  p <- ggplot(df, aes(x = .data[[lfc_column]], y = .data$plot_y,
                      fill = .data$direction)) +
    geom_vline(xintercept = c(-lfc_cutoff, lfc_cutoff),
               linetype = "dashed", colour = "grey60", linewidth = 0.3) +
    geom_hline(yintercept = -log10(padj_cutoff),
               linetype = "dashed", colour = "grey60", linewidth = 0.3) +
    geom_point(shape = 21, size = point_size, alpha = point_alpha,
               stroke = point_stroke, colour = "black") +
    scale_fill_manual(values = c("Up" = col_up, "Down" = col_down,
                                 "Not significant" = col_ns)) +
    labs(
      title = title,
      x = expression(log[2] ~ "fold change"),
      y = expression(-log[10] ~ "adjusted p"),
      fill = NULL
    ) +
    theme_classic(base_size = volcano_base_size) +
    theme(
      axis.title.y = element_text(face = "bold", margin = margin(0, 20, 0, 0)),
      axis.title.x = element_text(face = "bold", margin = margin(20, 0, 0, 0)),
      plot.title   = element_text(hjust = 0.5),
      legend.title = element_blank()
    )

  if (!is.null(volcano_xlim) || !is.null(volcano_ylim)) {
    p <- p + coord_cartesian(xlim = volcano_xlim, ylim = volcano_ylim)
  }

  if (!is.null(x_break_step) && x_break_step > 0) {
    span <- if (is.null(volcano_xlim)) range(df[[lfc_column]], na.rm = TRUE) else volcano_xlim
    p <- p + scale_x_continuous(
      breaks = seq(floor(span[1]), ceiling(span[2]), by = x_break_step)
    )
  }

  if (nrow(to_label) > 0) {
    label_col <- if (symbol_column %in% names(df)) symbol_column else id_column
    p <- p + geom_label_repel(
      data = to_label,
      aes(label = .data[[label_col]]),
      size = label_size, fill = alpha("white", 0.7), colour = "black",
      box.padding = unit(0.35, "lines"), point.padding = unit(0.3, "lines"),
      segment.colour = "grey50", segment.size = 0.3,
      label.size = 0.25, max.overlaps = Inf, show.legend = FALSE
    )
  }

  list(plot = p, table = df)
}


# ------------------------------------------------------------------ heatmap --

# The bug this replaces: the significant-gene names were gene SYMBOLS while
# the expression matrix rownames were gene IDs, so the intersection was always
# empty and the heatmap was silently skipped every single run. Subsetting is
# now done on the ID, and rows are relabelled to symbols only for display.
make_heatmap <- function(df, contrast_name) {
  if (length(groups) == 0) return(NULL)

  # Show the two groups THIS contrast compared, not every group configured.
  # deseq2_contrasts.R records them in the results table, so the heatmap can
  # follow the contrast it is illustrating without being told again. Without
  # this, plotting several contrasts in one run draws the same samples under
  # every one of them.
  wanted <- names(groups)
  if (all(c("contrast_numerator", "contrast_denominator") %in% names(df))) {
    pair <- c(unique(df$contrast_numerator)[1], unique(df$contrast_denominator)[1])
    if (!anyNA(pair) && all(pair %in% names(groups))) {
      wanted <- pair
    } else {
      message("  heatmap: contrast groups not in `groups`; using all of them")
    }
  }

  present <- vapply(groups[wanted], file.exists, logical(1))
  if (!all(present)) {
    message("  heatmap skipped: missing counts for ",
            paste(wanted[!present], collapse = ", "))
    return(NULL)
  }

  mats <- lapply(wanted, function(g) read_counts(groups[[g]], g))
  names(mats) <- wanted

  shared <- Reduce(intersect, lapply(mats, rownames))
  expr <- do.call(cbind, lapply(mats, function(m) m[shared, , drop = FALSE]))

  sig <- df[!is.na(df[[padj_column]]) &
              df[[padj_column]] <= padj_cutoff &
              abs(df[[lfc_column]]) >= lfc_cutoff, ]

  if (!id_column %in% names(sig)) {
    message("  heatmap skipped: no '", id_column, "' column to match on")
    return(NULL)
  }

  sig <- sig[sig[[id_column]] %in% rownames(expr), ]
  sig <- sig[order(sig[[padj_column]]), ]

  if (nrow(sig) < 2) {
    message("  heatmap skipped: ", nrow(sig), " significant gene(s) found in the matrix")
    return(NULL)
  }

  if (is.finite(heatmap_max_genes) && nrow(sig) > heatmap_max_genes) {
    message("  heatmap: showing the ", heatmap_max_genes,
            " most significant of ", nrow(sig), " genes")
    sig <- utils::head(sig, heatmap_max_genes)
  }

  sub <- expr[sig[[id_column]], , drop = FALSE]

  # Row z-scores: the heatmap is about which samples are high or low for a
  # gene, not about how strongly the gene is expressed overall.
  scaled <- t(scale(t(sub)))
  finite_rows <- apply(scaled, 1, function(x) all(is.finite(x)))

  labels <- if (symbol_column %in% names(sig)) sig[[symbol_column]] else sig[[id_column]]
  rownames(scaled) <- make.unique(as.character(labels))
  scaled <- scaled[finite_rows, , drop = FALSE]

  if (nrow(scaled) < 2) {
    message("  heatmap skipped: too few genes with non-zero variance")
    return(NULL)
  }

  annotation <- data.frame(
    Group = factor(unlist(lapply(names(mats), function(g) rep(g, ncol(mats[[g]])))))
  )
  rownames(annotation) <- colnames(expr)

  pheatmap(
    scaled,
    cluster_rows   = heatmap_cluster_rows,
    cluster_cols   = heatmap_cluster_cols,
    annotation_col = annotation,
    color          = colorRampPalette(heatmap_colours)(50),
    fontsize_row   = heatmap_fontsize_row,
    show_colnames  = heatmap_show_colnames,
    main           = paste("Significant genes:", contrast_name),
    silent         = TRUE
  )
}


# -------------------------------------------------------------------- run --

files <- if (!is.null(input_file)) {
  if (!file.exists(input_file)) stop("Cannot find '", input_file, "'.")
  input_file
} else {
  found <- list.files(input_dir, pattern = "^deseq2_results_annotated\\.csv$",
                      recursive = TRUE, full.names = TRUE)
  if (length(found) == 0) {
    found <- list.files(input_dir, pattern = "^deseq2_results\\.csv$",
                        recursive = TRUE, full.names = TRUE)
  }
  if (length(found) == 0) {
    stop("No results table found under '", input_dir, "'.\n",
         "  Run deseq2_contrasts.R and gene_id_conversion.R first, ",
         "or set input_file in CONFIG.")
  }
  found
}

message(length(files), " table(s) to plot\n")

for (path in files) {
  contrast_name <- basename(dirname(path))
  message(contrast_name)

  df <- read.csv(path, check.names = FALSE)

  for (needed in c(lfc_column, padj_column)) {
    if (!needed %in% names(df)) {
      stop("Column '", needed, "' is not in ", path, "\n",
           "  Columns present: ", paste(names(df), collapse = ", "))
    }
  }

  df <- df[!is.na(df[[lfc_column]]) & !is.na(df[[padj_column]]), ]
  if (nrow(df) == 0) {
    message("  nothing to plot after removing rows with NA\n")
    next
  }

  target_dir <- file.path(output_dir, contrast_name)
  dir.create(target_dir, recursive = TRUE, showWarnings = FALSE)

  built <- make_volcano(df, gsub("_", " ", contrast_name))
  save_plot(built$plot, file.path(target_dir, "volcano"),
            volcano_width, volcano_height)

  counts_by_direction <- table(built$table$direction)
  message("  ", counts_by_direction[["Up"]], " up, ",
          counts_by_direction[["Down"]], " down ",
          "(|log2FC| >= ", lfc_cutoff, ", padj <= ", padj_cutoff, ")")
  message("  -> ", file.path(target_dir, "volcano.*"))

  sig_table <- built$table[built$table$direction != "Not significant", ]
  sig_table <- sig_table[order(sig_table[[padj_column]]), ]
  write.csv(sig_table, file.path(target_dir, "significant_genes.csv"), row.names = FALSE)

  hm <- make_heatmap(df, gsub("_", " ", contrast_name))
  if (!is.null(hm)) {
    save_plot(hm, file.path(target_dir, "heatmap"),
              heatmap_width, heatmap_height,
              draw = function(x) { grid.newpage(); grid.draw(x$gtable) })
    message("  -> ", file.path(target_dir, "heatmap.*"))
  }

  message("")
}

message("Done. Next: gsea_ranked.R")
