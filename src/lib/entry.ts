/**
 * Shapes and rules shared by the server and the browser.
 * Keep this module free of node: imports — client components read from it.
 */

export const MIN_MASTER_PASSWORD_LENGTH = 8;

/**
 * Only the NAME is ever stored. The stylesheet owns the actual color values,
 * so nothing a user types can reach the render path.
 *
 * Ordered around the color wheel, warm through cool, with the two neutrals
 * last — a spectrum is faster to pick from than an arbitrary list.
 * NEVER rename or remove an entry here: stored rows reference these names.
 */
export const ENTRY_COLORS = [
  "default",
  "crimson",
  "rose",
  "orchid",
  "plum",
  "indigo",
  "sky",
  "teal",
  "fern",
  "moss",
  "olive",
  "amber",
  "rust",
  "cocoa",
  "slate",
] as const;

export type EntryColor = (typeof ENTRY_COLORS)[number];

export const DEFAULT_COLOR: EntryColor = "default";

export type EntryInput = {
  app: string;
  username: string;
  url: string;
  password: string;
  comment: string;
  favorite: boolean;
  color: EntryColor;
};

export type Entry = EntryInput & {
  id: number;
  createdAt: string;
  updatedAt: string;
};

function isEntryColor(value: string): value is EntryColor {
  return (ENTRY_COLORS as readonly string[]).includes(value);
}

/** Validates a submitted color. Strict: an unknown name is a bug or tampering. */
export function normalizeColor(input: string): EntryColor {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_COLOR;

  if (!isEntryColor(trimmed)) {
    throw new Error(`"${trimmed}" is not one of the available colors`);
  }

  return trimmed;
}

/** Reads a stored color. Forgiving: an old or unknown value still renders. */
export function readColor(stored: string | null): EntryColor {
  if (!stored || !isEntryColor(stored)) return DEFAULT_COLOR;

  return stored;
}

const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:"]);

const SCHEME_WITH_SLASHES = /^[a-z][a-z0-9+.-]*:\/\//i;
const BARE_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** A colon followed by digits is a port — "localhost:3000" is a host, not a scheme. */
const HOST_WITH_PORT = /^[^:/?#\s]+:\d+(?=$|[/?#])/;

function hasScheme(value: string): boolean {
  if (SCHEME_WITH_SLASHES.test(value)) return true;

  return BARE_SCHEME.test(value) && !HOST_WITH_PORT.test(value);
}

/**
 * Normalizes a site address for storage. A bare host gets https, and anything
 * that is not http(s) is refused — the value ends up in an href, so a
 * `javascript:` or `data:` scheme would be stored XSS waiting for a click.
 */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  const candidate = hasScheme(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`"${trimmed}" is not a valid URL`);
  }

  if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol)) {
    throw new Error("URL must start with http:// or https://");
  }

  return candidate;
}
