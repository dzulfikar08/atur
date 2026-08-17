import type { Editor } from "@tldraw/tldraw";
import type { DrawingTemplate } from "./index";

export const blankTemplate: DrawingTemplate = {
  id: "blank",
  name: "Blank",
  description: "Empty canvas",
  icon: "File",
  apply: (_editor: Editor) => {
    // Nothing to create — blank canvas
  },
};
