import "@testing-library/jest-dom";

// Node ≥22 ships an experimental `localStorage` global that is undefined
// without `--localstorage-file`, and jsdom 29's window storage getter delegates
// to that same Node implementation — so under vitest `localStorage` resolves to
// undefined. The theme/ui stores read storage at module top level, which made
// their modules (and everything importing them) crash on load in tests.
//
// Fix, in order of preference: jsdom's real Storage instance (reachable only
// through its `_localStorage`/`_sessionStorage` internals — the public getter
// is the broken delegation), then an in-memory fallback. Keeping these as real
// `Storage` instances matters: tests spy on Storage.prototype methods.
function installStorage(key: "localStorage" | "sessionStorage") {
  if (typeof globalThis[key] !== "undefined") return;
  const jsdomInternal = (window as unknown as Record<string, Storage | undefined>)[`_${key}`];
  if (jsdomInternal) {
    Object.defineProperty(globalThis, key, {
      value: jsdomInternal,
      configurable: true,
      writable: true,
    });
    return;
  }
  const data = new Map<string, string>();
  const store: Storage = {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => (data.has(k) ? data.get(k)! : null),
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => {
      data.delete(k);
    },
    setItem: (k, v) => {
      data.set(k, String(v));
    },
  };
  Object.defineProperty(globalThis, key, { value: store, configurable: true, writable: true });
}
installStorage("localStorage");
installStorage("sessionStorage");

// jsdom lacks layout APIs ProseMirror depends on (scrollToSelection,
// coordsAtPos). Stub them so tiptap editors can mount and type under vitest.
if (typeof window !== "undefined") {
  (window.HTMLElement.prototype as any).scrollIntoView ??= () => {};

  if (!(window as any).getClientRectsPolyfilled) {
    (window as any).getClientRectsPolyfilled = true;
    const rect = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    });
    (window.Range.prototype as any).getBoundingClientRect ??= rect;
    (window.Range.prototype as any).getClientRects ??= () => [rect()];
    // ProseMirror resolves pointer positions through elementFromPoint; jsdom
    // doesn't implement it.
    document.elementFromPoint ??= () => null;
  }
}
