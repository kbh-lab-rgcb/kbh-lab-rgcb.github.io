#!/usr/bin/env Rscript
# ============================================================================
#  Sequence windows around FIMO motif hits, ready for primer design
# ----------------------------------------------------------------------------
#  Reads FIMO hit tables, picks the hits worth designing primers against,
#  extracts a window of genome sequence centred on each one, and writes a
#  FASTA you can paste straight into Primer3 or NCBI Primer-BLAST -- plus a
#  table recording exactly which hit each sequence came from.
#
#  INPUT   one FIMO .tsv per target (from the MEME Suite), and a genome FASTA
#  OUTPUT  <output_dir>/primer_regions.fa
#          <output_dir>/primer_regions.tsv
#
#  Any organism, any genome build, any number of targets. Independent of the
#  other blocks in this toolkit.
#
#  ---------------------------------------------------------------------------
#  WHY THE CASE OF THE MATCHED SEQUENCE MATTERS
#
#  Genome FASTA files from UCSC use lowercase for repeat-masked sequence and,
#  when you export a gene region, uppercase for coding sequence with the rest
#  in lowercase. If your FIMO input FASTA carried that convention, the case of
#  `matched_sequence` tells you where the hit sits:
#
#    all lowercase  intron or intergenic  -> SAFE to design against
#    ALL UPPERCASE  coding sequence       -> skipped
#    Mixed case     a UTR/CDS boundary    -> skipped
#
#  This is read from the FIMO table, NOT by scanning the genome window: a
#  whole-genome FASTA has no CDS case distinction, so scanning it would be
#  meaningless. If your FIMO input had no case convention, set
#  `use_case_filter` to FALSE below and every hit is treated as usable.
# ============================================================================


# ============================================================================
#  CONFIG -- edit only this section
# ============================================================================

project_root <- "."
input_dir    <- file.path(project_root, "fimo")
output_dir   <- file.path(project_root, "results", "primer_regions")

# Genome FASTA, plain or gzipped. Must be the SAME build FIMO was run against
# or the coordinates will not line up.
genome_file <- file.path(project_root, "genome.fa.gz")

# --- Targets --------------------------------------------------------------
# One entry per FIMO output file. `label` names the sequences in the FASTA.
targets <- list(
  list(fimo = "fimo_target1.tsv", label = "Target1"),
  list(fimo = "fimo_target2.tsv", label = "Target2")
)
# Or discover them automatically -- every .tsv in input_dir, labelled by
# filename. Set to TRUE and `targets` above is ignored.
auto_discover <- FALSE

# --- Window ---------------------------------------------------------------
# Sequence extracted around each motif midpoint. 200 bp suits qPCR primer
# design; widen for cloning or standard PCR.
window_size <- 200

# Minus-strand windows are reverse-complemented so every sequence is written
# 5' to 3' on the strand the motif was found on.
revcomp_minus <- TRUE

# --- Which hits to keep ---------------------------------------------------
# See the note at the top. FALSE keeps every hit regardless of case.
use_case_filter <- TRUE

# How many hits to take from each strand, best p-value first.
n_plus  <- 2
n_minus <- 1

# The minus strand is often entirely coding, leaving nothing usable. When that
# happens, take extra plus-strand hits instead rather than returning fewer
# regions than asked for.
fallback_to_plus <- TRUE

# Ignore hits weaker than this. Inf keeps everything, which is deliberate for
# the minus strand -- usable minus hits are scarce enough that a threshold
# often removes the only candidate.
max_pvalue <- Inf

# --- FIMO column names ----------------------------------------------------
# The MEME Suite has changed these across versions; adjust if your file differs.
col_sequence_name <- "sequence_name"
col_start         <- "start"
col_stop          <- "stop"
col_strand        <- "strand"
col_pvalue        <- "p.value"
col_matched       <- "matched_sequence"

# How to get a chromosome name out of `sequence_name`. FIMO inherits whatever
# the input FASTA headers held; UCSC exports look like "range=chr8:12345-67890".
# Set to NULL if sequence_name is already a bare chromosome name.
chr_pattern     <- "^.*range=([^:]+).*$"
chr_replacement <- "\\1"

# ============================================================================
#  end CONFIG
# ============================================================================


# ---------------------------------------------------------------- packages --

required <- c("Biostrings")
missing  <- required[!vapply(required, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing) > 0) {
  stop("Missing package(s): ", paste(missing, collapse = ", "), "\n",
       "  install.packages(\"BiocManager\")\n",
       "  BiocManager::install(c(", paste0("\"", missing, "\"", collapse = ", "), "))")
}

