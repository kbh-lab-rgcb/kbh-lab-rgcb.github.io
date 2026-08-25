#!/usr/bin/env Rscript
# ============================================================================
#  Run the whole pipeline
#  counts -> differential expression -> gene symbols -> figures
# ----------------------------------------------------------------------------
#  Edit config.R, then:
#
#      Rscript run_pipeline.R
#
#  Each step is also a script you can run on its own:
#
#      Rscript 02_deseq2.R
#
#  which is what you want when you are only changing a threshold or a colour
#  and do not want to download anything again.
# ============================================================================

steps <- c(
  "01_download_counts.R",
  "02_deseq2.R",
  "03_annotate.R",
  "04_figures.R"
)

missing <- steps[!file.exists(steps)]
if (length(missing) > 0) {
  stop("Missing step script(s): ", paste(missing, collapse = ", "), "\n",
       "  Run this from the folder that holds them.", call. = FALSE)
}

if (!file.exists("config.R")) {
  stop("config.R is missing. It holds every setting the pipeline needs.",
       call. = FALSE)
}

started <- Sys.time()

for (step in steps) {
  step_started <- Sys.time()

  # A separate R process per step, on purpose. One step cannot then leave a
  # stale variable behind that quietly changes how the next one behaves, and
  # a failure stops the run rather than cascading into confusing errors
  # further down.
  status <- system2(file.path(R.home("bin"), "Rscript"), shQuote(step))

  if (status != 0) {
    stop("\n", step, " failed (exit status ", status, ").\n",
         "  Fix the problem, then re-run that script on its own or start ",
         "run_pipeline.R again -- finished steps are cheap to repeat.",
         call. = FALSE)
  }

  elapsed <- round(as.numeric(difftime(Sys.time(), step_started, units = "secs")))
  message("  (", step, " took ", elapsed, "s)")
}

total <- round(as.numeric(difftime(Sys.time(), started, units = "mins")), 1)

message("\n", strrep("=", 74))
message("  Pipeline finished in ", total, " minute(s).")
message("  Results are under results/ -- figures in results/03_figures/")
message(strrep("=", 74))
