/**
 * Everything interactive on the site. Bundled by esbuild into one small file.
 *
 * All of it is progressive enhancement: the banner shows its first image, the
 * nav links work, and the gallery shows its thumbnails with this script absent.
 */

const THEME_KEY = "crp7-theme";

/* ------------------------------------------------------------------ Theme */

function setupTheme(): void {
  const button = document.querySelector<HTMLButtonElement>("[data-theme-toggle]");
  if (!button) return;

  const root = document.documentElement;
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  const current = (): "light" | "dark" => {
    const explicit = root.getAttribute("data-theme");
    if (explicit === "light" || explicit === "dark") return explicit;
    return media.matches ? "dark" : "light";
  };

  const announce = () => {
    const next = current() === "dark" ? "light" : "dark";
    button.setAttribute("aria-label", `Switch to ${next} theme`);
    button.setAttribute("title", `Switch to ${next} theme`);
  };

  button.addEventListener("click", () => {
    const next = current() === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* Private browsing blocks storage; the choice just will not persist. */
    }
    announce();
  });

  // Follow the system while the reader has not made an explicit choice.
  media.addEventListener("change", () => {
    if (!root.hasAttribute("data-theme")) announce();
  });

  announce();
}

/* -------------------------------------------------------------- Mobile nav */

function setupNav(): void {
  const toggle = document.querySelector<HTMLButtonElement>("[data-nav-toggle]");
  const nav = document.querySelector<HTMLElement>("[data-nav]");
  if (!toggle || !nav) return;

  const setOpen = (open: boolean) => {
    nav.dataset.open = String(open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  };

  toggle.addEventListener("click", () => setOpen(nav.dataset.open !== "true"));

  nav.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("a")) setOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && nav.dataset.open === "true") {
      setOpen(false);
      toggle.focus();
    }
  });

  document.addEventListener("click", (event) => {
    if (nav.dataset.open !== "true") return;
    const target = event.target as Node;
    if (!nav.contains(target) && !toggle.contains(target)) setOpen(false);
  });

  // Leaving the mobile breakpoint must not strand the drawer open.
  window.matchMedia("(min-width: 861px)").addEventListener("change", (event) => {
    if (event.matches) setOpen(false);
  });

  setOpen(false);
}

/* --------------------------------------------------------------- Carousel */

/**
 * How long each image is held, taken from the `--carousel-hold` token.
 *
 * The dot progress bar is a CSS animation of the same duration. Reading the
 * token here rather than hard-coding 6000 is what stops the bar and the advance
 * drifting apart the moment somebody retunes the timing in tokens.css.
 */
function carouselHold(): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--carousel-hold")
    .trim();
  const value = parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) return 6000;
  return raw.endsWith("ms") ? value : value * 1000;
}

function setupCarousel(): void {
  const media = document.querySelector<HTMLElement>("[data-carousel]");
  if (!media) return;

  const slides = [...media.querySelectorAll<HTMLElement>("[data-slide]")];
  if (slides.length < 2) return; // One image is a banner, not a carousel.

  const dots = [...document.querySelectorAll<HTMLButtonElement>("[data-dot]")];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const hold = carouselHold();
  let index = 0;
  let timer: number | undefined;

  const show = (next: number) => {
    index = (next + slides.length) % slides.length;
    slides.forEach((slide, i) => {
      slide.dataset.active = String(i === index);
      slide.setAttribute("aria-hidden", String(i !== index));
    });
    dots.forEach((dot, i) => {
      dot.setAttribute("aria-current", String(i === index));
    });
  };

  const root = media.closest<HTMLElement>(".banner") ?? media;

  const stop = () => {
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
    // Freezes the drift on the image and the fill on the dot along with it.
    root.dataset.paused = "true";
  };

  const start = () => {
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
    root.dataset.paused = "false";
    if (reduceMotion.matches) return;
    timer = window.setInterval(() => show(index + 1), hold);
  };

  // Hand control to `data-active` now that the script is running.
  media.dataset.ready = "true";
  // Lets the dots start counting down; without JS they stay plain markers.
  root.dataset.carouselReady = "true";
  show(0);
  start();

  root.addEventListener("mouseenter", stop);
  root.addEventListener("mouseleave", start);
  root.addEventListener("focusin", stop);
  root.addEventListener("focusout", start);
  reduceMotion.addEventListener("change", start);

  document.querySelector("[data-carousel-prev]")?.addEventListener("click", () => {
    show(index - 1);
    start();
  });
  document.querySelector("[data-carousel-next]")?.addEventListener("click", () => {
    show(index + 1);
    start();
  });
  dots.forEach((dot, i) =>
    dot.addEventListener("click", () => {
      show(i);
      start();
    }),
  );

  const controls = document.querySelector<HTMLElement>("[data-carousel-controls]");
  controls?.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      show(index - 1);
      start();
    }
    if (event.key === "ArrowRight") {
      show(index + 1);
      start();
    }
  });

  // Swipe, which is how most people will meet this on a phone.
  let startX = 0;
  root.addEventListener(
    "touchstart",
    (event) => {
      startX = (event as TouchEvent).changedTouches[0]?.clientX ?? 0;
      stop();
    },
    { passive: true },
  );
  root.addEventListener(
    "touchend",
    (event) => {
      const endX = (event as TouchEvent).changedTouches[0]?.clientX ?? 0;
      const delta = endX - startX;
      if (Math.abs(delta) > 40) show(index + (delta < 0 ? 1 : -1));
      start();
    },
    { passive: true },
  );
}

