#!/usr/bin/env Rscript
# ============================================================================
#  Step 4 -- volcano plot and heatmap per contrast
# ----------------------------------------------------------------------------
#  INPUT   <dir_deseq2>/<contrast>/deseq2_results_annotated.csv
#  OUTPUT  <dir_figures>/<contrast>/volcano.*
#          <dir_figures>/<contrast>/heatmap.*
#          <dir_figures>/<contrast>/significant_genes.csv
# ============================================================================

source("config.R")
source("_functions.R")

step_header("Step 4 of 4  --  figures")

need("ggplot2", "ggrepel", "pheatmap")
suppressPackageStartupMessages({
  library(ggplot2)
  library(ggrepel)
  library(pheatmap)
  library(grid)
})

files <- list.files(dir_deseq2, pattern = "^deseq2_results_annotated\\.csv$",
                    recursive = TRUE, full.names = TRUE)

if (length(files) == 0) {
  stop("No annotated results under '", dir_deseq2, "'.\n",
       "  Run 03_annotate.R first.")
}

# Needed for the heatmap, which plots expression rather than test statistics.
matrices <- load_all_matrices()

for (path in files) {
  name <- basename(dirname(path))
  message("\n", name)

  df <- read.csv(path, check.names = FALSE)
  df <- df[!is.na(df$log2FoldChange) & !is.na(df$padj), ]

  if (nrow(df) == 0) {
    message("  nothing left after removing rows with NA")
    next
  }

  target_dir <- file.path(dir_figures, name)
  dir.create(target_dir, recursive = TRUE, showWarnings = FALSE)

  built <- build_volcano(df, gsub("_", " ", name))
  save_plot(function() print(built$plot),
            file.path(target_dir, "volcano"), volcano_width, volcano_height)

  tallies <- table(built$table$direction)
  message("  ", tallies[["Up"]], " up, ", tallies[["Down"]], " down ",
          "(|log2FC| >= ", lfc_cutoff, ", padj <= ", padj_cutoff, ")")

  sig <- built$table[built$table$direction != "Not significant", ]
  write.csv(sig[order(sig$padj), ],
            file.path(target_dir, "significant_genes.csv"), row.names = FALSE)

  # Recover the two group names from the columns step 2 recorded, so the
  # heatmap shows the right samples without being told again.
  g1 <- unique(df$contrast_numerator)[1]
  g2 <- unique(df$contrast_denominator)[1]

  if (!is.na(g1) && !is.na(g2) && all(c(g1, g2) %in% names(matrices))) {
    hm <- build_heatmap(df, matrices, g1, g2, paste("Significant genes:", name))
    if (!is.null(hm)) {
      save_plot(function() { grid.newpage(); grid.draw(hm$gtable) },
                file.path(target_dir, "heatmap"), heatmap_width, heatmap_height)
    }
  }

  message("  -> ", target_dir)
}

message("\nStep 4 complete.")
