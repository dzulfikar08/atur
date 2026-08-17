import type { Editor } from "@tldraw/tldraw";
import { toRichText } from "@tldraw/tlschema";
import type { DrawingTemplate } from "./index";

export const flowchartTemplate: DrawingTemplate = {
  id: "flowchart",
  name: "Flowchart",
  description: "Basic flowchart shapes connected",
  icon: "GitBranch",
  apply: (editor: Editor) => {
    editor.run(
      () => {
        const cx = 600;
        const start = 80;

        // Start oval
        editor.createShape({
          type: "geo",
          x: cx - 90,
          y: start,
          props: {
            geo: "ellipse",
            w: 180,
            h: 60,
            fill: "solid",
            color: "green",
            richText: toRichText("Start"),
            font: "sans",
            size: "m",
            align: "middle",
            verticalAlign: "middle",
          },
        });

        // Process 1
        editor.createShape({
          type: "geo",
          x: cx - 110,
          y: 200,
          props: {
            geo: "rectangle",
            w: 220,
            h: 80,
            fill: "solid",
            color: "blue",
            richText: toRichText("Process Data"),
            font: "sans",
            size: "m",
            align: "middle",
            verticalAlign: "middle",
          },
        });

        // Decision diamond
        editor.createShape({
          type: "geo",
          x: cx - 100,
          y: 360,
          props: {
            geo: "diamond",
            w: 200,
            h: 160,
            fill: "solid",
            color: "yellow",
            richText: toRichText("Valid?"),
            font: "sans",
            size: "m",
            align: "middle",
            verticalAlign: "middle",
          },
        });

        // Yes branch — Success
        editor.createShape({
          type: "geo",
          x: cx - 90,
          y: 600,
          props: {
            geo: "rectangle",
            w: 180,
            h: 80,
            fill: "solid",
            color: "blue",
            richText: toRichText("Save Result"),
            font: "sans",
            size: "m",
            align: "middle",
            verticalAlign: "middle",
          },
        });

        // No branch — Error handling
        editor.createShape({
          type: "geo",
          x: cx + 250,
          y: 380,
          props: {
            geo: "rectangle",
            w: 200,
            h: 80,
            fill: "solid",
            color: "red",
            richText: toRichText("Handle Error"),
            font: "sans",
            size: "m",
            align: "middle",
            verticalAlign: "middle",
          },
        });

        // End oval
        editor.createShape({
          type: "geo",
          x: cx - 90,
          y: 760,
          props: {
            geo: "ellipse",
            w: 180,
            h: 60,
            fill: "solid",
            color: "grey",
            richText: toRichText("End"),
            font: "sans",
            size: "m",
            align: "middle",
            verticalAlign: "middle",
          },
        });

        // Arrows — start/end are VecModel { x, y }
        // Start -> Process
        editor.createShape({
          type: "arrow",
          x: 0,
          y: 0,
          props: {
            start: { x: cx, y: start + 60 },
            end: { x: cx, y: 200 },
          },
        });

        // Process -> Decision
        editor.createShape({
          type: "arrow",
          x: 0,
          y: 0,
          props: {
            start: { x: cx, y: 280 },
            end: { x: cx, y: 360 },
          },
        });

        // Decision (Yes) -> Save
        editor.createShape({
          type: "arrow",
          x: 0,
          y: 0,
          props: {
            start: { x: cx, y: 520 },
            end: { x: cx, y: 600 },
          },
        });

        // Yes label
        editor.createShape({
          type: "text",
          x: cx + 15,
          y: 535,
          props: {
            richText: toRichText("Yes"),
            font: "sans",
            size: "s",
            color: "green",
          },
        });

        // Decision (No) -> Handle Error
        editor.createShape({
          type: "arrow",
          x: 0,
          y: 0,
          props: {
            start: { x: cx + 100, y: 440 },
            end: { x: cx + 250, y: 420 },
          },
        });

        // No label
        editor.createShape({
          type: "text",
          x: cx + 160,
          y: 400,
          props: {
            richText: toRichText("No"),
            font: "sans",
            size: "s",
            color: "red",
          },
        });

        // Handle Error -> back to Process (loop)
        editor.createShape({
          type: "arrow",
          x: 0,
          y: 0,
          props: {
            start: { x: cx + 350, y: 380 },
            end: { x: cx + 140, y: 240 },
          },
        });

        // Save -> End
        editor.createShape({
          type: "arrow",
          x: 0,
          y: 0,
          props: {
            start: { x: cx, y: 680 },
            end: { x: cx, y: 760 },
          },
        });

        editor.zoomToFit({ animation: { duration: 400 } });
      },
      { history: "record" },
    );
  },
};
