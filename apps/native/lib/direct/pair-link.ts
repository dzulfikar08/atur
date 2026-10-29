// Routing for the pairing link `atur-term mobile pair` prints. The core parses the link (hosts,
// port, fingerprint, secret); nothing here reads those. Only the wrapper is looked at: whether a
// URL opened by the OS, or text pasted by the user, is a pairing link, and where to send it.

/** `atur://pair?...` or the router's `/pair?...`, with an optional trailing slash and fragment. */
const PAIR_URL = /^(?:atur:\/\/\/?|\/)pair\/?(?:\?([^#]*))?(?:#.*)?$/i;

/** The link inside a `link=<encoded>` routing wrapper, or null when the query is not a wrapper. */
function wrappedLink(query: string): string | null {
  const match = /(?:^|&)link=([^&]*)/.exec(query);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1] ?? "");
  } catch {
    return null;
  }
}

/**
 * The in-app route for a URL that opens a pairing link: `/pair?link=<the whole link, encoded>`, or
 * null when the URL is something else. A path without the scheme (`/pair?v=1&...`, as the router
 * may hand it over) is rebuilt as `atur://pair?...`; a URL that already carries `link=` (our own
 * route) keeps its link as it is.
 */
export function pairRouteFor(url: string): string | null {
  const match = PAIR_URL.exec(url.trim());
  if (!match) return null;
  const query = match[1] ?? "";
  const link = wrappedLink(query) ?? `atur://pair${query ? `?${query}` : ""}`;
  return `/pair?link=${encodeURIComponent(link)}`;
}

/**
 * What to hand the core when the user pastes or scans text: the text itself, or the link inside a
 * `.../pair?link=<encoded>` wrapper. The legacy pairing link (its own scheme) passes through: the
 * core accepts it.
 */
export function pairingLinkOf(text: string): string {
  const trimmed = text.trim();
  const route = PAIR_URL.exec(trimmed);
  const inner = route ? wrappedLink(route[1] ?? "") : null;
  return inner ?? trimmed;
}
