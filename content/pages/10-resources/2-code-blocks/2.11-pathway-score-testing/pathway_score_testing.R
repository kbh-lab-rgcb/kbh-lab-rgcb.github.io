#!/usr/bin/env Rscript
# ============================================================================
#  Which pathway scores differ between groups?
# ----------------------------------------------------------------------------
#  Takes a pathways-by-samples score matrix and tests every row for a
#  difference between groups. The test is chosen from the data, not configured:
#
#    2 groups   limma moderated t-test -- borrows variance across pathways,
#               which is what makes it reliable on small sample sizes
#    3+ groups  Kruskal-Wallis, then Dunn post-hoc on whatever survives, so
#               you learn WHICH pair differs rather than only that one does
#
#  INPUT   <input_dir>/<collection>/scores.csv  from ssgsea_scores.R
#          <input_dir>/sample_groups.csv
#  OUTPUT  <collection>/differential_pathways.csv
#          <collection>/posthoc_pairs.csv       (3+ groups only)
#          <collection>/boxplots_top.{tiff,svg}
#          <collection>/heatmap_significant.{tiff,svg}
#
#  Works on any score matrix, not just ssGSEA -- protein abundance, metabolite
#  panels, cell-type deconvolution fractions all fit the same shape.
# ============================================================================


# ============================================================================
#  CONFIG -- edit only this section
# ============================================================================

project_root <- "."
input_dir    <- file.path(project_root, "results", "06_ssgsea")
output_dir   <- file.path(project_root, "results", "07_pathway_tests")

# Test every <collection>/scores.csv under input_dir, or name one file.
input_file <- NULL

# Sample -> group. Written by ssgsea_scores.R.
group_file    <- file.path(project_root, "results", "06_ssgsea", "sample_groups.csv")
sample_column <- "sample"
group_column  <- "group"

# Order the groups. NULL sorts them alphabetically. With two groups the FIRST
# is the reference, so a positive difference means "higher in the second".
group_levels <- NULL
# group_levels <- c("control", "treated")

# --- Statistics -----------------------------------------------------------
# Test on the FDR-adjusted p-value rather than the raw one. Leave TRUE unless
# you are exploring and expect to follow up properly.
use_fdr <- TRUE

p_cutoff <- 0.05

# Minimum absolute difference in mean score between groups. ssGSEA scores are
# not fold changes, so this is on the score's own scale; 0 disables it.
min_effect <- 0

# Sample names sometimes differ between the score matrix and the group file
# (a pipeline replaced dashes with dots, or appended a suffix). These rewrite
# both sides before matching. NULL means no rewriting.
sample_id_pattern     <- NULL
sample_id_replacement <- NULL
# sample_id_pattern     <- "\\..*$"    # drop everything after the first dot
# sample_id_replacement <- ""

# ---------------------------------------------------------------------------
#  PLOT SETTINGS
# ---------------------------------------------------------------------------

out_formats <- c("tiff", "svg")
plot_dpi    <- 300

draw_boxplots <- TRUE
draw_heatmap  <- TRUE

top_n <- 12        # pathways in the boxplot panel
heatmap_max_rows <- 40

boxplot_width  <- 12
boxplot_height <- 10
boxplot_ncol   <- 4

heatmap_width  <- 10
heatmap_height <- 10
heatmap_colours <- c("#2166ac", "white", "#b2182b")
heatmap_fontsize_row <- 8

base_size    <- 12
group_colours <- NULL     # NULL for ggplot defaults
show_points  <- TRUE      # jittered sample points over each box
point_size   <- 1.2
label_wrap   <- 30
max_name_length <- 55

# ============================================================================
#  end CONFIG
# ============================================================================


# ---------------------------------------------------------------- packages --

required <- c("ggplot2", "pheatmap")
missing  <- required[!vapply(required, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing) > 0) {
  stop("Missing package(s): ", paste(missing, collapse = ", "), "\n",
       "  install.packages(c(", paste0("\"", missing, "\"", collapse = ", "), "))")
}

suppressPackageStartupMessages({
  library(ggplot2)
  library(pheatmap)
})

have <- function(pkg) requireNamespace(pkg, quietly = TRUE)


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

normalise_ids <- function(x) {
  if (is.null(sample_id_pattern)) return(as.character(x))
  sub(sample_id_pattern, sample_id_replacement %||% "", as.character(x))
}

`%||%` <- function(a, b) if (is.null(a)) b else a

wrap_text <- function(x, width) {
  vapply(as.character(x),
         function(s) paste(strwrap(s, width = width), collapse = "\n"),
         character(1), USE.NAMES = FALSE)
}

trim_names <- function(x) {
  ifelse(nchar(x) > max_name_length,
         paste0(substr(x, 1, max_name_length - 3), "..."), x)
}


# ------------------------------------------------------------- the two tests --

