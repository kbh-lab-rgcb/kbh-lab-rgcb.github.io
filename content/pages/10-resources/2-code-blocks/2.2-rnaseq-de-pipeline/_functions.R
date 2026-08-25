# ============================================================================
#  _functions.R -- shared routines for every step
# ----------------------------------------------------------------------------
#  Sourced by the numbered step scripts. Nothing here runs on its own and
#  nothing here needs editing: every setting comes from config.R.
# ============================================================================


# ------------------------------------------------------------------ generic --

need <- function(...) {
  pkgs    <- c(...)
  missing <- pkgs[!vapply(pkgs, requireNamespace, logical(1), quietly = TRUE)]
  if (length(missing) > 0) {
    stop("Missing package(s): ", paste(missing, collapse = ", "), "\n",
         "  install.packages(\"BiocManager\")\n",
         "  BiocManager::install(c(",
         paste0("\"", missing, "\"", collapse = ", "), "))",
         call. = FALSE)
  }
  invisible(TRUE)
}

step_header <- function(text) {
  message("\n", strrep("=", 74))
  message("  ", text)
  message(strrep("=", 74))
}

# Write one plot in every format listed in out_formats.
#
# svg() and pdf() take no `res` argument -- passing one is an error, which is
# why the device call is branched rather than shared.
save_plot <- function(draw_fn, path_without_ext, width, height) {
  for (fmt in out_formats) {
    path <- paste0(path_without_ext, ".", fmt)
    switch(
      fmt,
      tiff = grDevices::tiff(path, width = width, height = height, units = "in",
                             res = plot_dpi, compression = "lzw"),
      png  = grDevices::png(path, width = width, height = height, units = "in",
                            res = plot_dpi),
      svg  = grDevices::svg(path, width = width, height = height),
      pdf  = grDevices::pdf(path, width = width, height = height),
      stop("Unknown output format: ", fmt)
    )
    draw_fn()
    grDevices::dev.off()
  }
}


# ------------------------------------------------------------------- counts --

# Read one group's counts as a numeric matrix keyed by gene ID.
read_counts_file <- function(path, group_name) {
  if (!file.exists(path)) {
    stop("Cannot find the counts for group '", group_name, "':\n  ", path, "\n",
         "  Run 01_download_counts.R, or put your own CSV there.", call. = FALSE)
  }

  raw <- read.csv(path, row.names = 1, check.names = FALSE)

  # A non-numeric column is usually annotation that travelled with the matrix
  # (gene_name, gene_type). Drop it rather than failing.
  numeric_cols <- vapply(raw, is.numeric, logical(1))
  if (any(!numeric_cols)) {
    raw <- raw[, numeric_cols, drop = FALSE]
  }
  if (ncol(raw) == 0) stop("Group '", group_name, "' has no numeric columns.")

  mat <- as.matrix(raw)

  if (strip_ensembl_version) {
    rownames(mat) <- sub("\\.[0-9]+$", "", rownames(mat))
  }

  # Version-stripping can create duplicates. Sum them so no counts are lost.
  if (any(duplicated(rownames(mat)))) {
    mat <- rowsum(mat, rownames(mat))
  }

  mat
}

# Every group's matrix, plus any merged groups defined in config.R.
load_all_matrices <- function() {
  matrices <- list()

  for (group_name in names(sample_groups)) {
    path <- file.path(dir_counts, paste0(group_name, ".csv"))
    matrices[[group_name]] <- read_counts_file(path, group_name)
    message(sprintf("  %-14s %6d genes x %3d samples",
                    group_name, nrow(matrices[[group_name]]),
                    ncol(matrices[[group_name]])))
  }

  # A merged group is an ordinary group from here on, which is why nothing
  # downstream needs a notion of merging.
  for (meta_name in names(meta_groups)) {
    parts   <- meta_groups[[meta_name]]
    unknown <- setdiff(parts, names(matrices))
    if (length(unknown) > 0) {
      stop("meta_groups[\"", meta_name, "\"] refers to unknown group(s): ",
           paste(unknown, collapse = ", "), call. = FALSE)
    }

    shared <- Reduce(intersect, lapply(matrices[parts], rownames))
    matrices[[meta_name]] <- do.call(
      cbind, lapply(parts, function(p) matrices[[p]][shared, , drop = FALSE])
    )
    message(sprintf("  %-14s %6d genes x %3d samples  (merged: %s)",
                    meta_name, nrow(matrices[[meta_name]]),
                    ncol(matrices[[meta_name]]), paste(parts, collapse = " + ")))
  }

  matrices
}

