#!/usr/bin/env Rscript
# ============================================================================
#  Step 3 -- add gene symbols and Entrez IDs
# ----------------------------------------------------------------------------
#  INPUT   <dir_deseq2>/<contrast>/deseq2_results.csv
#  OUTPUT  <dir_deseq2>/<contrast>/deseq2_results_annotated.csv
#
#  Tries biomaRt first, then falls back to the offline organism package, so a
#  flaky connection never costs you the whole run.
# ============================================================================

source("config.R")
source("_functions.R")

step_header("Step 3 of 4  --  gene identifiers")

files <- list.files(dir_deseq2, pattern = "^deseq2_results\\.csv$",
                    recursive = TRUE, full.names = TRUE)

if (length(files) == 0) {
  stop("No deseq2_results.csv under '", dir_deseq2, "'.\n",
       "  Run 02_deseq2.R first.")
}

for (path in files) {
  label <- basename(dirname(path))
  message("\n", label)

  df <- read.csv(path, check.names = FALSE)
  if (!"gene_id" %in% names(df)) df$gene_id <- rownames(df)

  ids     <- as.character(df$gene_id)
  mapping <- annotate_ids(unique(ids))

  df$gene_symbol <- mapping$gene_symbol[match(ids, mapping$lookup_id)]
  if (add_entrez && "entrez_id" %in% names(mapping)) {
    df$entrez_id <- mapping$entrez_id[match(ids, mapping$lookup_id)]
  }

  found <- sum(!is.na(df$gene_symbol) & nzchar(df$gene_symbol))
  message("  matched ", found, " of ", nrow(df), " row(s)")

  # Genes with no symbol keep their ID rather than becoming NA, so nothing
  # silently vanishes from a plot or a ranked list later on.
  blank <- is.na(df$gene_symbol) | !nzchar(df$gene_symbol)
  df$gene_symbol[blank] <- ids[blank]

  target <- file.path(dirname(path), "deseq2_results_annotated.csv")
  write.csv(df, target, row.names = FALSE)
  message("  -> ", target)
}

message("\nStep 3 complete.")
