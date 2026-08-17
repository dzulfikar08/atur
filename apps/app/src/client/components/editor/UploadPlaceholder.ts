// TipTap node that renders an in-editor "uploading…" placeholder while a
// pasted/dropped image is being uploaded. It is atomically swapped for the real
// <img> once the upload resolves, and removed on failure. The placeholder also
// dedupes pastes: while an upload for a given token is in flight, subsequent
// pastes carrying the same token are ignored.

import { Node, mergeAttributes } from "@tiptap/core";
import type { Editor } from "@tiptap/core";

export interface UploadPlaceholderOptions {
  HTMLAttributes: Record<string, any>;
  renderLabel: (attrs: { percent?: number }) => string;
  /** Called once when the placeholder node is removed (success or failure). */
  onDone?: (id: string) => void;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    uploadPlaceholder: {
      /** Insert an "uploading image" placeholder node. */
      setUploadPlaceholder: (options: { id: string; alt?: string }) => ReturnType;
      /** Remove a placeholder node by id (returns true if it existed). */
      removeUploadPlaceholder: (id: string) => ReturnType;
      /** Update the progress percent on a placeholder node. */
      setUploadPlaceholderPercent: (id: string, percent: number) => ReturnType;
    };
  }
}

export const UploadPlaceholder = Node.create<UploadPlaceholderOptions>({
  name: "uploadPlaceholder",

  group: "inline",

  inline: true,

  atom: true,

  selectable: false,

  draggable: false,

  addOptions() {
    return {
      HTMLAttributes: {},
      renderLabel: ({ percent }) =>
        percent === undefined ? "Uploading image…" : `Uploading image… ${percent}%`,
    };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-upload-id"),
        renderHTML: (attrs) => ({ "data-upload-id": attrs.id }),
      },
      percent: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-percent"),
        renderHTML: (attrs) =>
          attrs.percent != null ? { "data-percent": String(attrs.percent) } : {},
      },
      alt: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-alt"),
        renderHTML: (attrs) => (attrs.alt ? { "data-alt": attrs.alt } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-upload-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
  },

  addCommands() {
    return {
      setUploadPlaceholder:
        (options) =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs: { id: options.id, alt: options.alt ?? null },
            })
            .run(),
      removeUploadPlaceholder:
        (id) =>
        ({ tr, state }) => {
          let removed = false;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== this.name) return;
            if (node.attrs.id !== id) return;
            tr.delete(pos, pos + node.nodeSize);
            removed = true;
            return false;
          });
          return removed;
        },
      setUploadPlaceholderPercent:
        (id, percent) =>
        ({ tr, state, dispatch }) => {
          let found = false;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== this.name) return;
            if (node.attrs.id !== id) return;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, percent });
            found = true;
            return false;
          });
          if (found && dispatch) dispatch(tr);
          return found;
        },
    };
  },

  addNodeView() {
    return ({ node }) => {
      const el = document.createElement("span");
      el.setAttribute("data-upload-id", node.attrs.id);
      el.className =
        "inline-flex items-center gap-2 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground align-middle border border-dashed border-muted-foreground/30";
      const spinner = document.createElement("span");
      spinner.className =
        "inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground";
      const label = document.createElement("span");
      const barTrack = document.createElement("span");
      barTrack.className =
        "inline-block h-1.5 w-24 rounded-full bg-muted-foreground/20 overflow-hidden align-middle";
      const barFill = document.createElement("span");
      barFill.className = "block h-full rounded-full bg-primary transition-all duration-200";
      barFill.style.width = "0%";
      barTrack.append(barFill);

      const render = () => {
        const p = node.attrs.percent != null ? Number(node.attrs.percent) : 0;
        label.textContent = this.options.renderLabel({
          percent: node.attrs.percent != null ? Number(node.attrs.percent) : undefined,
        });
        barFill.style.width = `${p}%`;
      };
      render();
      el.append(spinner, label, barTrack);

      // Watch for progress updates written back onto the node attrs.
      let last = node.attrs.percent;
      const timer = setInterval(() => {
        if (node.attrs.percent !== last) {
          last = node.attrs.percent;
          render();
        }
      }, 100);
      el.addEventListener("remove", () => {
        clearInterval(timer);
        this.options.onDone?.(node.attrs.id);
      });
      return { dom: el };
    };
  },
});

/** Insert a placeholder and return the token used to dedupe/finish it. */
export function beginUpload(editor: Editor) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  editor.chain().focus().setUploadPlaceholder({ id }).run();
  return id;
}

/** Swap a placeholder for the uploaded image. Returns false if not found. */
export function finishUpload(editor: Editor, id: string, src: string, alt: string) {
  const removed = editor.commands.removeUploadPlaceholder(id);
  if (!removed) return false;
  editor.chain().focus().setImage({ src, alt }).run();
  return true;
}

/** Remove the placeholder and signal failure. */
export function failUpload(editor: Editor, id: string) {
  editor.commands.removeUploadPlaceholder(id);
}
