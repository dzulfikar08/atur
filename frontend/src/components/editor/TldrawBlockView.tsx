import { useCallback, useEffect, useRef, useState } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import { Tldraw, Editor, createTLStore, getSnapshot, loadSnapshot } from '@tldraw/tldraw'
import '@tldraw/tldraw/tldraw.css'
import { Maximize2, Save, Trash2 } from '@/lib/icons'
import { useThemeStore } from '@/stores/theme'
import { TldrawFullscreenModal } from './TldrawFullscreenModal'

export function TldrawBlockView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const dataAttr = (node.attrs as Record<string, string>).data
  const [store] = useState(() => createTLStore())
  const editorRef = useRef<Editor | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [fullscreenOpen, setFullscreenOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initializedRef = useRef(false)

  const { theme } = useThemeStore()
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  // Load initial data from node attribute into store
  useEffect(() => {
    if (initializedRef.current) return
    try {
      const parsed = typeof dataAttr === 'string' ? JSON.parse(dataAttr) : dataAttr
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
        loadSnapshot(store, parsed)
      }
    } catch {
      // ignore parse errors for empty/invalid data
    }
    initializedRef.current = true
  }, [dataAttr, store])

  // Cleanup save timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  const saveToNode = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    setSaving(true)
    try {
      const snapshot = getSnapshot(editor.store)
      const serialized = JSON.stringify(snapshot)
      updateAttributes({ data: serialized })
    } catch {
      // silently fail
    }
    // Brief visual indicator
    setTimeout(() => setSaving(false), 600)
  }, [updateAttributes])

  const handleStoreChange = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = setTimeout(() => {
      saveToNode()
    }, 2000)
  }, [saveToNode])

  // Listen for store changes when editing
  useEffect(() => {
    if (!isEditing) return
    const cleanup = store.listen(() => {
      handleStoreChange()
    }, { source: 'user', scope: 'document' })
    return cleanup
  }, [store, handleStoreChange, isEditing])

  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor
  }, [])

  const handleFullscreenSave = useCallback(
    (newData: string) => {
      updateAttributes({ data: newData })
      try {
        const parsed = JSON.parse(newData)
        if (parsed) {
          loadSnapshot(store, parsed)
        }
      } catch {
        // ignore
      }
    },
    [updateAttributes, store]
  )

  return (
    <NodeViewWrapper>
      <div
        className="tldraw-block-container relative my-4 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
        style={{ height: 300 }}
      >
        {/* Click-to-edit overlay */}
        {!isEditing && (
          <div
            className="absolute inset-0 z-20 flex items-center justify-center bg-gray-50/80 dark:bg-gray-900/80 cursor-pointer transition-colors hover:bg-gray-100/90 dark:hover:bg-gray-800/90"
            onClick={() => setIsEditing(true)}
          >
            <div className="text-center">
              <div className="text-gray-500 dark:text-gray-400 text-sm font-medium">
                Click to edit drawing
              </div>
              <div className="text-gray-400 dark:text-gray-500 text-xs mt-1">
                Double-click to open canvas
              </div>
            </div>
          </div>
        )}

        {/* Toolbar overlay */}
        {isEditing && (
          <div className="absolute top-2 right-2 z-30 flex items-center gap-1 bg-white/90 dark:bg-gray-800/90 rounded-md shadow-sm border border-gray-200 dark:border-gray-700 p-1">
            <button
              onClick={() => setFullscreenOpen(true)}
              className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300"
              title="Open fullscreen"
            >
              <Maximize2 size={14} />
            </button>
            <button
              onClick={saveToNode}
              className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300"
              title="Save"
            >
              <Save size={14} />
            </button>
            <button
              onClick={deleteNode}
              className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/50 text-gray-600 dark:text-gray-300 hover:text-red-600 dark:hover:text-red-400"
              title="Delete block"
            >
              <Trash2 size={14} />
            </button>
            {saving && (
              <span className="text-xs text-gray-400 dark:text-gray-500 px-1">Saved</span>
            )}
          </div>
        )}

        {/* tldraw canvas */}
        <div className="w-full h-full" style={{ minHeight: 300 }}>
          <Tldraw
            store={store}
            onMount={handleMount}
            colorScheme={isDark ? 'dark' : 'light'}
            autoFocus={false}
          />
        </div>
      </div>

      {/* Fullscreen modal */}
      {fullscreenOpen && (
        <TldrawFullscreenModal
          initialData={dataAttr}
          onSave={handleFullscreenSave}
          onClose={() => setFullscreenOpen(false)}
        />
      )}
    </NodeViewWrapper>
  )
}