# Two groups: limma's moderated t-test.
#
# Worth the dependency because it shrinks each pathway's variance towards the
# average across all pathways. With a handful of samples per group that is the
# difference between a usable ranking and noise.
test_two_groups <- function(scores, groups) {
  if (!have("limma")) {
    stop("Two groups needs limma.\n",
         "  BiocManager::install(\"limma\")")
  }

  design <- stats::model.matrix(~ groups)
  fit    <- limma::eBayes(limma::lmFit(scores, design))
  tbl    <- limma::topTable(fit, coef = 2, number = Inf, sort.by = "P")

  data.frame(
    pathway   = rownames(tbl),
    effect    = tbl$logFC,        # difference in mean score, level 2 minus level 1
    statistic = tbl$t,
    p_value   = tbl$P.Value,
    p_adjust  = tbl$adj.P.Val,
    test      = "limma moderated t",
    row.names = NULL,
    stringsAsFactors = FALSE
  )
}

# Three or more groups: Kruskal-Wallis across all of them.
#
# Non-parametric on purpose -- ssGSEA scores are bounded and not normally
# distributed, and with small groups an ANOVA's assumptions are unverifiable.
test_many_groups <- function(scores, groups) {
  p_values <- apply(scores, 1, function(row) {
    if (all(is.na(row)) || stats::var(row, na.rm = TRUE) == 0) return(NA_real_)
    tryCatch(stats::kruskal.test(row ~ groups)$p.value, error = function(e) NA_real_)
  })

  statistics <- apply(scores, 1, function(row) {
    if (all(is.na(row)) || stats::var(row, na.rm = TRUE) == 0) return(NA_real_)
    tryCatch(unname(stats::kruskal.test(row ~ groups)$statistic),
             error = function(e) NA_real_)
  })

  # Spread between the highest and lowest group mean: an effect size on the
  # score's own scale, comparable across pathways.
  effects <- apply(scores, 1, function(row) {
    means <- tapply(row, groups, mean, na.rm = TRUE)
    diff(range(means, na.rm = TRUE))
  })

  out <- data.frame(
    pathway   = rownames(scores),
    effect    = effects,
    statistic = statistics,
    p_value   = p_values,
    p_adjust  = stats::p.adjust(p_values, method = "BH"),
    test      = "Kruskal-Wallis",
    row.names = NULL,
    stringsAsFactors = FALSE
  )
  out[order(out$p_value, na.last = TRUE), ]
}

# Which pair actually differs. Only run on pathways that already passed.
posthoc_dunn <- function(scores, groups, pathways) {
  if (!have("FSA")) {
    message("  post-hoc skipped: install FSA for Dunn's test")
    return(NULL)
  }

  rows <- lapply(pathways, function(pathway) {
    df <- data.frame(score = as.numeric(scores[pathway, ]), group = groups)
    res <- tryCatch(
      FSA::dunnTest(score ~ group, data = df, method = "bh")$res,
      error = function(e) NULL
    )
    if (is.null(res)) return(NULL)
    data.frame(pathway = pathway, comparison = res$Comparison,
               Z = res$Z, p_adjust = res$P.adj,
               row.names = NULL, stringsAsFactors = FALSE)
  })

  out <- do.call(rbind, rows[!vapply(rows, is.null, logical(1))])
  if (is.null(out)) return(NULL)
  out[order(out$p_adjust), ]
}


# -------------------------------------------------------------------- run --

if (!file.exists(group_file)) {
  stop("Cannot find '", group_file, "'.\n",
       "  Run ssgsea_scores.R first, or set group_file in CONFIG.")
}

sheet <- read.csv(group_file, check.names = FALSE)
for (needed in c(sample_column, group_column)) {
  if (!needed %in% names(sheet)) {
    stop("Column '", needed, "' is not in ", group_file, "\n",
         "  Columns present: ", paste(names(sheet), collapse = ", "))
  }
}

files <- if (!is.null(input_file)) {
  if (!file.exists(input_file)) stop("Cannot find '", input_file, "'.")
  input_file
} else {
  found <- list.files(input_dir, pattern = "^scores\\.csv$",
                      recursive = TRUE, full.names = TRUE)
  if (length(found) == 0) {
    stop("No scores.csv found under '", input_dir, "'.\n",
         "  Run ssgsea_scores.R first, or set input_file in CONFIG.")
  }
  found
}

message(length(files), " score matrix / matrices\n")

