#!/usr/bin/env Rscript
# Volcano plot from a DESeq2 results table.
#
# Reads a CSV written with write.csv(as.data.frame(res), "results.csv"),
# applies the cutoffs set below, labels the most extreme genes on each side,
# and writes a PDF sized for a single-column figure.

# ---------------------------------------------------------------- settings

input_file  <- "results.csv"   # DESeq2 results, as CSV
output_file <- "volcano.pdf"

lfc_cutoff  <- 1      # |log2 fold change| at or above this counts as changed
padj_cutoff <- 0.05   # adjusted p-value at or below this counts as significant
label_n     <- 10     # genes labelled on each side; 0 for none

up_colour   <- "#c0392b"
down_colour <- "#2471a3"
flat_colour <- "#b8bfc7"

width_in    <- 4.5
height_in   <- 5

# ------------------------------------------------------------------- setup

suppressPackageStartupMessages({
  library(ggplot2)
  library(ggrepel)
})

if (!file.exists(input_file)) {
  stop("Cannot find '", input_file, "'. Set input_file at the top of this script.")
}

res <- read.csv(input_file, row.names = 1, check.names = FALSE)

# DESeq2 keeps gene names as row names; tables exported from elsewhere often
# carry them in a column instead. Accept either.
if (!"gene" %in% names(res)) {
  res$gene <- rownames(res)
}

required <- c("log2FoldChange", "padj", "gene")
missing <- setdiff(required, names(res))
if (length(missing) > 0) {
  stop("Missing column(s): ", paste(missing, collapse = ", "))
}

# Genes DESeq2 filtered out come back with padj = NA. They are not evidence of
# no change, so they are dropped rather than plotted along the zero line.
res <- res[!is.na(res$padj) & !is.na(res$log2FoldChange), ]
if (nrow(res) == 0) stop("No genes left after removing rows with NA padj.")

# --------------------------------------------------------------- direction

res$direction <- "Not significant"
res$direction[res$padj <= padj_cutoff & res$log2FoldChange >= lfc_cutoff] <- "Up"
res$direction[res$padj <= padj_cutoff & res$log2FoldChange <= -lfc_cutoff] <- "Down"
res$direction <- factor(res$direction, levels = c("Up", "Down", "Not significant"))

cat(sprintf(
  "%d up, %d down, %d unchanged (|log2FC| >= %g, padj <= %g)\n",
  sum(res$direction == "Up"),
  sum(res$direction == "Down"),
  sum(res$direction == "Not significant"),
  lfc_cutoff, padj_cutoff
))

# ------------------------------------------------------------------ labels

# The most significant genes on each side, not simply the largest fold changes:
# a huge fold change on a barely-expressed gene is the usual way a volcano plot
# ends up labelling noise.
top <- res[0, ]
if (label_n > 0) {
  for (side in c("Up", "Down")) {
    hits <- res[res$direction == side, ]
    if (nrow(hits) > 0) {
      hits <- hits[order(hits$padj), ]
      top <- rbind(top, head(hits, label_n))
    }
  }
}

# --------------------------------------------------------------------- plot

# padj can be exactly 0 after underflow, and log10(0) is -Inf, which silently
# drops the most significant genes. Floor it at the smallest non-zero value.
floor_p <- min(res$padj[res$padj > 0], na.rm = TRUE)
res$plot_p <- pmax(res$padj, floor_p)
top$plot_p <- pmax(top$padj, floor_p)

plot <- ggplot(res, aes(x = log2FoldChange, y = -log10(plot_p), colour = direction)) +
  geom_point(size = 1.2, alpha = 0.75) +
  geom_vline(xintercept = c(-lfc_cutoff, lfc_cutoff), linetype = "dashed",
             colour = "grey60", linewidth = 0.3) +
  geom_hline(yintercept = -log10(padj_cutoff), linetype = "dashed",
             colour = "grey60", linewidth = 0.3) +
  scale_colour_manual(values = c(
    "Up" = up_colour, "Down" = down_colour, "Not significant" = flat_colour
  )) +
  labs(x = expression(log[2] ~ "fold change"),
       y = expression(-log[10] ~ "adjusted p"),
       colour = NULL) +
  theme_classic(base_size = 10) +
  theme(legend.position = "top")

if (nrow(top) > 0) {
  plot <- plot + geom_text_repel(
    data = top, aes(label = gene),
    size = 2.6, max.overlaps = Inf, box.padding = 0.4,
    segment.size = 0.2, show.legend = FALSE
  )
}

ggsave(output_file, plot, width = width_in, height = height_in)
cat("Wrote", output_file, "\n")
