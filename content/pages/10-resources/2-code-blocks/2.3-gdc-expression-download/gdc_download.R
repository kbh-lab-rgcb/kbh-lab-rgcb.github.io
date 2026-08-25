#!/usr/bin/env Rscript
# ============================================================================
#  Download expression counts from the GDC and split them into groups
# ----------------------------------------------------------------------------
#  Queries the NCI Genomic Data Commons for one project, downloads the samples
#  you name, and writes one CSV per group: genes down the rows, samples across
#  the columns. That is the shape every other block in this toolkit expects.
#
#  INPUT   nothing on disk -- the barcodes in CONFIG below
#  OUTPUT  <output_dir>/<group>.csv, one per group
#  NEXT    deseq2_contrasts.R reads those CSVs
#
#  Works for any GDC project, data category and workflow. Nothing here is
#  specific to one study.
# ============================================================================


# ============================================================================
#  CONFIG -- edit only this section
# ============================================================================

project_root <- "."
output_dir   <- file.path(project_root, "results", "01_counts")

# --- What to fetch --------------------------------------------------------
# Browse projects at https://portal.gdc.cancer.gov/projects
gdc_project   <- "TCGA-PAAD"
data_category <- "Transcriptome Profiling"
data_type     <- "Gene Expression Quantification"
workflow_type <- "STAR - Counts"

# Which matrix to pull out of the downloaded object.
#   "unstranded"       raw counts  <- use this for DESeq2
#   "stranded_first", "stranded_second"
#   "tpm_unstrand", "fpkm_unstrand", "fpkm_uq_unstrand"   (normalised)
# Differential expression needs RAW COUNTS. TPM and FPKM are already
# normalised and break the negative-binomial model DESeq2 fits.
assay_name <- "unstranded"

# --- The groups -----------------------------------------------------------
# Name each group and give it barcodes. Two groups or ten -- nothing below
# counts them. Each entry is either:
#   * a character vector of barcodes, or
#   * a path to a text file with one barcode per line.
#
# Group names become filenames and, later, factor levels, so keep them short
# and free of spaces.
groups <- list(
  control = c(
    "TCGA-XX-A1A1-01A-11R-A000-07",
    "TCGA-XX-A1A2-01A-11R-A000-07"
  ),
  treated = c(
    "TCGA-XX-A1A3-01A-11R-A000-07",
    "TCGA-XX-A1A4-01A-11R-A000-07"
  )
)
# Example of reading from files instead:
# groups <- list(
#   control = "barcodes/control.txt",
#   treated = "barcodes/treated.txt"
# )

# --- Behaviour ------------------------------------------------------------
# Where GDCdownload caches the raw files. Keep it out of results/ so a
# results wipe does not force a re-download.
gdc_cache_dir <- file.path(project_root, "GDCdata")

# Also write one combined CSV holding every sample, plus a sample sheet
# saying which group each column belongs to.
write_combined <- TRUE

# ============================================================================
#  end CONFIG
# ============================================================================


# ---------------------------------------------------------------- packages --

required <- c("TCGAbiolinks", "SummarizedExperiment")
missing  <- required[!vapply(required, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing) > 0) {
  stop(
    "Missing package(s): ", paste(missing, collapse = ", "), "\n",
    '  install.packages("BiocManager")\n',
    '  BiocManager::install(c("', paste(missing, collapse = '", "'), '"))'
  )
}

suppressPackageStartupMessages({
  library(TCGAbiolinks)
  library(SummarizedExperiment)
})


# ----------------------------------------------------------------- helpers --

#' Read a group's barcodes, whether they were given inline or in a file.
read_barcodes <- function(value, group_name) {
  if (length(value) == 1 && file.exists(value)) {
    ids <- readLines(value, warn = FALSE)
  } else {
    ids <- value
  }
  ids <- trimws(ids)
  ids <- ids[nzchar(ids)]
  if (length(ids) == 0) {
    stop("Group '", group_name, "' has no barcodes.")
  }
  unique(ids)
}

#' Which group does a downloaded column belong to?
#'
#' GDC returns full-length barcodes, but people usually paste shortened ones,
#' so an exact match is not enough. A column belongs to a group if one of that
#' group's barcodes is a prefix of it, or the other way round.
assign_group <- function(column_id, barcode_map) {
  for (group_name in names(barcode_map)) {
    ids <- barcode_map[[group_name]]
    if (any(startsWith(column_id, ids)) || any(startsWith(ids, column_id))) {
      return(group_name)
    }
  }
  NA_character_
}


