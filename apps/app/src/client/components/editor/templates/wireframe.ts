import type { Editor } from "@tldraw/tldraw";
import { toRichText } from "@tldraw/tlschema";
import type { DrawingTemplate } from "./index";

export const wireframeTemplate: DrawingTemplate = {
  id: "wireframe",
  name: "Wireframe",
  description: "Mobile app wireframe layout",
  icon: "Smartphone",
  apply: (editor: Editor) => {
    editor.run(
      () => {
        const phoneX = 300;
        const phoneY = 80;
        const phoneW = 375;
        const phoneH = 720;

        // Phone frame
        editor.createShape({
          type: "geo",
          x: phoneX,
          y: phoneY,
          props: {
            geo: "rectangle",
            w: phoneW,
            h: phoneH,
            fill: "none",
            color: "black",
            richText: toRichText(""),
            dash: "solid",
          },
        });

        // Status bar
        editor.createShape({
          type: "geo",
          x: phoneX,
          y: phoneY,
          props: {
            geo: "rectangle",
            w: phoneW,
            h: 44,
            fill: "solid",
            color: "grey",
            richText: toRichText("9:41"),
            font: "sans",
            size: "s",
            align: "middle",
            verticalAlign: "middle",
          },
        });

        // App header / nav bar
        editor.createShape({
          type: "geo",
          x: phoneX,
          y: phoneY + 44,
          props: {
            geo: "rectangle",
            w: phoneW,
            h: 56,
            fill: "solid",
            color: "blue",
            richText: toRichText("My App"),
            font: "sans",
            size: "m",
            align: "middle",
            verticalAlign: "middle",
          },
        });

        // Content area - hero image placeholder
        editor.createShape({
          type: "geo",
          x: phoneX + 16,
          y: phoneY + 120,
          props: {
            geo: "rectangle",
            w: phoneW - 32,
            h: 180,
            fill: "semi",
            color: "light-violet",
            richText: toRichText("Hero Image"),
            font: "sans",
            size: "s",
            align: "middle",
            verticalAlign: "middle",
            dash: "dashed",
          },
        });

        // Title text
        editor.createShape({
          type: "text",
          x: phoneX + 16,
          y: phoneY + 320,
          props: {
            richText: toRichText("Welcome Back!"),
            font: "sans",
            size: "l",
          },
        });

        // Subtitle
        editor.createShape({
          type: "text",
          x: phoneX + 16,
          y: phoneY + 360,
          props: {
            richText: toRichText("Here is your daily summary"),
            font: "sans",
            size: "s",
            color: "grey",
          },
        });

        // Card 1
        editor.createShape({
          type: "geo",
          x: phoneX + 16,
          y: phoneY + 400,
          props: {
            geo: "rectangle",
            w: phoneW - 32,
            h: 80,
            fill: "semi",
            color: "light-blue",
            richText: toRichText("Card: Active Tasks (5)"),
            font: "sans",
            size: "s",
            align: "middle",
            verticalAlign: "middle",
          },
        });

        // Card 2
        editor.createShape({
          type: "geo",
          x: phoneX + 16,
          y: phoneY + 496,
          props: {
            geo: "rectangle",
            w: phoneW - 32,
            h: 80,
            fill: "semi",
            color: "light-green",
            richText: toRichText("Card: Completed (12)"),
            font: "sans",
            size: "s",
            align: "middle",
            verticalAlign: "middle",
          },
        });

        // Bottom tab bar
        editor.createShape({
          type: "geo",
          x: phoneX,
          y: phoneY + phoneH - 60,
          props: {
            geo: "rectangle",
            w: phoneW,
            h: 60,
            fill: "solid",
            color: "grey",
            richText: toRichText("Home    Tasks    Profile"),
            font: "sans",
            size: "s",
            align: "middle",
            verticalAlign: "middle",
          },
        });

        editor.zoomToFit({ animation: { duration: 400 } });
      },
      { history: "record" },
    );
  },
};
