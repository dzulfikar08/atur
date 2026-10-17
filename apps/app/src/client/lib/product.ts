// The product an issue belongs to lives in its title prefix ("JoyoFit: …",
// "[Threads] …"). Derive it once so rows can show a chip and drop the prefix.
const PREFIX = /^\s*(?:\[([^\]]{1,24})\]|([^:\s]{1,24}):)\s*/;

export function splitProduct(name: string): {
  product: string | null;
  title: string;
} {
  const m = PREFIX.exec(name);
  if (!m) return { product: null, title: name };
  const title = name.slice(m[0].length);
  // A bare "Prefix:" with nothing after it is a title, not a product tag.
  if (!title) return { product: null, title: name };
  return { product: m[1] ?? m[2] ?? null, title };
}

const PRODUCT_COLORS: Record<string, string> = {
  joyorogo: "var(--state-started)",
  joyofit: "var(--state-completed)",
  both: "var(--state-unstarted)",
  threads: "var(--state-needs-you)",
};

/** CSS color (a design-token var) for the product chip's --badge-c. */
export function productColor(product: string): string {
  return PRODUCT_COLORS[product.toLowerCase()] ?? "var(--state-backlog)";
}
