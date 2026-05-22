import { Tldraw, Editor, createTLStore, getSnapshot, loadSnapshot } from '@tldraw/tldraw'
import '@tldraw/tldraw/tldraw.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useThemeStore } from '@/stores/theme'

interface DrawingBoardProps {
  pageId: string
  editorRef?: React.MutableRefObject<Editor | null>
}

export default function DrawingBoard({ pageId, editorRef: externalEditorRef }: DrawingBoardProps) {
  const [store] = useState(() => createTLStore())
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const internalEditorRef = useRef<Editor | null>(null)
  const editorRef = externalEditorRef ?? internalEditorRef

  // Theme support
  const { theme } = useThemeStore()
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  // Load drawing from API on mount
  useEffect(() => {
    const loadDrawing = async () => {
      try {
        const res = await fetch(`/api/workspaces/${getWorkspaceSlug()}/pages/${pageId}/`)
        if (res.ok) {
          const data = await res.json()
          if (data.description_json) {
            const snapshot = typeof data.description_json === 'string'
              ? JSON.parse(data.description_json)
              : data.description_json
            if (snapshot) {
              loadSnapshot(store, snapshot)
            }
          }
        }
      } catch (e) {
        console.error('Failed to load drawing:', e)
      } finally {
        setLoading(false)
      }
    }

    loadDrawing()
  }, [pageId, store])

  // Debounced save
  const saveDrawing = useCallback(async () => {
    if (!editorRef.current) return
    setSaving(true)

    try {
      const snapshot = getSnapshot(editorRef.current.store)
      const slug = getWorkspaceSlug()

      const res = await fetch(`/api/workspaces/${slug}/pages/${pageId}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description_json: snapshot,
        }),
      })

      if (!res.ok) {
        console.error('Failed to save drawing:', await res.text())
      }
    } catch (e) {
      console.error('Failed to save drawing:', e)
    } finally {
      setSaving(false)
    }
  }, [pageId])

  // Auto-save on changes (debounced 2s)
  const handleChange = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = setTimeout(() => {
      saveDrawing()
    }, 2000)
  }, [saveDrawing])

  // Listen for store changes
  useEffect(() => {
    const cleanup = store.listen(() => {
      handleChange()
    }, { source: 'user', scope: 'document' })

    return cleanup
  }, [store, handleChange])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      {loading && (
        <div style={{
          position: 'absolute',
          inset: 0,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isDark ? '#1a1a1a' : 'white',
          color: isDark ? '#ccc' : '#333',
        }}>
          Loading drawing...
        </div>
      )}
      {saving && (
        <div style={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 10,
          background: isDark ? '#333' : '#f3f4f6',
          padding: '4px 8px',
          borderRadius: 4,
          fontSize: 12,
          color: isDark ? '#ccc' : '#4b5563',
        }}>
          Saving...
        </div>
      )}
      <Tldraw
        store={store}
        onMount={handleMount}
        colorScheme={isDark ? 'dark' : 'light'}
        autoFocus
      />
    </div>
  )
}

// Helper to extract workspace slug
// Accepts ?workspace=slug query param, falls back to localStorage
function getWorkspaceSlug(): string {
  const params = new URLSearchParams(window.location.search)
  const slug = params.get('workspace')
  if (slug) return slug

  const lastWs = localStorage.getItem('last_workspace_slug')
  if (lastWs) return lastWs

  return 'default'
}
