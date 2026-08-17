import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Tldraw, Editor, createTLStore, getSnapshot, loadSnapshot } from "@tldraw/tldraw";
import "@tldraw/tldraw/tldraw.css";
import { X, Save } from "@/lib/icons";
import { useThemeStore } from "@/stores/theme";

interface TldrawFullscreenModalProps {
  initialData: string;
  onSave: (data: string) => void;
  onClose: () => void;
}

export function TldrawFullscreenModal({
  initialData,
  onSave,
  onClose,
}: TldrawFullscreenModalProps) {
  const [store] = useState(() => createTLStore());
  const editorRef = useRef<Editor | null>(null);

  const { theme } = useThemeStore();
  const isDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  // Load initial data
  useEffect(() => {
    try {
      const parsed = typeof initialData === "string" ? JSON.parse(initialData) : initialData;
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
        loadSnapshot(store, parsed);
      }
    } catch {
      // ignore parse errors
    }
  }, [initialData, store]);

  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor;
  }, []);

  const handleSave = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    try {
      const snapshot = getSnapshot(editor.store);
      onSave(JSON.stringify(snapshot));
    } catch {
      // silently fail
    }
    onClose();
  }, [onSave, onClose]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    // Prevent body scroll when modal is open
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex flex-col bg-black/80">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 z-10">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Drawing Editor</span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            <Save size={14} />
            Save & Close
          </button>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Cancel"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative">
        <Tldraw
          store={store}
          onMount={handleMount}
          colorScheme={isDark ? "dark" : "light"}
          autoFocus
        />
      </div>
    </div>,
    document.body,
  );
}