# Turn the `contrasts` setting into an explicit list of pairs.
resolve_contrasts <- function(matrices) {
  pairs <- if (identical(contrasts, "all_pairs")) {
    names_vec <- names(sample_groups)
    if (length(names_vec) < 2) {
      stop("Need at least two groups to compare.", call. = FALSE)
    }
    # The earlier group becomes the denominator, so groups listed in
    # increasing order of dose read as "up in the more treated group".
    lapply(utils::combn(names_vec, 2, simplify = FALSE), function(p) c(p[2], p[1]))
  } else {
    contrasts
  }

  for (co in pairs) {
    if (length(co) != 2) {
      stop("Each contrast needs exactly two group names.", call. = FALSE)
    }
    unknown <- setdiff(co, names(matrices))
    if (length(unknown) > 0) {
      stop("Contrast ", paste(co, collapse = " vs "), " refers to unknown group(s): ",
           paste(unknown, collapse = ", "), call. = FALSE)
    }
  }

  pairs
}


# ------------------------------------------------------------------ DESeq2 --

# One contrast, start to finish.
#
# DIRECTION: results() is called as contrast = c("condition", g1, g2), so
#   positive log2FoldChange = higher in g1 (the first name)
#   negative log2FoldChange = higher in g2 (the second name)
# Every later step relies on that convention.
run_contrast <- function(matrices, g1, g2) {
  mat1 <- matrices[[g1]]
  mat2 <- matrices[[g2]]

  shared <- intersect(rownames(mat1), rownames(mat2))
  if (length(shared) == 0) {
    stop("Groups '", g1, "' and '", g2, "' share no gene IDs.", call. = FALSE)
  }

  combined <- cbind(mat1[shared, , drop = FALSE], mat2[shared, , drop = FALSE])

  condition <- factor(
    c(rep(g1, ncol(mat1)), rep(g2, ncol(mat2))),
    levels = c(g2, g1)   # reference level first
  )
  coldata <- data.frame(condition = condition)
  rownames(coldata) <- colnames(combined)

  dds <- DESeq2::DESeqDataSetFromMatrix(
    countData = round(combined), colData = coldata, design = ~ condition
  )

  if (min_total_count > 0) {
    keep <- rowSums(DESeq2::counts(dds)) >= min_total_count
    message("  dropped ", sum(!keep), " low-count gene(s), ", sum(keep), " left")
    dds <- dds[keep, ]
  }

  dds <- DESeq2::DESeq(dds, quiet = TRUE)
  res <- DESeq2::results(dds, contrast = c("condition", g1, g2), alpha = alpha)

  res_df <- as.data.frame(res)
  res_df$gene_id <- rownames(res_df)

  # Recorded in the file so a table opened months later still says which way
  # round the comparison ran.
  res_df$contrast_numerator   <- g1
  res_df$contrast_denominator <- g2

  list(res = res_df[order(res_df$padj, na.last = TRUE), ], dds = dds)
}


# ------------------------------------------------------------- annotation --

