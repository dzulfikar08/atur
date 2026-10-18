import type { Palette } from "@/theme";

// The product an issue belongs to lives in its title prefix ("JoyoFit: …",
// "[Threads] …"). Mirrors apps/app/src/client/lib/product.ts.
const PREFIX = /^\s*(?:\[([^\]]{1,24})\]|([^:\s]{1,24}):)\s*/;

export function splitProduct(name: string): { product: string | null; title: string } {
  const m = PREFIX.exec(name);
  if (!m) return { product: null, title: name };
  const title = name.slice(m[0].length);
  // A bare "Prefix:" with nothing after it is a title, not a product tag.
  if (!title) return { product: null, title: name };
  return { product: m[1] ?? m[2] ?? null, title };
}

/** Chip colour for a product, from the shared state tokens. */
export function productColor(colors: Palette, product: string): string {
  switch (product.toLowerCase()) {
    case "joyorogo":
      return colors.started;
    case "joyofit":
      return colors.completed;
    case "both":
      return colors.unstarted;
    case "threads":
      return colors.needsYou;
    default:
      return colors.backlog;
  }
}
