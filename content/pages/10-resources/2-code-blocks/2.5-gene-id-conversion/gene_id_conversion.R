#!/usr/bin/env Rscript
# ============================================================================
#  Add gene symbols (and Entrez IDs) to a results table
# ----------------------------------------------------------------------------
#  Takes any table with a gene-ID column and adds readable gene symbols plus
#  Entrez IDs, which the enrichment blocks need.
#
#  INPUT   <input_dir>/<contrast>/deseq2_results.csv  (or any CSV with an ID column)
#  OUTPUT  <input_dir>/<contrast>/deseq2_results_annotated.csv
#  NEXT    volcano_heatmap.R, gsea_ranked.R, kegg_pathview.R
#
#  Works for any organism. Two lookup routes are tried in order:
#    1. biomaRt  -- online, most complete, occasionally down
#    2. org.*.eg.db -- offline, installed locally, slightly less complete
#  If biomaRt cannot be reached the script falls back automatically rather
#  than failing, so a flaky connection never costs you the run.
# ============================================================================


# ============================================================================
#  CONFIG -- edit only this section
# ============================================================================

project_root <- "."
input_dir    <- file.path(project_root, "results", "02_deseq2")

# Annotate every <contrast>/deseq2_results.csv under input_dir.
# Set to a single file path instead to annotate just that one.
input_file <- NULL
# input_file <- file.path(project_root, "my_results.csv")

# Column holding the gene identifiers. "auto" picks the first of
# gene_id / ensembl_id / ensembl_gene_id / gene / X that exists, or the
# row names if none do.
id_column <- "auto"

# --- Organism -------------------------------------------------------------
# Change these five lines and nothing else to move to another species.
#
#   human  org.Hs.eg.db  hsapiens_gene_ensembl   hgnc_symbol
#   mouse  org.Mm.eg.db  mmusculus_gene_ensembl  mgi_symbol
#   rat    org.Rn.eg.db  rnorvegicus_gene_ensembl  rgd_symbol
#   fly    org.Dm.eg.db  dmelanogaster_gene_ensembl  external_gene_name
#   zebrafish org.Dr.eg.db  drerio_gene_ensembl   zfin_id_symbol
#
# `external_gene_name` works as a symbol column for every Ensembl species and
# is the safe choice if you are unsure.
species_orgdb   <- "org.Hs.eg.db"
species_biomart <- "hsapiens_gene_ensembl"
symbol_column   <- "hgnc_symbol"

# What kind of ID is in id_column: "ensembl_gene_id", "entrezgene_id",
# "refseq_mrna", or the symbol column itself.
id_type <- "ensembl_gene_id"

# Also look up Entrez IDs. The enrichment blocks need them for KEGG and
# Reactome, so leaving this on saves a second lookup later.
add_entrez <- TRUE

# --- Behaviour ------------------------------------------------------------
# Genes with no symbol keep their original ID rather than becoming NA, so
# nothing silently vanishes from a plot or a ranked list.
fill_missing_with_id <- TRUE

# Try biomaRt first. Set FALSE to go straight to the offline org.db.
use_biomart <- TRUE

# Ensembl mirror. Change if the default is slow or down:
# "www", "useast", "asia"
biomart_mirror <- "www"

# ============================================================================
#  end CONFIG
# ============================================================================


# ----------------------------------------------------------------- helpers --

have <- function(pkg) requireNamespace(pkg, quietly = TRUE)

pick_id_column <- function(df) {
  if (!identical(id_column, "auto")) {
    if (!id_column %in% names(df)) {
      stop("id_column '", id_column, "' is not in the table.\n",
           "  Columns present: ", paste(names(df), collapse = ", "))
    }
    return(id_column)
  }

  for (candidate in c("gene_id", "ensembl_id", "ensembl_gene_id", "gene", "X")) {
    if (candidate %in% names(df)) return(candidate)
  }
  NA_character_
}

# Look symbols up online. Returns NULL on any failure so the caller can fall
# back rather than the whole run dying because a mirror was busy.
lookup_biomart <- function(ids) {
  if (!use_biomart || !have("biomaRt")) return(NULL)

  attributes <- unique(c(id_type, symbol_column,
                         if (add_entrez) "entrezgene_id" else NULL))

  result <- try({
    mart <- biomaRt::useEnsembl(
      biomart = "genes",
      dataset = species_biomart,
      mirror  = biomart_mirror
    )
    biomaRt::getBM(
      attributes = attributes,
      filters    = id_type,
      values     = ids,
      mart       = mart
    )
  }, silent = TRUE)

  if (inherits(result, "try-error") || !is.data.frame(result) || nrow(result) == 0) {
    message("  biomaRt unavailable or empty; falling back to ", species_orgdb)
    return(NULL)
  }

  names(result)[names(result) == id_type]        <- "lookup_id"
  names(result)[names(result) == symbol_column]  <- "gene_symbol"
  names(result)[names(result) == "entrezgene_id"] <- "entrez_id"

  result
}