/* --------------------------------------------------------------- Lightbox */

type Shot = { src: string; caption: string };

function setupLightbox(): void {
  const items = [...document.querySelectorAll<HTMLButtonElement>("[data-lightbox]")];
  if (items.length === 0) return;

  /**
   * Photos grouped by the grid they sit in.
   *
   * Each album is its own group, so arrowing out of the last photo of the
   * Christmas album wraps back to its first rather than landing in a
   * conference nobody asked to see. A page with one flat grid has one group,
   * which behaves exactly as it did before albums existed.
   */
  const groups = new Map<Element, Shot[]>();
  const openings = items.map((item) => {
    const key = item.closest("[data-lightbox-group]") ?? document.body;
    let shots = groups.get(key);
    if (!shots) {
      shots = [];
      groups.set(key, shots);
    }
    shots.push({ src: item.dataset.full ?? "", caption: item.dataset.caption ?? "" });
    return { shots, index: shots.length - 1 };
  });

  const dialog = document.createElement("dialog");
  dialog.className = "lightbox";
  dialog.innerHTML = `
    <div class="lightbox__inner">
      <img alt="">
      <p class="lightbox__caption"></p>
      <button class="lightbox__close" type="button" aria-label="Close">✕</button>
      <button class="lightbox__nav lightbox__nav--prev" type="button" aria-label="Previous image">‹</button>
      <button class="lightbox__nav lightbox__nav--next" type="button" aria-label="Next image">›</button>
    </div>`;
  document.body.append(dialog);

  const image = dialog.querySelector("img")!;
  const caption = dialog.querySelector<HTMLElement>(".lightbox__caption")!;
  const navs = [...dialog.querySelectorAll<HTMLButtonElement>(".lightbox__nav")];
  let shots: Shot[] = openings[0]!.shots;
  let index = 0;

  const show = (next: number) => {
    index = (next + shots.length) % shots.length;
    const shot = shots[index]!;
    image.src = shot.src;
    image.alt = shot.caption;
    caption.textContent = shot.caption;
    caption.hidden = !shot.caption;
    // A single photo has nowhere to go; arrows there are a false promise.
    navs.forEach((nav) => (nav.hidden = shots.length < 2));
  };

  items.forEach((item, i) =>
    item.addEventListener("click", () => {
      const opening = openings[i]!;
      shots = opening.shots;
      show(opening.index);
      dialog.showModal();
    }),
  );

  dialog.querySelector(".lightbox__close")?.addEventListener("click", () => dialog.close());
  dialog.querySelector(".lightbox__nav--prev")?.addEventListener("click", () => show(index - 1));
  dialog.querySelector(".lightbox__nav--next")?.addEventListener("click", () => show(index + 1));

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") show(index - 1);
    if (event.key === "ArrowRight") show(index + 1);
  });

  // Clicking the backdrop closes; clicking the image itself must not.
  dialog.addEventListener("click", (event) => {
    if (!(event.target as HTMLElement).closest("img, button")) dialog.close();
  });
}

/* ---------------------------------------------------------- Scroll reveal */

/**
 * Reveals `data-reveal` blocks as they are scrolled to.
 *
 * Only ever *adds* the visible class. The hidden state comes from CSS gated on
 * `data-motion`, which the inline head script sets and, if this file never
 * arrives, takes back again — so a failure here leaves the page fully readable
 * rather than blank.
 */
function setupReveal(): void {
  if (document.documentElement.dataset.motion !== "on") return;

  const targets = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
  if (targets.length === 0) return;

  const revealAll = () => targets.forEach((target) => target.classList.add("is-visible"));

  if (!("IntersectionObserver" in window)) {
    revealAll();
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target); // Reveal once; this is not a toggle.
      }
    },
    // Fires a little before the block reaches the bottom edge, so the movement
    // has finished by the time the reader's eye gets there.
    { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
  );

  targets.forEach((target) => observer.observe(target));
}

/* -------------------------------------------------- Header and scroll bar */

function setupScroll(): void {
  const header = document.querySelector<HTMLElement>(".site-header");
  if (!header) return;

  const bar = document.createElement("div");
  bar.className = "scroll-progress";
  header.append(bar);

  let queued = false;

  const update = () => {
    queued = false;
    const y = window.scrollY;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    header.dataset.scrolled = String(y > 8);
    header.style.setProperty("--scroll-progress", max > 0 ? String(Math.min(y / max, 1)) : "0");
  };

  // Coalesced into one read per frame; scroll fires far more often than that.
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  update();
}

/* ------------------------------------------------------- Copy a code block */

/**
 * Copy the code above the button.
 *
 * Progressive, like everything else here: the button is only ever a
 * convenience — the code is on the page to be read and selected, and the file
 * itself is a download away — so a browser that refuses the clipboard just
 * leaves the button saying "Copy".
 */
function setupCopy(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
    button.addEventListener("click", async () => {
      const code = button.closest(".code-block")?.querySelector("code")?.textContent ?? "";
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
      } catch {
        return;
      }
      button.dataset.copied = "true";
      window.setTimeout(() => delete button.dataset.copied, 2000);
    });
  }
}

/* ------------------------------------------------------------------ Boot */

function boot(): void {
  // Tells the head script's failsafe that this file made it, so it leaves the
  // reveal animations switched on.
  document.documentElement.dataset.booted = "true";

  setupTheme();
  setupNav();
  setupCarousel();
  setupLightbox();
  setupReveal();
  setupScroll();
  setupCopy();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
