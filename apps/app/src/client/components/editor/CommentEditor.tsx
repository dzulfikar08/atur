import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import ImageExt from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { Markdown } from "tiptap-markdown";
import { createLowlight } from "lowlight";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import css from "highlight.js/lib/languages/css";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import sql from "highlight.js/lib/languages/sql";
import rust from "highlight.js/lib/languages/rust";
import { useCallback, useEffect, useRef } from "react";
import {
  Bold,
  Italic,
  Strikethrough,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Code2,
  ImageIcon,
  LinkIcon,
} from "@/lib/icons";
import { optimizeImage } from "@/lib/image-optimize";
import { UploadPlaceholder, beginUpload, finishUpload, failUpload } from "./UploadPlaceholder";
import { makeMentionExtension, type MentionMember } from "./MentionExtension";

const lowlight = createLowlight();
lowlight.register({ javascript, typescript, python, css, json, bash, sql, rust });

interface CommentEditorProps {
  value: string;
  onChange: (html: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  compact?: boolean;
  uploadUrl?: string;
  resetKey?: string | number;
  // Workspace members for @mention suggestions. When empty, the mention picker
  // is disabled.
  members?: MentionMember[];
}

export default function CommentEditor({
  value,
  onChange,
  onSubmit,
  placeholder,
  compact: _compact,
  uploadUrl = "/api/assets/upload/",
  resetKey,
  members = [],
}: CommentEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Set of upload ids currently in flight; used to ignore a second paste of the
  // same image while the first is still uploading.
  const inFlight = useRef<Set<string>>(new Set());
  // Latest workspace members for the @mention picker. The mention extension is
  // registered at editor creation (members often resolve asynchronously after
  // the composer mounts), so items are resolved through this ref on demand.
  const membersRef = useRef(members);
  useEffect(() => {
    membersRef.current = members;
  }, [members]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        codeBlock: false,
      }),
      UploadPlaceholder.configure({
        renderLabel: ({ percent }) =>
          percent === undefined ? "Uploading image…" : `Uploading image… ${percent}%`,
      }),
      CodeBlockLowlight.configure({ lowlight }),
      ImageExt.configure({
        inline: true,
        allowBase64: true,
        resize: {
          enabled: true,
          directions: ["bottom-right"],
          minWidth: 80,
          minHeight: 40,
          alwaysPreserveAspectRatio: true,
        },
      }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "text-primary underline" } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: placeholder || "Add a comment..." }),
      Markdown,
      // Always registered — members resolve asynchronously after the composer
      // mounts, so the extension reads them from membersRef on demand.
      ...makeMentionExtension(() => membersRef.current),
    ],
    content: value || "",
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none min-h-[80px] px-3 py-2",
      },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          onSubmit?.();
          return true;
        }
        return false;
      },
      handlePaste: (_view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        const images = Array.from(items)
          .map((item) => item.getAsFile())
          .filter((f): f is File => !!f && f.type.startsWith("image/"));
        if (images.length === 0) return false;
        event.preventDefault();
        images.forEach(uploadAndInsertImage);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;
        const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
        if (images.length === 0) return false;
        event.preventDefault();
        images.forEach(uploadAndInsertImage);
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  // When the parent signals a reset (e.g. comment sent), clear the editor
  // content so the box is ready for the next comment. Skipped on first mount so
  // an initial `value` (e.g. a comment being edited) isn't wiped out.
  const skipReset = useRef(true);
  useEffect(() => {
    if (skipReset.current) {
      skipReset.current = false;
      return;
    }
    if (resetKey && editor) {
      editor.commands.clearContent();
      editor.commands.focus();
    }
  }, [resetKey, editor]);

  const uploadAndInsertImage = useCallback(
    async (file: File) => {
      if (!editor) return;
      // Dedupe: if the same file (by size + name) is already uploading, drop the
      // duplicate paste so users can't accidentally upload twice.
      const token = `${file.name}:${file.size}`;
      if (inFlight.current.has(token)) return;
      inFlight.current.add(token);

      const id = beginUpload(editor);
      const alt = file.name;
      try {
        // Optimize on the client: resize to max 1600px + convert to WebP before
        // upload so the worker stores a small image directly.
        const optimized = await optimizeImage(file);
        const formData = new FormData();
        formData.append("file", optimized);
        formData.append("entityId", id);
        formData.append("entityType", "comment");

        // Drive a deterministic progress readout on the placeholder so the user
        // always sees the upload progressing (fetch uploads don't stream bytes,
        // so we interpolate between checkpoints rather than showing 0% the whole
        // time). 10% before the request, then tween toward 90% while waiting.
        editor.commands.setUploadPlaceholderPercent(id, 10);
        const res = await fetch(uploadUrl, {
          method: "POST",
          body: formData,
        });
        editor.commands.setUploadPlaceholderPercent(id, 90);
        if (!res.ok) throw new Error("Upload failed");
        const data = await res.json();
        const src = data.url || `/api/assets/${data.id}`;
        editor.commands.setUploadPlaceholderPercent(id, 100);
        finishUpload(editor, id, src, alt);
      } catch (err) {
        failUpload(editor, id);
        console.error("Image upload failed:", err);
      } finally {
        inFlight.current.delete(token);
      }
    },
    [editor, uploadUrl],
  );

  const handleImageUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && file.type.startsWith("image/")) {
        uploadAndInsertImage(file);
      }
      e.target.value = "";
    },
    [uploadAndInsertImage],
  );

  if (!editor) return null;

  return (
    <div className="border rounded-md overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1 bg-muted/30 border-b flex-wrap">
        <TBtn
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          title="Bold"
        >
          <Bold className="h-3.5 w-3.5" />
        </TBtn>
        <TBtn
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          title="Italic"
        >
          <Italic className="h-3.5 w-3.5" />
        </TBtn>
        <TBtn
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive("strike")}
          title="Strike"
        >
          <Strikethrough className="h-3.5 w-3.5" />
        </TBtn>
        <Sep />
        <TBtn
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive("heading", { level: 2 })}
          title="Heading"
        >
          <Heading2 className="h-3.5 w-3.5" />
        </TBtn>
        <TBtn
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive("heading", { level: 3 })}
          title="Subheading"
        >
          <Heading3 className="h-3.5 w-3.5" />
        </TBtn>
        <Sep />
        <TBtn
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
          title="Bullet list"
        >
          <List className="h-3.5 w-3.5" />
        </TBtn>
        <TBtn
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive("orderedList")}
          title="Ordered list"
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </TBtn>
        <TBtn
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          active={editor.isActive("taskList")}
          title="Task list"
        >
          <CheckSquare className="h-3.5 w-3.5" />
        </TBtn>
        <Sep />
        <TBtn
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive("blockquote")}
          title="Quote"
        >
          <Quote className="h-3.5 w-3.5" />
        </TBtn>
        <TBtn
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          active={editor.isActive("codeBlock")}
          title="Code block"
        >
          <Code2 className="h-3.5 w-3.5" />
        </TBtn>
        <Sep />
        <TBtn onClick={handleImageUpload} active={false} title="Upload image">
          <ImageIcon className="h-3.5 w-3.5" />
        </TBtn>
        <TBtn
          onClick={() => {
            const url = window.prompt("Enter URL:");
            if (url) editor.chain().focus().setLink({ href: url }).run();
          }}
          active={editor.isActive("link")}
          title="Insert link"
        >
          <LinkIcon className="h-3.5 w-3.5" />
        </TBtn>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
        <div className="flex-1" />
        <span className="text-[10px] text-muted-foreground">Ctrl+Enter to send</span>
      </div>
      {/* Editor */}
      <EditorContent editor={editor} />
    </div>
  );
}

function TBtn({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1 rounded transition-colors ${
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className="w-px h-4 bg-border mx-0.5" />;
}