# Offline lookup through an organism annotation package.
lookup_orgdb <- function(ids) {
  if (!have(species_orgdb) || !have("AnnotationDbi")) {
    stop(
      "Cannot annotate: biomaRt failed and ", species_orgdb, " is not installed.\n",
      "  install.packages(\"BiocManager\")\n",
      "  BiocManager::install(\"", species_orgdb, "\")"
    )
  }

  db <- getExportedValue(species_orgdb, species_orgdb)

  # org.db keytypes are its own vocabulary, not biomaRt's.
  keytype <- switch(
    id_type,
    ensembl_gene_id = "ENSEMBL",
    entrezgene_id   = "ENTREZID",
    refseq_mrna     = "REFSEQ",
    "SYMBOL"
  )

  wanted <- c("SYMBOL", if (add_entrez) "ENTREZID" else NULL)
  wanted <- setdiff(wanted, keytype)

  mapped <- suppressMessages(AnnotationDbi::select(
    db, keys = unique(ids), keytype = keytype, columns = wanted
  ))

  out <- data.frame(lookup_id = mapped[[keytype]], stringsAsFactors = FALSE)
  out$gene_symbol <- if ("SYMBOL" %in% names(mapped)) mapped$SYMBOL else mapped[[keytype]]
  if (add_entrez) {
    out$entrez_id <- if ("ENTREZID" %in% names(mapped)) mapped$ENTREZID else NA_character_
  }
  out
}

annotate_table <- function(df, label) {
  id_col <- pick_id_column(df)

  if (is.na(id_col)) {
    df$gene_id <- rownames(df)
    id_col <- "gene_id"
    message("  no ID column found; using row names")
  }

  ids <- as.character(df[[id_col]])
  message("  ", length(unique(ids)), " unique identifier(s) to look up")

  mapping <- lookup_biomart(ids)
  if (is.null(mapping)) mapping <- lookup_orgdb(ids)

  # One ID can map to several symbols. Keep the first, so the join cannot
  # multiply the number of rows in the results table.
  mapping <- mapping[!duplicated(mapping$lookup_id), , drop = FALSE]

  df$gene_symbol <- mapping$gene_symbol[match(ids, mapping$lookup_id)]
  if (add_entrez && "entrez_id" %in% names(mapping)) {
    df$entrez_id <- mapping$entrez_id[match(ids, mapping$lookup_id)]
  }

  found <- sum(!is.na(df$gene_symbol) & nzchar(df$gene_symbol))
  message("  matched ", found, " of ", nrow(df), " row(s)")

  if (fill_missing_with_id) {
    blank <- is.na(df$gene_symbol) | !nzchar(df$gene_symbol)
    df$gene_symbol[blank] <- ids[blank]
  }

  df
}


# -------------------------------------------------------------------- run --

files <- if (!is.null(input_file)) {
  if (!file.exists(input_file)) {
    stop("Cannot find '", input_file, "'.")
  }
  input_file
} else {
  found <- list.files(
    input_dir,
    pattern    = "^deseq2_results\\.csv$",
    recursive  = TRUE,
    full.names = TRUE
  )
  if (length(found) == 0) {
    stop(
      "No deseq2_results.csv found under '", input_dir, "'.\n",
      "  Run deseq2_contrasts.R first, or set input_file in CONFIG."
    )
  }
  found
}

message(length(files), " table(s) to annotate\n")

for (path in files) {
  label <- basename(dirname(path))
  message(label)

  df  <- read.csv(path, check.names = FALSE)
  out <- annotate_table(df, label)

  target <- if (!is.null(input_file)) {
    sub("\\.csv$", "_annotated.csv", path)
  } else {
    file.path(dirname(path), "deseq2_results_annotated.csv")
  }

  write.csv(out, target, row.names = FALSE)
  message("  -> ", target, "\n")
}

message("Done. Next: volcano_heatmap.R or gsea_ranked.R")
