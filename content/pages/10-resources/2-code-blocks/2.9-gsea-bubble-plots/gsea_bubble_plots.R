#!/usr/bin/env Rscript
# ============================================================================
#  Bubble plots from any GSEA results table
# ----------------------------------------------------------------------------
#  Two views of the same numbers:
#
#    facet  -- activated and suppressed side by side in separate panels
#    mirror -- one axis, suppressed sets running left of zero
#
#  The mirror is the more honest of the two when you want to compare the
#  magnitude of up against down, because both share a single scale. The facet
#  version is easier to read when one direction has far more terms.
#
#  INPUT   any CSV with NES, p.adjust, setSize and core_enrichment columns --
#          which is what clusterProfiler and gsea_ranked.R write
#  OUTPUT  <output_dir>/<contrast>/<collection>_facet.{tiff,svg}
#          <output_dir>/<contrast>/<collection>_mirror.{tiff,svg}
# ============================================================================


# ============================================================================
#  CONFIG -- edit only this section
# ============================================================================

project_root <- "."
input_dir    <- file.path(project_root, "results", "05_gsea")
output_dir   <- file.path(project_root, "results", "05_gsea")

# Plot every GSEA_results.csv under input_dir, or name one file.
input_file <- NULL

# --- Column names ---------------------------------------------------------
nes_column         <- "NES"
padj_column        <- "p.adjust"
setsize_column     <- "setSize"
description_column <- "Description"

# Genes driving each term, slash-separated -- clusterProfiler's format.
# Set to NULL if your table has no such column; bubble size then falls back
# to the set size.
core_column <- "core_enrichment"

# --- Selection ------------------------------------------------------------
# Terms shown per direction, chosen by adjusted p-value.
top_n_per_direction <- 10

# Drop anything above this before selecting.
padj_cutoff <- 0.05

# Order the bars by "padj", "NES" or "GeneRatio".
order_by <- "padj"

# ---------------------------------------------------------------------------
#  PLOT SETTINGS
# ---------------------------------------------------------------------------

out_formats <- c("tiff", "svg")
plot_dpi    <- 300

facet_width   <- 12
facet_height  <- 10
mirror_width  <- 12
mirror_height <- 10

base_size       <- 14
term_text_size  <- 12
axis_title_size <- 12
title_size      <- 16

# Bubble size maps to the number of leading-edge genes.
bubble_size_range <- c(3, 10)

# Fill maps to -log10(adjusted p). Low value first.
fill_low  <- "#4575b4"
fill_high <- "#d73027"

label_wrap  <- 40     # wrap term names at this many characters
legend_pos  <- "right"
panel_border <- TRUE

draw_facet  <- TRUE
draw_mirror <- TRUE

# ============================================================================
#  end CONFIG
# ============================================================================


# ---------------------------------------------------------------- packages --

required <- c("ggplot2")
missing  <- required[!vapply(required, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing) > 0) {
  stop("Missing package(s): ", paste(missing, collapse = ", "), "\n",
       "  install.packages(c(", paste0("\"", missing, "\"", collapse = ", "), "))")
}

suppressPackageStartupMessages(library(ggplot2))


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

wrap_text <- function(x, width) {
  vapply(as.character(x),
         function(s) paste(strwrap(s, width = width), collapse = "\n"),
         character(1), USE.NAMES = FALSE)
}

shared_theme <- function() {
  t <- theme_minimal(base_size = base_size) +
    theme(
      axis.text.y     = element_text(size = term_text_size),
      axis.title.x    = element_text(size = axis_title_size, face = "bold"),
      plot.title      = element_text(size = title_size, face = "bold", hjust = 0.5),
      legend.title    = element_text(face = "bold"),
      legend.position = legend_pos
    )
  if (panel_border) {
    t <- t + theme(panel.border = element_rect(colour = "black", fill = NA,
                                               linewidth = 0.6))
  }
  t
}

