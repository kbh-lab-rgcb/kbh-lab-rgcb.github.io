# ============================================================================
#  config.R -- every setting for the whole pipeline, in one place
# ----------------------------------------------------------------------------
#  This is the ONLY file you need to edit. Each step script reads it, so a
#  path or a threshold set here applies everywhere and cannot drift between
#  steps.
#
#  Run the whole thing with:   Rscript run_pipeline.R
#  Or one step at a time:      Rscript 02_deseq2.R
# ============================================================================


# --- Where everything lives -------------------------------------------------

# All output goes under here. "." means the folder you run from.
project_root <- "."

dir_counts    <- file.path(project_root, "results", "01_counts")
dir_deseq2    <- file.path(project_root, "results", "02_deseq2")
dir_figures   <- file.path(project_root, "results", "03_figures")
gdc_cache_dir <- file.path(project_root, "GDCdata")


# --- Step 1: where the counts come from -------------------------------------

# TRUE  download from the GDC using the barcodes below
# FALSE skip step 1 -- you already have counts CSVs in dir_counts
download_counts <- TRUE

gdc_project   <- "TCGA-PAAD"
data_category <- "Transcriptome Profiling"
data_type     <- "Gene Expression Quantification"
workflow_type <- "STAR - Counts"

# Differential expression needs RAW COUNTS. "unstranded" is the raw matrix;
# tpm_* and fpkm_* are already normalised and break the model DESeq2 fits.
assay_name <- "unstranded"

# Name each group and give it barcodes: a character vector, or the path to a
# text file with one barcode per line. Two groups or ten -- nothing in the
# pipeline counts them.
sample_groups <- list(
  control = c(
    "TCGA-XX-A1A1-01A-11R-A000-07",
    "TCGA-XX-A1A2-01A-11R-A000-07"
  ),
  treated = c(
    "TCGA-XX-A1A3-01A-11R-A000-07",
    "TCGA-XX-A1A4-01A-11R-A000-07"
  )
)

# When download_counts is FALSE, the pipeline expects one CSV per group named
# after it: dir_counts/control.csv, dir_counts/treated.csv, and so on.


# --- Step 2: differential expression ---------------------------------------

# "all_pairs" compares every group with every other one, or list them
# yourself as c(numerator, denominator).
contrasts <- "all_pairs"
# contrasts <- list(c("treated", "control"))

# Pool several groups into one so it can be compared as a single group.
meta_groups <- list()
# meta_groups <- list(mutant = c("ko1", "ko2", "ko3"))

strip_ensembl_version <- TRUE   # ENSG00000141510.16 -> ENSG00000141510
min_total_count <- 10           # drop genes below this many reads in total
alpha <- 0.05                   # significance level for DESeq2


# --- Step 3: gene identifiers ----------------------------------------------

# Change these three lines to move to another organism.
#   human  org.Hs.eg.db  hsapiens_gene_ensembl   hgnc_symbol
#   mouse  org.Mm.eg.db  mmusculus_gene_ensembl  mgi_symbol
#   rat    org.Rn.eg.db  rnorvegicus_gene_ensembl  rgd_symbol
#   fly    org.Dm.eg.db  dmelanogaster_gene_ensembl  external_gene_name
species_orgdb   <- "org.Hs.eg.db"
species_biomart <- "hsapiens_gene_ensembl"
symbol_attribute <- "hgnc_symbol"

id_type    <- "ensembl_gene_id"
add_entrez <- TRUE
use_biomart <- TRUE          # FALSE goes straight to the offline org.db
biomart_mirror <- "www"


# --- Step 4: figures --------------------------------------------------------

# One cutoff drives the guide lines, the point colours and the heatmap gene
# set, so they can never disagree with each other.
lfc_cutoff  <- 1
padj_cutoff <- 0.05

heatmap_max_genes <- 60

# PLOT SETTINGS
out_formats <- c("tiff", "svg")   # any of tiff, svg, png, pdf
plot_dpi    <- 300

volcano_width  <- 10
volcano_height <- 8
volcano_base_size <- 20

point_size   <- 2
point_alpha  <- 0.6
point_stroke <- 0.5

col_up   <- "#bb0c00"
col_down <- "#00AFBB"
col_ns   <- "grey"

label_up   <- 30    # most significant genes labelled per side; 0 for none
label_down <- 15
label_size <- 3

volcano_xlim <- NULL   # NULL fits the data; c(-4, 4) pins it across contrasts
volcano_ylim <- NULL
x_break_step <- 2

heatmap_width  <- 8
heatmap_height <- 12
heatmap_colours <- c("#2166ac", "white", "#b2182b")
heatmap_fontsize_row <- 6
heatmap_cluster_rows <- TRUE
heatmap_cluster_cols <- FALSE
heatmap_show_colnames <- FALSE
