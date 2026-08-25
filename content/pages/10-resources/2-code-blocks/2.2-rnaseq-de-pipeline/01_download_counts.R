#!/usr/bin/env Rscript
# ============================================================================
#  Step 1 -- fetch counts from the GDC
# ----------------------------------------------------------------------------
#  OUTPUT  <dir_counts>/<group>.csv, one per group
#
#  Skipped entirely when download_counts is FALSE in config.R -- put your own
#  counts CSVs in dir_counts instead, named after each group.
# ============================================================================

source("config.R")
source("_functions.R")

step_header("Step 1 of 4  --  counts")

if (!download_counts) {
  message("download_counts is FALSE; using the CSVs already in ", dir_counts)
  quit(save = "no", status = 0)
}

need("TCGAbiolinks", "SummarizedExperiment")
suppressPackageStartupMessages({
  library(TCGAbiolinks)
  library(SummarizedExperiment)
})

read_barcodes <- function(value, group_name) {
  ids <- if (length(value) == 1 && file.exists(value)) {
    readLines(value, warn = FALSE)
  } else {
    value
  }
  ids <- unique(trimws(ids))
  ids <- ids[nzchar(ids)]
  if (length(ids) == 0) stop("Group '", group_name, "' has no barcodes.")
  ids
}

barcode_map <- lapply(names(sample_groups),
                      function(g) read_barcodes(sample_groups[[g]], g))
names(barcode_map) <- names(sample_groups)

all_barcodes <- unlist(barcode_map, use.names = FALSE)

# The same sample in two groups would be counted twice and silently bias
# every comparison downstream.
if (any(duplicated(all_barcodes))) {
  stop("These barcodes appear in more than one group: ",
       paste(unique(all_barcodes[duplicated(all_barcodes)]), collapse = ", "))
}

message("Project: ", gdc_project)
message("Groups : ", paste(sprintf("%s (%d)", names(barcode_map), lengths(barcode_map)),
                           collapse = ", "))

# One query for every barcode rather than one per group: the GDC is queried
# and downloaded once, and the split into groups happens locally afterwards.
query <- GDCquery(
  project       = gdc_project,
  data.category = data_category,
  data.type     = data_type,
  workflow.type = workflow_type,
  barcode       = all_barcodes
)

if (nrow(getResults(query)) == 0) {
  stop("The query returned nothing. Check gdc_project and the barcodes in config.R.")
}

dir.create(gdc_cache_dir, recursive = TRUE, showWarnings = FALSE)
GDCdownload(query, method = "api", files.per.chunk = 10, directory = gdc_cache_dir)
se <- GDCprepare(query, directory = gdc_cache_dir)

if (!assay_name %in% assayNames(se)) {
  stop("assay_name '", assay_name, "' is not available.\n",
       "  Available: ", paste(assayNames(se), collapse = ", "))
}

counts <- assay(se, assay_name)
message("Matrix: ", nrow(counts), " genes x ", ncol(counts), " samples")

# The GDC returns full-length barcodes but people paste shortened ones, so an
# exact match is not enough.
assign_group <- function(column_id) {
  for (g in names(barcode_map)) {
    ids <- barcode_map[[g]]
    if (any(startsWith(column_id, ids)) || any(startsWith(ids, column_id))) return(g)
  }
  NA_character_
}

column_groups <- vapply(colnames(counts), assign_group, character(1))

if (anyNA(column_groups)) {
  warning(sum(is.na(column_groups)), " sample(s) matched no group and were left out.")
}

dir.create(dir_counts, recursive = TRUE, showWarnings = FALSE)

for (g in names(barcode_map)) {
  keep <- which(column_groups == g)
  if (length(keep) == 0) {
    warning("Group '", g, "' matched no downloaded samples.")
    next
  }
  path <- file.path(dir_counts, paste0(g, ".csv"))
  write.csv(counts[, keep, drop = FALSE], path)
  message(sprintf("  %-14s %3d sample(s) -> %s", g, length(keep), path))
}

message("\nStep 1 complete.")