for (path in files) {
  collection <- basename(dirname(path))
  message(collection)

  scores <- as.matrix(read.csv(path, row.names = 1, check.names = FALSE))

  # Line the two sides up, allowing for a pipeline having rewritten the names.
  matrix_ids <- normalise_ids(colnames(scores))
  sheet_ids  <- normalise_ids(sheet[[sample_column]])

  shared <- intersect(matrix_ids, sheet_ids)
  if (length(shared) < 3) {
    message("  only ", length(shared), " sample(s) matched the group file; skipped")
    message("  (set sample_id_pattern in CONFIG if the naming differs)\n")
    next
  }

  scores <- scores[, match(shared, matrix_ids), drop = FALSE]
  groups <- sheet[[group_column]][match(shared, sheet_ids)]
  groups <- factor(groups, levels = group_levels %||% sort(unique(groups)))
  groups <- droplevels(groups)

  counts <- table(groups)
  message("  ", length(shared), " samples: ",
          paste(sprintf("%s (%d)", names(counts), counts), collapse = ", "))

  if (nlevels(groups) < 2) {
    message("  need at least two groups; skipped\n")
    next
  }
  if (any(counts < 2)) {
    message("  every group needs at least two samples; skipped\n")
    next
  }

  # Rows with no variance cannot differ between anything, and they upset both
  # tests. Drop them before testing rather than filtering results afterwards.
  varying <- apply(scores, 1, function(r) stats::var(r, na.rm = TRUE) > 0)
  if (any(!varying)) {
    message("  dropping ", sum(!varying), " constant pathway(s)")
    scores <- scores[varying, , drop = FALSE]
  }

  # The one branch in the whole script: the number of groups picks the test.
  results <- if (nlevels(groups) == 2) {
    test_two_groups(scores, groups)
  } else {
    test_many_groups(scores, groups)
  }
  message("  test: ", results$test[1])

  p_col <- if (use_fdr) "p_adjust" else "p_value"
  significant <- results[
    !is.na(results[[p_col]]) &
      results[[p_col]] <= p_cutoff &
      abs(results$effect) >= min_effect,
    , drop = FALSE
  ]

  target_dir <- file.path(output_dir, collection)
  dir.create(target_dir, recursive = TRUE, showWarnings = FALSE)

  write.csv(results, file.path(target_dir, "differential_pathways.csv"),
            row.names = FALSE)
  message("  ", nrow(significant), " of ", nrow(results),
          " pathway(s) significant (", p_col, " <= ", p_cutoff, ")")
  message("  -> ", file.path(target_dir, "differential_pathways.csv"))

  if (nrow(significant) == 0) {
    message("  nothing significant, so no plots\n")
    next
  }

  if (nlevels(groups) > 2) {
    pairs <- posthoc_dunn(scores, groups, significant$pathway)
    if (!is.null(pairs)) {
      write.csv(pairs, file.path(target_dir, "posthoc_pairs.csv"), row.names = FALSE)
      message("  -> ", file.path(target_dir, "posthoc_pairs.csv"),
              " (", nrow(pairs), " comparison(s))")
    }
  }

  if (draw_boxplots) {
    show <- utils::head(significant$pathway, top_n)

    long <- do.call(rbind, lapply(show, function(pathway) {
      data.frame(
        pathway = wrap_text(trim_names(pathway), label_wrap),
        score   = as.numeric(scores[pathway, ]),
        group   = groups,
        stringsAsFactors = FALSE
      )
    }))
    long$pathway <- factor(long$pathway, levels = unique(long$pathway))

    p <- ggplot(long, aes(x = group, y = score, fill = group)) +
      geom_boxplot(outlier.shape = if (show_points) NA else 19, alpha = 0.8) +
      facet_wrap(~ pathway, scales = "free_y", ncol = boxplot_ncol) +
      labs(title = paste0(collection, ": most significant pathways"),
           x = NULL, y = "Score") +
      theme_bw(base_size = base_size) +
      theme(
        legend.position = "bottom",
        strip.text      = element_text(size = base_size - 3, face = "bold"),
        axis.text.x     = element_text(angle = 30, hjust = 1),
        plot.title      = element_text(face = "bold", hjust = 0.5)
      )

    if (show_points) {
      p <- p + geom_jitter(width = 0.15, size = point_size, alpha = 0.5,
                           show.legend = FALSE)
    }
    if (!is.null(group_colours)) p <- p + scale_fill_manual(values = group_colours)

    save_plot(function() print(p), file.path(target_dir, "boxplots_top"),
              boxplot_width, boxplot_height)
    message("  -> ", file.path(target_dir, "boxplots_top.*"))
  }

  if (draw_heatmap && nrow(significant) >= 2) {
    show <- utils::head(significant$pathway, heatmap_max_rows)
    sub  <- scores[show, , drop = FALSE]
    rownames(sub) <- trim_names(rownames(sub))

    annotation <- data.frame(Group = groups)
    rownames(annotation) <- colnames(sub)

    save_plot(
      function() {
        pheatmap(
          sub,
          scale          = "row",
          annotation_col = annotation,
          cluster_rows   = TRUE,
          cluster_cols   = FALSE,
          color          = colorRampPalette(heatmap_colours)(50),
          fontsize_row   = heatmap_fontsize_row,
          show_colnames  = FALSE,
          main           = paste0(collection, ": significant pathways")
        )
      },
      file.path(target_dir, "heatmap_significant"), heatmap_width, heatmap_height
    )
    message("  -> ", file.path(target_dir, "heatmap_significant.*"))
  }

  message("")
}

message("Done.")
