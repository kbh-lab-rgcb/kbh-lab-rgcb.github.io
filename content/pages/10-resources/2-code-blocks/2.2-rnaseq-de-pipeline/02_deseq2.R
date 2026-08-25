#!/usr/bin/env Rscript
# ============================================================================
#  Step 2 -- differential expression for every contrast
# ----------------------------------------------------------------------------
#  INPUT   <dir_counts>/<group>.csv
#  OUTPUT  <dir_deseq2>/<contrast>/deseq2_results.csv
#          <dir_deseq2>/dds_objects.rds
# ============================================================================

source("config.R")
source("_functions.R")

step_header("Step 2 of 4  --  differential expression")

need("DESeq2")
suppressPackageStartupMessages(library(DESeq2))

message("Reading counts ...")
matrices      <- load_all_matrices()
contrast_list <- resolve_contrasts(matrices)

message("\n", length(contrast_list), " contrast(s): ",
        paste(vapply(contrast_list,
                     function(x) paste(x, collapse = " vs "), character(1)),
              collapse = ", "))

dds_objects <- list()

for (co in contrast_list) {
  g1 <- co[1]
  g2 <- co[2]
  name <- paste0(g1, "_vs_", g2)
  message("\n", name)

  out <- run_contrast(matrices, g1, g2)

  contrast_dir <- file.path(dir_deseq2, name)
  dir.create(contrast_dir, recursive = TRUE, showWarnings = FALSE)
  write.csv(out$res, file.path(contrast_dir, "deseq2_results.csv"), row.names = FALSE)

  up   <- sum(out$res$padj <= alpha & out$res$log2FoldChange > 0, na.rm = TRUE)
  down <- sum(out$res$padj <= alpha & out$res$log2FoldChange < 0, na.rm = TRUE)
  message(sprintf("  %d up in %s, %d up in %s (padj <= %g)", up, g1, down, g2, alpha))

  dds_objects[[name]] <- out$dds
}

# Clustering and pathway scoring look at every sample at once rather than a
# pair, so they get an object built from all the real groups. Merged groups
# are left out: their samples are already in the real ones, and including both
# would duplicate every column.
real_groups <- names(sample_groups)
shared_all  <- Reduce(intersect, lapply(matrices[real_groups], rownames))

if (length(shared_all) > 0) {
  combined <- do.call(
    cbind,
    lapply(real_groups, function(g) matrices[[g]][shared_all, , drop = FALSE])
  )

  labels <- unlist(lapply(real_groups, function(g) rep(g, ncol(matrices[[g]]))))
  info   <- data.frame(group = factor(labels, levels = real_groups))
  rownames(info) <- colnames(combined)

  dds_all <- DESeqDataSetFromMatrix(round(combined), info, ~ group)
  if (min_total_count > 0) {
    dds_all <- dds_all[rowSums(counts(dds_all)) >= min_total_count, ]
  }
  dds_objects[["__all_groups__"]] <- dds_all
  message("\nCombined object: ", ncol(dds_all), " samples across ",
          length(real_groups), " group(s)")
}

dir.create(dir_deseq2, recursive = TRUE, showWarnings = FALSE)
saveRDS(dds_objects, file.path(dir_deseq2, "dds_objects.rds"))

message("\nStep 2 complete.")