# Add the derived columns the plots need and pick the terms to show.
prepare <- function(df) {
  for (needed in c(nes_column, padj_column, description_column)) {
    if (!needed %in% names(df)) {
      stop("Column '", needed, "' is missing.\n",
           "  Columns present: ", paste(names(df), collapse = ", "))
    }
  }

  df <- df[!is.na(df[[nes_column]]) & !is.na(df[[padj_column]]), ]
  df <- df[df[[padj_column]] <= padj_cutoff, ]
  if (nrow(df) == 0) return(NULL)

  # Leading-edge size: how many genes actually drive the enrichment, which is
  # more informative than the size of the set as annotated.
  if (!is.null(core_column) && core_column %in% names(df)) {
    df$GeneCount <- lengths(strsplit(as.character(df[[core_column]]), "/"))
  } else if (setsize_column %in% names(df)) {
    df$GeneCount <- df[[setsize_column]]
  } else {
    df$GeneCount <- 1
  }

  df$GeneRatio <- if (setsize_column %in% names(df)) {
    df$GeneCount / df[[setsize_column]]
  } else {
    df$GeneCount / max(df$GeneCount)
  }

  df$direction <- ifelse(df[[nes_column]] > 0, "Activated", "Suppressed")

  # The mirror plot puts suppressed sets left of zero on one shared scale.
  df$GeneRatio_mirror <- ifelse(df$direction == "Suppressed",
                                -df$GeneRatio, df$GeneRatio)

  df$neglog_padj <- -log10(pmax(df[[padj_column]], .Machine$double.xmin))

  ordering <- switch(
    order_by,
    padj      = order(df[[padj_column]]),
    NES       = order(-abs(df[[nes_column]])),
    GeneRatio = order(-df$GeneRatio),
    order(df[[padj_column]])
  )
  df <- df[ordering, ]

  selected <- do.call(rbind, lapply(c("Activated", "Suppressed"), function(side) {
    utils::head(df[df$direction == side, , drop = FALSE], top_n_per_direction)
  }))

  if (is.null(selected) || nrow(selected) == 0) return(NULL)

  selected$term_label <- wrap_text(selected[[description_column]], label_wrap)
  selected
}

bubbles <- function(df, x_col) {
  ggplot(df, aes(x = .data[[x_col]],
                 y = stats::reorder(.data$term_label, .data$GeneRatio))) +
    geom_point(aes(size = .data$GeneCount, fill = .data$neglog_padj),
               shape = 21, colour = "black", stroke = 0.5) +
    scale_fill_gradient(low = fill_low, high = fill_high,
                        name = expression(-log[10] ~ "(adj. p)")) +
    scale_size(range = bubble_size_range, name = "Leading-edge genes")
}


# -------------------------------------------------------------------- run --

files <- if (!is.null(input_file)) {
  if (!file.exists(input_file)) stop("Cannot find '", input_file, "'.")
  input_file
} else {
  found <- list.files(input_dir, pattern = "^GSEA_results\\.csv$",
                      recursive = TRUE, full.names = TRUE)
  if (length(found) == 0) {
    stop("No GSEA_results.csv found under '", input_dir, "'.\n",
         "  Run gsea_ranked.R first, or set input_file in CONFIG.")
  }
  found
}

message(length(files), " results table(s)\n")

for (path in files) {
  collection    <- basename(dirname(path))
  contrast_name <- basename(dirname(dirname(path)))
  label         <- paste0(gsub("_", " ", contrast_name), " -- ", collection)

  df <- read.csv(path, check.names = FALSE)
  prepared <- prepare(df)

  if (is.null(prepared)) {
    message(label, ": nothing passes padj <= ", padj_cutoff)
    next
  }

  n_up   <- sum(prepared$direction == "Activated")
  n_down <- sum(prepared$direction == "Suppressed")
  message(label, ": showing ", n_up, " activated, ", n_down, " suppressed")

  target_dir <- file.path(output_dir, contrast_name)
  dir.create(target_dir, recursive = TRUE, showWarnings = FALSE)

  if (draw_facet) {
    p <- bubbles(prepared, "GeneRatio") +
      facet_wrap(~ direction, scales = "free_x", nrow = 1) +
      labs(title = label, x = "Gene ratio", y = NULL) +
      shared_theme() +
      theme(
        strip.background = element_rect(fill = "grey90", colour = "grey20"),
        strip.text       = element_text(face = "bold", size = base_size),
        panel.spacing.x  = unit(1.5, "lines")
      )

    save_plot(p, file.path(target_dir, paste0(collection, "_facet")),
              facet_width, facet_height)
    message("  -> ", file.path(target_dir, paste0(collection, "_facet.*")))
  }

  if (draw_mirror) {
    p <- bubbles(prepared, "GeneRatio_mirror") +
      geom_vline(xintercept = 0, linetype = "dashed", colour = "grey40",
                 linewidth = 0.5) +
      labs(
        title = label,
        x = "← Suppressed        Gene ratio        Activated →",
        y = NULL
      ) +
      shared_theme()

    save_plot(p, file.path(target_dir, paste0(collection, "_mirror")),
              mirror_width, mirror_height)
    message("  -> ", file.path(target_dir, paste0(collection, "_mirror.*")))
  }
}

message("\nDone.")
