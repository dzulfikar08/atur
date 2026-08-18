import { Extension, Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

// --- Mention node ---
// Stored in the document as:
//   <span data-mention-id="<uuid>" data-mention-username="alice">@alice</span>
// The server reads data-mention-id from the saved HTML to resolve who was
// mentioned; the username attribute is a human-readable fallback.

export interface MentionMember {
  id: string;
  username: string;
  display_name?: string | null;
  email?: string | null;
  avatar?: string | null;
}

function MentionComponent({ node }: NodeViewProps) {
  const attrs = (node.attrs as { id?: string; username?: string }).id
    ? (node.attrs as { id: string; username?: string })
    : null;
  const username = attrs?.username || "unknown";
  return (
    <NodeViewWrapper as="span" contentEditable={false} className="mention-chip">
      @{username}
    </NodeViewWrapper>
  );
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mention: {
      setMention: (attrs: { id: string; username: string }) => ReturnType;
    };
  }
}

export const MentionNode = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      id: { default: null },
      username: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-mention-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    const { id, username } = HTMLAttributes as { id?: string; username?: string };
    return [
      "span",
      mergeAttributes(
        { "data-mention-id": id, "data-mention-username": username },
        { class: "mention-chip" },
      ),
      `@${username || ""}`,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MentionComponent);
  },

  addCommands() {
    return {
      setMention:
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

// --- Suggestion popup ---

export interface MentionMenuRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface MentionMenuProps {
  items: MentionMember[];
  command: (item: MentionMember) => void;
}

export const MentionMenu = forwardRef<MentionMenuRef, MentionMenuProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const menuRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useEffect(() => {
      const menu = menuRef.current;
      if (menu) {
        const selected = menu.children[selectedIndex] as HTMLElement;
        selected?.scrollIntoView({ block: "nearest" });
      }
    }, [selectedIndex]);

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === "ArrowUp") {
          setSelectedIndex((prev) => (prev + items.length - 1) % items.length);
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((prev) => (prev + 1) % items.length);
          return true;
        }
        if (event.key === "Enter") {
          const item = items[selectedIndex];
          if (item) command(item);
          return true;
        }
        if (event.key === "Escape") {
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="slash-command-menu">
          <div className="slash-command-empty">No members found</div>
        </div>
      );
    }

    return (
      <div className="slash-command-menu" ref={menuRef}>
        {items.map((item, index) => (
          <button
            key={item.id}
            className={`slash-command-item ${index === selectedIndex ? "is-selected" : ""}`}
            onClick={() => command(item)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <span className="slash-command-icon" style={{ fontSize: "0.7em" }}>
              {item.avatar ? (
                <img
                  src={item.avatar}
                  alt=""
                  className="h-full w-full object-cover rounded-[6px]"
                />
              ) : (
                (item.display_name || item.username || "?").charAt(0).toUpperCase()
              )}
            </span>
            <span className="slash-command-text">
              <span className="slash-command-title">@{item.username}</span>
              <span className="slash-command-desc">{item.display_name || item.email || ""}</span>
            </span>
          </button>
        ))}
      </div>
    );
  },
);

MentionMenu.displayName = "MentionMenu";

export interface MentionExtensionOptions {
  members: MentionMember[];
  suggestion: Partial<SuggestionOptions>;
}

export function createMentionSuggestion(members: MentionMember[]) {
  return {
    items: ({ query }: { query: string }) => {
      const q = query.toLowerCase();
      const list = members.filter((m) => {
        const hay = `${m.username} ${m.display_name || ""} ${m.email || ""}`.toLowerCase();
        return hay.includes(q);
      });
      return list.slice(0, 8);
    },
    command: ({ editor, range, props }: { editor: any; range: any; props: MentionMember }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "mention",
          attrs: { id: props.id, username: props.username },
        })
        .run();
    },
    allowSpaces: false,
    startOfLine: false,
    render: () => {
      let component: ReactRenderer<MentionMenuRef> | null = null;
      let popup: TippyInstance[] | null = null;

      return {
        onStart: (props: any) => {
          component = new ReactRenderer(MentionMenu, {
            props,
            editor: props.editor,
          });
          if (!props.clientRect) return;
          popup = tippy("body", {
            getReferenceClientRect: props.clientRect as () => DOMRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: "manual",
            placement: "bottom-start",
            theme: "slash-command",
            zIndex: 99999,
          });
        },
        onUpdate(props: any) {
          component?.updateProps(props);
          if (props.clientRect) {
            popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect });
          }
        },
        onKeyDown(props: any) {
          if (props.event.key === "Escape") {
            popup?.[0]?.hide();
            return true;
          }
          return component?.ref?.onKeyDown(props.event) ?? false;
        },
        onExit() {
          popup?.[0]?.destroy();
          component?.destroy();
          popup = null;
          component = null;
        },
      };
    },
  };
}

// The Suggestion plugin lives on an Extension, not on the node itself: without
// addProseMirrorPlugins() the "@" trigger is never registered and the picker
// never opens. Members are captured at editor creation. Returns both the
// mention node (so inserted mentions have a node type to resolve to) and the
// suggestion extension that opens the picker.
export function makeMentionExtension(members: MentionMember[]) {
  const suggestion = Extension.create<MentionExtensionOptions>({
    name: "mentionSuggestion",

    addOptions() {
      return {
        members,
        suggestion: {
          char: "@",
          command: ({
            editor,
            range,
            props,
          }: {
            editor: any;
            range: any;
            props: MentionMember;
          }) => {
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent({
                type: "mention",
                attrs: { id: props.id, username: props.username },
              })
              .run();
          },
        } as Partial<SuggestionOptions>,
      };
    },

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          ...this.options.suggestion,
          items: ({ query }: { query: string }) => {
            const q = query.toLowerCase();
            const list = this.options.members.filter((m) => {
              const hay = `${m.username} ${m.display_name || ""} ${m.email || ""}`.toLowerCase();
              return hay.includes(q);
            });
            return list.slice(0, 8);
          },
        }),
      ];
    },
  });

  return [MentionNode, suggestion];
}
