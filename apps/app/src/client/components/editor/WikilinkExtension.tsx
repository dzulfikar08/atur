import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

function WikilinkComponent({ node }: NodeViewProps) {
  const pageName = (node.attrs as Record<string, string>).pageName || "";
  const pageId = (node.attrs as Record<string, string>).pageId || "";
  const slug = window.location.pathname.split("/")[1];

  return (
    <NodeViewWrapper as="span" className="inline">
      <a
        href={`/${slug}/pages/${pageId}`}
        onClick={(e) => {
          if (pageId) {
            e.preventDefault();
            window.history.pushState(null, "", `/${slug}/pages/${pageId}`);
            window.dispatchEvent(new PopStateEvent("popstate"));
          }
        }}
        className="text-primary underline decoration-primary/30 hover:decoration-primary cursor-pointer font-medium"
        contentEditable={false}
      >
        {pageName}
      </a>
    </NodeViewWrapper>
  );
}

export interface WikilinkOptions {
  HTMLAttributes: Record<string, any>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    wikilink: {
      setWikilink: (attrs: { pageName: string; pageId: string }) => ReturnType;
    };
  }
}

export const WikilinkExtension = Node.create<WikilinkOptions>({
  name: "wikilink",
  group: "inline",
  inline: true,
  atom: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      pageName: { default: "" },
      pageId: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-wikilink]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ "data-wikilink": "" }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(WikilinkComponent);
  },

  addCommands() {
    return {
      setWikilink:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs,
          });
        },
    };
  },
});
