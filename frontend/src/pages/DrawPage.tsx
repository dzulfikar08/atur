import { useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { exportToBlob } from '@excalidraw/excalidraw'
import {
  ArrowLeft,
  Download,
  FileImage,
  ClipboardCopy,
  Maximize,
  Minimize,
} from '@/lib/icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import DrawingBoard from '@/components/DrawingBoard'
import { toast } from 'sonner'

export default function DrawPage() {
  const { slug, pageId } = useParams<{ slug: string; pageId: string }>()
  const navigate = useNavigate()
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const [fullscreen, setFullscreen] = useState(false)

  const goBack = () => {
    navigate(`/${slug}/pages/${pageId}`)
  }

  const exportPNG = useCallback(async () => {
    const api = apiRef.current
    if (!api) return

    try {
      const elements = api.getSceneElements()
      if (!elements.length) {
        toast.error('Nothing to export')
        return
      }
      const blob = await exportToBlob({
        elements,
        appState: api.getAppState(),
        files: api.getFiles(),
        mimeType: 'image/png',
      })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `drawing-${pageId ?? 'canvas'}.png`
      link.click()
      URL.revokeObjectURL(link.href)
      toast.success('PNG exported')
    } catch (e) {
      console.error('Export PNG failed:', e)
      toast.error('Failed to export PNG')
    }
  }, [pageId])

  const copyToClipboard = useCallback(async () => {
    const api = apiRef.current
    if (!api) return

    try {
      const elements = api.getSceneElements()
      if (!elements.length) {
        toast.error('Nothing to copy')
        return
      }
      const blob = await exportToBlob({
        elements,
        appState: api.getAppState(),
        files: api.getFiles(),
        mimeType: 'image/png',
      })
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ])
      toast.success('Copied to clipboard')
    } catch (e) {
      console.error('Copy failed:', e)
      toast.error('Failed to copy')
    }
  }, [])

  const toggleFullscreen = useCallback(() => {
    setFullscreen((prev) => !prev)
  }, [])

  if (!pageId) {
    return <div className="p-4">No page ID specified</div>
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      {!fullscreen && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-background z-50 shrink-0 h-12">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <span className="text-sm font-medium truncate">Drawing</span>

          <div className="flex-1" />

          {/* Export */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 gap-1.5">
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Export</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportPNG}>
                <FileImage className="mr-2 h-4 w-4" />
                Export PNG
              </DropdownMenuItem>
              <DropdownMenuItem onClick={copyToClipboard}>
                <ClipboardCopy className="mr-2 h-4 w-4" />
                Copy to clipboard
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Fullscreen */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={toggleFullscreen}
            title={fullscreen ? 'Exit full screen' : 'Full screen'}
          >
            {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </Button>
        </div>
      )}

      {/* Fullscreen exit button */}
      {fullscreen && (
        <Button
          variant="ghost"
          size="icon"
          className="fixed top-3 right-3 z-50 h-9 w-9 bg-background/80 backdrop-blur-sm border shadow-sm hover:bg-background"
          onClick={toggleFullscreen}
          title="Exit full screen"
        >
          <Minimize className="h-4 w-4" />
        </Button>
      )}

      {/* Canvas */}
      <div className="flex-1 relative">
        <DrawingBoard pageId={pageId} excalidrawAPIRef={apiRef} />
      </div>
    </div>
  )
}
