import "@testing-library/jest-dom";

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