suppressPackageStartupMessages(library(Biostrings))


# ----------------------------------------------------------------- helpers --

# Where does this hit sit, judged by the case of the matched sequence?
classify_case <- function(seq) {
  ifelse(seq == tolower(seq), "safe",
         ifelse(seq == toupper(seq), "coding", "boundary"))
}

# Chromosome name out of whatever FIMO put in sequence_name.
parse_chromosome <- function(sequence_name) {
  if (is.null(chr_pattern)) return(as.character(sequence_name))
  sub(chr_pattern, chr_replacement, as.character(sequence_name))
}

# Read one FIMO table and choose the hits to design against.
select_hits <- function(fimo_path, label) {
  fimo <- read.delim(fimo_path, header = TRUE, sep = "\t",
                     comment.char = "#", stringsAsFactors = FALSE)

  for (needed in c(col_sequence_name, col_start, col_stop, col_strand, col_pvalue)) {
    if (!needed %in% names(fimo)) {
      warning("[", label, "] column '", needed, "' is missing. ",
              "Columns present: ", paste(names(fimo), collapse = ", "))
      return(NULL)
    }
  }

  fimo <- fimo[!is.na(fimo[[col_start]]) & nzchar(fimo[[col_sequence_name]]), ]
  if (nrow(fimo) == 0) {
    warning("[", label, "] no usable rows in ", fimo_path)
    return(NULL)
  }

  fimo$chr <- parse_chromosome(fimo[[col_sequence_name]])

  fimo$region_type <- if (use_case_filter && col_matched %in% names(fimo)) {
    classify_case(fimo[[col_matched]])
  } else {
    rep("safe", nrow(fimo))
  }

  fimo <- fimo[order(fimo[[col_pvalue]]), ]
  fimo <- fimo[fimo[[col_pvalue]] <= max_pvalue, ]

  message(sprintf("\n  [%s] %d hit(s)", label, nrow(fimo)))
  if (use_case_filter) {
    message(sprintf("    usable   %d", sum(fimo$region_type == "safe")))
    message(sprintf("    coding   %d  (skipped)", sum(fimo$region_type == "coding")))
    message(sprintf("    boundary %d  (skipped)", sum(fimo$region_type == "boundary")))
  }

  usable <- fimo[fimo$region_type == "safe", ]
  plus   <- usable[usable[[col_strand]] == "+", ]
  minus  <- usable[usable[[col_strand]] == "-", ]

  message(sprintf("    usable on + : %d", nrow(plus)))
  message(sprintf("    usable on - : %d", nrow(minus)))

  chosen <- list()

  take_plus <- min(n_plus, nrow(plus))
  for (i in seq_len(take_plus)) {
    chosen[[paste0("plus", i)]] <- plus[i, ]
  }
  if (take_plus < n_plus) {
    warning("[", label, "] wanted ", n_plus,
            " plus-strand hit(s), found ", take_plus)
  }

  take_minus <- min(n_minus, nrow(minus))
  for (i in seq_len(take_minus)) {
    chosen[[paste0("minus", i)]] <- minus[i, ]
  }

  shortfall <- n_minus - take_minus
  if (shortfall > 0) {
    message(sprintf("    no usable minus-strand hit (all %d are coding or boundary)",
                    sum(fimo[[col_strand]] == "-")))

    if (fallback_to_plus) {
      extra_available <- nrow(plus) - take_plus
      extra <- min(shortfall, extra_available)

      if (extra > 0) {
        for (i in seq_len(extra)) {
          chosen[[paste0("plus", take_plus + i, "_fallback")]] <- plus[take_plus + i, ]
        }
        message(sprintf("    substituting %d extra plus-strand hit(s)", extra))
      } else {
        warning("[", label, "] no minus hit and no spare plus hit to substitute")
      }
    }
  }

  if (length(chosen) == 0) {
    warning("[", label, "] nothing usable found")
    return(NULL)
  }
  chosen
}

