import { useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ImageIcon, Loader2, Mic, Send } from "@/lib/icons";
import { useDictation } from "@/hooks/useDictation";
import { insertPath } from "@/lib/terminalKeys";
import { cn } from "@/lib/utils";

interface PromptComposerProps {
  paneId: string;
  /** Typing needs the pane's keyboard; false shows a read-only bar. */
  enabled: boolean;
  /** Deliver the prompt (text, then Enter); false when it could not be sent, so the draft stays. */
  onSend: (text: string) => boolean;
}

/**
 * Prompt bar for agent panes, the web twin of the app's composer: a multiline
 * draft sent as one paste followed by Enter. Enter sends, Shift+Enter adds a
 * line. Images (paste, drop or the picker) are saved on the pane's machine and
 * their path is inserted, so the agent can open them.
 */
export function PromptComposer({ paneId, enabled, onSend }: PromptComposerProps) {
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const dictation = useDictation(setText);

  const canSend = enabled && text.trim().length > 0 && uploading === 0;

  const send = () => {
    if (!canSend) return;
    if (dictation.listening) dictation.abort();
    if (onSend(text.trimEnd())) setText("");
    else toast.error("Not connected to the pane. The draft is kept.");
  };

  const attach = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0 || !enabled) return;
    setUploading((n) => n + images.length);
    for (const image of images) {
      try {
        const { path } = await api.pastePaneImage(paneId, image);
        // Read the live caret and draft: earlier uploads or typing moved them.
        setText((current) => {
          const el = area.current;
          const caret = el && document.activeElement === el ? el.selectionStart : current.length;
          const next = insertPath(current, caret, path);
          requestAnimationFrame(() => el?.setSelectionRange(next.caret, next.caret));
          return next.text;
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Couldn't upload the image");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.some((f) => f.type.startsWith("image/"))) {
      e.preventDefault();
      void attach(files);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    e.preventDefault();
    void attach(files);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME composition (Chinese, Japanese…) uses Enter to pick a candidate.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div
      className={cn(
        "flex items-end gap-2 rounded-lg border bg-card p-2",
        dragging && "ring-2 ring-primary",
      )}
      onDragOver={(e) => {
        if (!enabled || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <Textarea
        ref={area}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        disabled={!enabled}
        rows={1}
        placeholder={
          enabled
            ? "Message the agent… (Enter sends, Shift+Enter for a new line, paste or drop images)"
            : "Read-only: take the keyboard to message the agent"
        }
        aria-label="Prompt"
        className="max-h-40 min-h-[40px] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        style={{ fieldSizing: "content" } as React.CSSProperties}
      />
      <input
        ref={picker}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(e) => {
          void attach(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={!enabled}
        onClick={() => picker.current?.click()}
        title="Attach an image (saved on the pane's machine, its path goes into the prompt)"
        aria-label="Attach image"
      >
        {uploading > 0 ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ImageIcon className="h-4 w-4" />
        )}
      </Button>
      {dictation.supported && (
        <Button
          type="button"
          variant={dictation.listening ? "default" : "ghost"}
          size="icon"
          disabled={!enabled}
          onClick={() => (dictation.listening ? dictation.stop() : dictation.start(text))}
          title={
            dictation.error ??
            (dictation.listening
              ? "Listening… click to stop"
              : "Dictate (your browser's speech service turns speech into text)")
          }
          aria-label={dictation.listening ? "Stop dictation" : "Dictate"}
          aria-pressed={dictation.listening}
        >
          <Mic className={cn("h-4 w-4", dictation.error && "text-destructive")} />
        </Button>
      )}
      <Button type="button" size="icon" disabled={!canSend} onClick={send} aria-label="Send prompt">
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}