# Gene symbols and Entrez IDs, online first and offline as a fallback, so a
# flaky connection never costs the whole run.
annotate_ids <- function(ids) {
  mapping <- NULL

  if (use_biomart && requireNamespace("biomaRt", quietly = TRUE)) {
    attempt <- try({
      mart <- biomaRt::useEnsembl(biomart = "genes", dataset = species_biomart,
                                  mirror = biomart_mirror)
      biomaRt::getBM(
        attributes = unique(c(id_type, symbol_attribute,
                              if (add_entrez) "entrezgene_id" else NULL)),
        filters = id_type, values = ids, mart = mart
      )
    }, silent = TRUE)

    if (!inherits(attempt, "try-error") && is.data.frame(attempt) && nrow(attempt) > 0) {
      names(attempt)[names(attempt) == id_type]          <- "lookup_id"
      names(attempt)[names(attempt) == symbol_attribute] <- "gene_symbol"
      names(attempt)[names(attempt) == "entrezgene_id"]  <- "entrez_id"
      mapping <- attempt
    } else {
      message("  biomaRt unavailable; falling back to ", species_orgdb)
    }
  }

  if (is.null(mapping)) {
    need(species_orgdb, "AnnotationDbi")
    db <- getExportedValue(species_orgdb, species_orgdb)

    keytype <- switch(id_type,
                      ensembl_gene_id = "ENSEMBL",
                      entrezgene_id   = "ENTREZID",
                      "SYMBOL")
    wanted <- setdiff(c("SYMBOL", if (add_entrez) "ENTREZID" else NULL), keytype)

    got <- suppressMessages(AnnotationDbi::select(
      db, keys = unique(ids), keytype = keytype, columns = wanted
    ))

    mapping <- data.frame(lookup_id = got[[keytype]], stringsAsFactors = FALSE)
    mapping$gene_symbol <- if ("SYMBOL" %in% names(got)) got$SYMBOL else got[[keytype]]
    if (add_entrez) {
      mapping$entrez_id <- if ("ENTREZID" %in% names(got)) got$ENTREZID else NA_character_
    }
  }

  # One ID can map to several symbols. Keep the first, so the join cannot
  # multiply the rows of the results table.
  mapping[!duplicated(mapping$lookup_id), , drop = FALSE]
}


# --------------------------------------------------------------- figures --

build_volcano <- function(df, title) {
  df$direction <- "Not significant"
  df$direction[df$padj <= padj_cutoff & df$log2FoldChange >=  lfc_cutoff] <- "Up"
  df$direction[df$padj <= padj_cutoff & df$log2FoldChange <= -lfc_cutoff] <- "Down"
  df$direction <- factor(df$direction, levels = c("Up", "Down", "Not significant"))

  # padj can underflow to exactly 0, and log10(0) is -Inf, which silently
  # drops the very genes the plot exists to show.
  positive <- df$padj[df$padj > 0]
  floor_p  <- if (length(positive) > 0) min(positive, na.rm = TRUE) else 1e-300
  df$plot_y <- -log10(pmax(df$padj, floor_p))

  # Label the most SIGNIFICANT genes per side, not the largest fold changes:
  # a huge fold change on a barely-expressed gene is the usual way a volcano
  # ends up labelling noise.
  to_label <- df[0, ]
  for (side in c("Up", "Down")) {
    n <- if (side == "Up") label_up else label_down
    if (n <= 0) next
    hits <- df[df$direction == side, ]
    if (nrow(hits) == 0) next
    to_label <- rbind(to_label, utils::head(hits[order(hits$padj), ], n))
  }

  label_col <- if ("gene_symbol" %in% names(df)) "gene_symbol" else "gene_id"

  p <- ggplot2::ggplot(df, ggplot2::aes(x = .data$log2FoldChange, y = .data$plot_y,
                                        fill = .data$direction)) +
    ggplot2::geom_vline(xintercept = c(-lfc_cutoff, lfc_cutoff),
                        linetype = "dashed", colour = "grey60", linewidth = 0.3) +
    ggplot2::geom_hline(yintercept = -log10(padj_cutoff),
                        linetype = "dashed", colour = "grey60", linewidth = 0.3) +
    ggplot2::geom_point(shape = 21, size = point_size, alpha = point_alpha,
                        stroke = point_stroke, colour = "black") +
    ggplot2::scale_fill_manual(values = c("Up" = col_up, "Down" = col_down,
                                          "Not significant" = col_ns)) +
    ggplot2::labs(title = title,
                  x = expression(log[2] ~ "fold change"),
                  y = expression(-log[10] ~ "adjusted p"), fill = NULL) +
    ggplot2::theme_classic(base_size = volcano_base_size) +
    ggplot2::theme(
      axis.title.y = ggplot2::element_text(face = "bold"),
      axis.title.x = ggplot2::element_text(face = "bold"),
      plot.title   = ggplot2::element_text(hjust = 0.5),
      legend.title = ggplot2::element_blank()
    )

  if (!is.null(volcano_xlim) || !is.null(volcano_ylim)) {
    p <- p + ggplot2::coord_cartesian(xlim = volcano_xlim, ylim = volcano_ylim)
  }
  if (!is.null(x_break_step) && x_break_step > 0) {
    span <- if (is.null(volcano_xlim)) range(df$log2FoldChange, na.rm = TRUE) else volcano_xlim
    p <- p + ggplot2::scale_x_continuous(
      breaks = seq(floor(span[1]), ceiling(span[2]), by = x_break_step))
  }
  if (nrow(to_label) > 0) {
    p <- p + ggrepel::geom_label_repel(
      data = to_label, ggplot2::aes(label = .data[[label_col]]),
      size = label_size, fill = ggplot2::alpha("white", 0.7), colour = "black",
      segment.colour = "grey50", segment.size = 0.3,
      label.size = 0.25, max.overlaps = Inf, show.legend = FALSE)
  }

  list(plot = p, table = df)
}