# The genome window centred on one hit.
extract_window <- function(hit, genome, label, hit_name) {
  chr <- hit$chr

  if (!chr %in% names(genome)) {
    warning("[", label, " | ", hit_name, "] '", chr,
            "' is not in the genome FASTA. Skipped.")
    return(NULL)
  }

  chromosome <- genome[[chr]]
  midpoint   <- round((hit[[col_start]] + hit[[col_stop]]) / 2)
  half       <- floor(window_size / 2)

  start_pos <- max(1, midpoint - half)
  end_pos   <- min(length(chromosome), midpoint + (window_size - half) - 1)

  if (end_pos <= start_pos) {
    warning("[", label, " | ", hit_name, "] window fell outside the chromosome.")
    return(NULL)
  }

  seq <- DNAStringSet(subseq(chromosome, start = start_pos, end = end_pos))

  if (revcomp_minus && hit[[col_strand]] == "-") {
    seq <- reverseComplement(seq)
  }

  # Everything needed to trace this sequence back to its hit, in the header.
  names(seq) <- sprintf(
    "%s|%s|%s:%d-%d|motif:%d-%d|strand:%s|p=%.2e",
    label, hit_name, chr, start_pos, end_pos,
    hit[[col_start]], hit[[col_stop]], hit[[col_strand]], hit[[col_pvalue]]
  )

  list(seq = seq, start = start_pos, end = end_pos, header = names(seq))
}


# -------------------------------------------------------------- find inputs --

if (auto_discover) {
  found <- list.files(input_dir, pattern = "\\.tsv$", full.names = FALSE)
  if (length(found) == 0) {
    stop("No .tsv files found in '", input_dir, "'.")
  }
  targets <- lapply(found, function(f) {
    list(fimo = f, label = sub("^fimo[-_]?", "", sub("\\.tsv$", "", f)))
  })
  message("Discovered ", length(targets), " FIMO file(s) in ", input_dir)
}

if (length(targets) == 0) stop("No targets defined in CONFIG.")

if (!file.exists(genome_file)) {
  stop("Cannot find the genome FASTA:\n  ", genome_file, "\n",
       "  Set genome_file in CONFIG. It must be the build FIMO was run against.")
}


# ------------------------------------------------------------- load genome --

message("Loading the genome (this takes a minute for a full build) ...")
genome <- readDNAStringSet(genome_file)

# FASTA headers usually carry a description after the name; strip it so
# "chr1 AC:CM000663.2" matches the plain "chr1" that FIMO reports.
names(genome) <- sub(" .*", "", names(genome))
message("Loaded ", length(genome), " sequence(s): ",
        paste(utils::head(names(genome), 5), collapse = ", "),
        if (length(genome) > 5) ", ..." else "")


# ------------------------------------------------------------------ process --

all_seqs <- DNAStringSet()
rows     <- list()

for (target in targets) {
  fimo_path <- file.path(input_dir, target$fimo)

  if (!file.exists(fimo_path)) {
    warning("Not found, skipped: ", fimo_path)
    next
  }

  hits <- select_hits(fimo_path, target$label)
  if (is.null(hits)) next

  for (hit_name in names(hits)) {
    hit <- hits[[hit_name]]

    extracted <- extract_window(hit, genome, target$label, hit_name)
    if (is.null(extracted)) next

    all_seqs <- c(all_seqs, extracted$seq)

    is_fallback <- grepl("fallback", hit_name)

    message(sprintf("    -> %-22s %s:%d-%d  %s  p=%.2e%s",
                    paste0(target$label, "|", hit_name),
                    hit$chr, hit[[col_start]], hit[[col_stop]],
                    hit[[col_strand]], hit[[col_pvalue]],
                    if (is_fallback) "  [substituted for a minus hit]" else ""))

    rows[[length(rows) + 1]] <- data.frame(
      target       = target$label,
      role         = hit_name,
      is_fallback  = is_fallback,
      chr          = hit$chr,
      region_start = extracted$start,
      region_end   = extracted$end,
      motif_start  = hit[[col_start]],
      motif_end    = hit[[col_stop]],
      strand       = hit[[col_strand]],
      pvalue       = hit[[col_pvalue]],
      matched_seq  = if (col_matched %in% names(hit)) hit[[col_matched]] else NA_character_,
      region_type  = hit$region_type,
      fasta_header = extracted$header,
      stringsAsFactors = FALSE
    )
  }
}

if (length(all_seqs) == 0) {
  stop("No sequences were extracted. Check the FIMO files and the genome build.")
}


# ------------------------------------------------------------------ outputs --

dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)

fasta_path <- file.path(output_dir, "primer_regions.fa")
table_path <- file.path(output_dir, "primer_regions.tsv")

writeXStringSet(all_seqs, fasta_path)
write.table(do.call(rbind, rows), table_path,
            sep = "\t", row.names = FALSE, quote = FALSE)

message("\n", length(all_seqs), " region(s) extracted")
message("  -> ", fasta_path)
message("  -> ", table_path)

message("\nPaste the FASTA into Primer3 or NCBI Primer-BLAST to design against ",
        "these regions.")
