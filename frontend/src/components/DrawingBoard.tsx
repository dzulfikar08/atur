import { useCallback, useEffect, useRef, useState } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { useThemeStore } from '@/stores/theme'

interface DrawingBoardProps {
  pageId: string
  excalidrawAPIRef?: React.MutableRefObject<ExcalidrawImperativeAPI | null>
}

export default function DrawingBoard({ pageId, excalidrawAPIRef: externalRef }: DrawingBoardProps) {
  const [initialData, setInitialData] = useState<{
    elements: unknown[]
    appState: Record<string, unknown>
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const internalRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const apiRef = externalRef ?? internalRef
  const initializedRef = useRef(false)
  const savingRef = useRef(false)

  const { theme } = useThemeStore()
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  // Load drawing from API
  useEffect(() => {
    initializedRef.current = false
    setInitialData(null)
    const load = async () => {
      try {
        const slug = getWorkspaceSlug()
        const res = await fetch(`/api/workspaces/${slug}/pages/${pageId}/`)
        if (res.ok) {
          const data = await res.json()
          if (data.description_json) {
            const scene = typeof data.description_json === 'string'
              ? JSON.parse(data.description_json)
              : data.description_json
            setInitialData({
              elements: scene.elements ?? [],
              appState: scene.appState ?? {},
            })
            return
          }
        }
      } catch (e) {
        console.error('Failed to load drawing:', e)
      }
      setInitialData({ elements: [], appState: {} })
    }
    load()
  }, [pageId])

  // Debounced save — only called on actual user edits
  const saveScene = useCallback(async () => {
    const api = apiRef.current
    if (!api || savingRef.current) return
    savingRef.current = true
    setSaving(true)

    try {
      const elements = api.getSceneElements()
      const appState = api.getAppState()
      const files = api.getFiles()

      const scene = {
        type: 'excalidraw',
        version: 2,
        elements,
        appState: {
          viewBackgroundColor: appState.viewBackgroundColor,
        },
        files: Object.fromEntries(
          Object.entries(files).filter(([, f]) => 'dataURL' in f)
        ),
      }

      const slug = getWorkspaceSlug()
      await fetch(`/api/workspaces/${slug}/pages/${pageId}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description_json: scene }),
      })
    } catch (e) {
      console.error('Failed to save drawing:', e)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [pageId, apiRef])

  // Skip the first onChange call (initial load), only save after user edits
  const handleChange = useCallback(() => {
    if (!initializedRef.current) {
      initializedRef.current = true
      return
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(saveScene, 2000)
  }, [saveScene])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  const handleAPI = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api
  }, [apiRef])

  if (!initialData) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading drawing...
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      {saving && (
        <div className="absolute top-2 right-2 z-50 bg-muted px-2 py-1 rounded text-xs text-muted-foreground">
          Saving...
        </div>
      )}
      <div className="h-full w-full">
        <Excalidraw
          initialData={{
            elements: initialData.elements as any[],
            appState: {
              ...(initialData.appState as any),
              theme: isDark ? 'dark' : 'light',
            },
          }}
          onChange={handleChange}
          excalidrawAPI={handleAPI}
          theme={isDark ? 'dark' : 'light'}
          UIOptions={{
            canvasActions: {
              loadScene: true,
              export: { saveFileToDisk: true },
            },
          }}
          langCode="en"
          viewModeEnabled={false}
          zenModeEnabled={false}
          gridModeEnabled={false}
        />
      </div>
    </div>
  )
}

function getWorkspaceSlug(): string {
  const pathParts = window.location.pathname.split('/')
  // Slug is always the first path segment after /
  if (pathParts.length > 1 && pathParts[1]) return pathParts[1]

  const lastWs = localStorage.getItem('last_workspace_slug')
  if (lastWs) return lastWs

  return 'default'
}
