import type { Editor } from "@tldraw/tldraw";
import { toRichText } from "@tldraw/tlschema";
import type { DrawingTemplate } from "./index";

const milestoneColors = [
  "green" as const,
  "blue" as const,
  "violet" as const,
  "orange" as const,
  "red" as const,
  "green" as const,
];

export const timelineTemplate: DrawingTemplate = {
  id: "timeline",
  name: "Timeline",
  description: "Horizontal timeline with milestones",
  icon: "Calendar",
  apply: (editor: Editor) => {
    editor.run(
      () => {
        const lineY = 350;
        const startX = 100;
        const endX = 1400;
        const milestones = [
          { label: "Kickoff", date: "Jan 6" },
          { label: "Design Complete", date: "Jan 20" },
          { label: "Alpha Release", date: "Feb 3" },
          { label: "Beta Release", date: "Feb 17" },
          { label: "QA & Testing", date: "Mar 3" },
          { label: "Launch", date: "Mar 17" },
        ];

        // Title
        editor.createShape({
          type: "text",
          x: startX,
          y: 60,
          props: {
            richText: toRichText("Project Timeline"),
            font: "sans",
            size: "xl",
          },
        });

        // Horizontal line
        editor.createShape({
          type: "geo",
          x: startX,
          y: lineY - 3,
          props: {
            geo: "rectangle",
            w: endX - startX,
            h: 6,
            fill: "solid",
            color: "grey",
            richText: toRichText(""),
          },
        });

        // Arrow at end of line
        editor.createShape({
          type: "arrow",
          x: 0,
          y: 0,
          props: {
            start: { x: endX - 40, y: lineY },
            end: { x: endX + 30, y: lineY },
            color: "grey",
          },
        });

        milestones.forEach((ms, i) => {
          const x = startX + 60 + i * 200;
          const color = milestoneColors[i];

          // Milestone dot
          editor.createShape({
            type: "geo",
            x: x - 15,
            y: lineY - 15,
            props: {
              geo: "ellipse",
              w: 30,
              h: 30,
              fill: "solid",
              color,
              richText: toRichText(""),
            },
          });

          // Milestone label (above or below alternating)
          const above = i % 2 === 0;
          const labelY = above ? lineY - 120 : lineY + 40;

          // Connector line from dot to label
          editor.createShape({
            type: "arrow",
            x: 0,
            y: 0,
            props: {
              start: { x, y: above ? lineY - 15 : lineY + 15 },
              end: { x, y: above ? labelY + 70 : labelY },
              color,
              size: "s",
            },
          });

          // Label box
          editor.createShape({
            type: "geo",
            x: x - 70,
            y: labelY,
            props: {
              geo: "rectangle",
              w: 140,
              h: 70,
              fill: "semi",
              color,
              richText: toRichText(ms.label),
              font: "sans",
              size: "s",
              align: "middle",
              verticalAlign: "middle",
            },
          });

          // Date
          editor.createShape({
            type: "text",
            x: x - 35,
            y: above ? labelY - 25 : labelY + 75,
            props: {
              richText: toRichText(ms.date),
              font: "sans",
              size: "s",
              color: "grey",
            },
          });
        });

        editor.zoomToFit({ animation: { duration: 400 } });
      },
      { history: "record" },
    );
  },
};
