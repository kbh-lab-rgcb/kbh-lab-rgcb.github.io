/**
 * Inline SVG icons.
 *
 * Inline rather than a sprite or icon font so the page stays a single request
 * and the icons inherit `currentColor` in both themes.
 */

const svg = (body: string, extra = ""): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra ? ` ${extra}` : ""}>${body}</svg>`;

export const icons = {
  sun: svg(
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  ),
  moon: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>'),
  menu: svg('<path d="M3 6h18M3 12h18M3 18h18"/>'),
  close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  chevronLeft: svg('<path d="m15 18-6-6 6-6"/>'),
  chevronRight: svg('<path d="m9 18 6-6-6-6"/>'),
  arrowRight: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  external: svg('<path d="M15 3h6v6M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>'),
  mail: svg('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/>'),
  phone: svg(
    '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.4 1.8.6 2.8.8a2 2 0 0 1 1.7 2Z"/>',
  ),
  pin: svg('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>'),
  document: svg(
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M9 13h6M9 17h4"/>',
  ),
  users: svg(
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  ),
  flask: svg('<path d="M9 3h6M10 3v6L4.6 18a2 2 0 0 0 1.7 3h11.4a2 2 0 0 0 1.7-3L14 9V3"/><path d="M7 14h10"/>'),
  image: svg(
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  ),
  orcid: svg('<circle cx="12" cy="12" r="9"/><path d="M9 9v7M9 6.5v.01M13 16V9h2.2a3.5 3.5 0 0 1 0 7Z"/>'),
  scholar: svg('<path d="m12 3 10 5-10 5L2 8Z"/><path d="M6 10.5V15c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5"/>'),
  link: svg(
    '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7L11.8 5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12.2 19"/>',
  ),
  github: svg(
    '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9a3.4 3.4 0 0 0-1-2.6c3.1-.3 6.4-1.5 6.4-7A5.4 5.4 0 0 0 20 4.8a5 5 0 0 0-.1-3.7s-1.2-.4-4 1.5a13.4 13.4 0 0 0-7 0C6.1.7 4.9 1.1 4.9 1.1A5 5 0 0 0 4.8 4.8 5.4 5.4 0 0 0 3.3 8.6c0 5.5 3.3 6.7 6.4 7a3.4 3.4 0 0 0-.9 2.6V22"/>',
  ),
  linkedin: svg(
    '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6Z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>',
  ),
  download: svg('<path d="M12 3v12M7 11l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
  code: svg('<path d="m9 17-5-5 5-5M15 7l5 5-5 5"/>'),
  repo: svg(
    '<path d="M5 3h11a2 2 0 0 1 2 2v16H6a2 2 0 0 1-2-2V4a1 1 0 0 1 1-1Z"/><path d="M4 17.5A2 2 0 0 1 6 17h12"/><path d="M9 7h5"/>',
  ),
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  check: svg('<path d="m5 13 4 4L19 7"/>'),
  terminal: svg('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>'),
  x: svg('<path d="m3 3 8.7 11.6L3.5 21M21 3l-8.4 9.2M10 3H3l11 15h7L10 3Z"/>'),
} as const;

export type IconName = keyof typeof icons;

/** Icon used for a profile or citation link, defaulting to a generic chain. */
export function iconForLink(kind: string): string {
  const map: Record<string, IconName> = {
    orcid: "orcid",
    scholar: "scholar",
    researchgate: "document",
    pubmed: "document",
    pmid: "document",
    pmc: "document",
    doi: "link",
    url: "external",
    website: "external",
    github: "github",
    linkedin: "linkedin",
    twitter: "x",
    repo: "repo",
    code: "code",
    download: "download",
  };
  return icons[map[kind] ?? "link"];
}

/** Icon used in the nav for a page kind. */
export function iconForKind(kind: string): string {
  const map: Record<string, IconName> = {
    home: "flask",
    research: "flask",
    team: "users",
    alumni: "users",
    publications: "document",
    gallery: "image",
    contact: "mail",
    links: "external",
    resources: "code",
  };
  return icons[map[kind] ?? "arrowRight"];
}