# The heatmap subsets on GENE ID and relabels to symbols only for display.
# Matching on the symbol instead -- against a matrix keyed by ID -- yields an
# empty intersection and a heatmap that is silently never drawn.
build_heatmap <- function(df, matrices, g1, g2, title) {
  shared <- intersect(rownames(matrices[[g1]]), rownames(matrices[[g2]]))
  expr <- cbind(matrices[[g1]][shared, , drop = FALSE],
                matrices[[g2]][shared, , drop = FALSE])

  sig <- df[!is.na(df$padj) & df$padj <= padj_cutoff &
              abs(df$log2FoldChange) >= lfc_cutoff, ]
  sig <- sig[sig$gene_id %in% rownames(expr), ]
  sig <- sig[order(sig$padj), ]

  if (nrow(sig) < 2) {
    message("  heatmap skipped: ", nrow(sig), " significant gene(s) in the matrix")
    return(NULL)
  }
  if (nrow(sig) > heatmap_max_genes) {
    sig <- utils::head(sig, heatmap_max_genes)
  }

  # Row z-scores: the question is which samples are high or low for a gene,
  # not how strongly the gene is expressed overall.
  scaled <- t(scale(t(expr[sig$gene_id, , drop = FALSE])))
  labels <- if ("gene_symbol" %in% names(sig)) sig$gene_symbol else sig$gene_id
  rownames(scaled) <- make.unique(as.character(labels))
  scaled <- scaled[apply(scaled, 1, function(x) all(is.finite(x))), , drop = FALSE]

  if (nrow(scaled) < 2) {
    message("  heatmap skipped: too few genes with non-zero variance")
    return(NULL)
  }

  annotation <- data.frame(Group = factor(c(rep(g1, ncol(matrices[[g1]])),
                                            rep(g2, ncol(matrices[[g2]])))))
  rownames(annotation) <- colnames(expr)

  pheatmap::pheatmap(
    scaled,
    scale          = "none",
    cluster_rows   = heatmap_cluster_rows,
    cluster_cols   = heatmap_cluster_cols,
    annotation_col = annotation,
    color          = grDevices::colorRampPalette(heatmap_colours)(50),
    fontsize_row   = heatmap_fontsize_row,
    show_colnames  = heatmap_show_colnames,
    main           = title,
    silent         = TRUE
  )
}