# -------------------------------------------------------------- validation --

if (length(groups) < 1) stop("Define at least one group in CONFIG.")

if (any(duplicated(names(groups))) || any(!nzchar(names(groups)))) {
  stop("Every group needs a unique, non-empty name.")
}

barcode_map <- lapply(names(groups), function(g) read_barcodes(groups[[g]], g))
names(barcode_map) <- names(groups)

# The same sample in two groups would be counted twice and silently bias
# every comparison downstream.
all_barcodes <- unlist(barcode_map, use.names = FALSE)
if (any(duplicated(all_barcodes))) {
  stop(
    "These barcodes appear in more than one group: ",
    paste(unique(all_barcodes[duplicated(all_barcodes)]), collapse = ", ")
  )
}

dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)

message("Project      : ", gdc_project)
message("Groups       : ", paste(
  sprintf("%s (%d)", names(barcode_map), lengths(barcode_map)),
  collapse = ", "
))
message("Total samples: ", length(all_barcodes))


# ------------------------------------------------------------------- query --

# One query for every barcode rather than one per group. The GDC is queried
# and downloaded once, which is faster and keeps the cache coherent; the
# split into groups happens locally afterwards.
message("\nQuerying the GDC ...")

query <- GDCquery(
  project       = gdc_project,
  data.category = data_category,
  data.type     = data_type,
  workflow.type = workflow_type,
  barcode       = all_barcodes
)

found <- getResults(query)
if (nrow(found) == 0) {
  stop(
    "The query returned nothing.\n",
    "  Check gdc_project, workflow_type and the barcodes in CONFIG."
  )
}
message("Found ", nrow(found), " file(s) for ", length(all_barcodes), " requested barcode(s).")


# ---------------------------------------------------------------- download --

message("\nDownloading (this can take a while on the first run) ...")

dir.create(gdc_cache_dir, recursive = TRUE, showWarnings = FALSE)

# `directory` rather than changing into the cache folder: nothing here alters
# the working directory, so every relative path in CONFIG keeps meaning what
# it says however this script exits.
GDCdownload(query, method = "api", files.per.chunk = 10, directory = gdc_cache_dir)

message("Assembling the expression matrix ...")
se <- GDCprepare(query, directory = gdc_cache_dir)


# ------------------------------------------------------------------ matrix --

available <- assayNames(se)
if (!assay_name %in% available) {
  stop(
    "assay_name '", assay_name, "' is not in this object.\n",
    "  Available: ", paste(available, collapse = ", ")
  )
}

counts <- assay(se, assay_name)
message("Matrix: ", nrow(counts), " genes x ", ncol(counts), " samples")


# ------------------------------------------------------------------- split --

column_groups <- vapply(colnames(counts), assign_group, character(1), barcode_map)

unmatched <- colnames(counts)[is.na(column_groups)]
if (length(unmatched) > 0) {
  warning(
    length(unmatched), " downloaded sample(s) matched no group and were left out: ",
    paste(utils::head(unmatched, 5), collapse = ", "),
    if (length(unmatched) > 5) ", ..." else ""
  )
}

for (group_name in names(barcode_map)) {
  keep <- which(column_groups == group_name)

  if (length(keep) == 0) {
    warning("Group '", group_name, "' matched no downloaded samples. No file written.")
    next
  }

  out_file <- file.path(output_dir, paste0(group_name, ".csv"))
  write.csv(counts[, keep, drop = FALSE], out_file)
  message(sprintf("  %-14s %3d sample(s) -> %s", group_name, length(keep), out_file))
}


# ---------------------------------------------------------------- combined --

if (write_combined) {
  keep <- which(!is.na(column_groups))

  write.csv(
    counts[, keep, drop = FALSE],
    file.path(output_dir, "all_samples.csv")
  )

  write.csv(
    data.frame(
      sample = colnames(counts)[keep],
      group  = column_groups[keep],
      row.names = NULL
    ),
    file.path(output_dir, "sample_sheet.csv"),
    row.names = FALSE
  )

  message("  combined       -> ", file.path(output_dir, "all_samples.csv"))
  message("  sample sheet   -> ", file.path(output_dir, "sample_sheet.csv"))
}

message("\nDone. Next: deseq2_contrasts.R")
