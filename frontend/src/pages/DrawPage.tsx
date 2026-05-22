import { useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Editor } from '@tldraw/tldraw'
import {
  ArrowLeft,
  Download,
  Image,
  FileImage,
  ClipboardCopy,
  Maximize,
  Minimize,
  LayoutTemplate,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import DrawingBoard from '@/components/DrawingBoard'
import DrawingTemplates from '@/components/editor/DrawingTemplates'
import { toast } from 'sonner'

export default function DrawPage() {
  const { pageId } = useParams<{ pageId: string }>()
  const navigate = useNavigate()
  const editorRef = useRef<Editor | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)

  const goBack = () => {
    navigate(-1)
  }

  // --- Export functions ---
  const exportPNG = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return

    try {
      const shapes = editor.getCurrentPageShapes()
      const result = await editor.toImage(shapes, {
        format: 'png',
        pixelRatio: 2,
        background: true,
        padding: 'auto',
      })
      if (result) {
        const link = document.createElement('a')
        link.href = URL.createObjectURL(result.blob)
        link.download = `drawing-${pageId ?? 'canvas'}.png`
        link.click()
        URL.revokeObjectURL(link.href)
        toast.success('PNG exported successfully')
      }
    } catch (e) {
      console.error('Export PNG failed:', e)
      toast.error('Failed to export PNG')
    }
  }, [pageId])

  const exportSVG = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return

    try {
      const shapes = editor.getCurrentPageShapes()
      const result = await editor.getSvgString(shapes, { background: true })
      if (result) {
        const blob = new Blob([result.svg], { type: 'image/svg+xml' })
        const link = document.createElement('a')
        link.href = URL.createObjectURL(blob)
        link.download = `drawing-${pageId ?? 'canvas'}.svg`
        link.click()
        URL.revokeObjectURL(link.href)
        toast.success('SVG exported successfully')
      }
    } catch (e) {
      console.error('Export SVG failed:', e)
      toast.error('Failed to export SVG')
    }
  }, [pageId])

  const copyToClipboard = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return

    try {
      const shapes = editor.getCurrentPageShapes()
      const result = await editor.toImage(shapes, {
        format: 'png',
        pixelRatio: 2,
        background: true,
        padding: 'auto',
      })
      if (result) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'image/png': result.blob,
          }),
        ])
        toast.success('Copied to clipboard')
      }
    } catch (e) {
      console.error('Copy to clipboard failed:', e)
      toast.error('Failed to copy to clipboard')
    }
  }, [])

  const toggleFullscreen = useCallback(() => {
    setFullscreen((prev) => !prev)
  }, [])

  if (!pageId) {
    return <div style={{ padding: 16 }}>No page ID specified</div>
  }

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar header */}
      {!fullscreen && (
        <div
          className="flex items-center gap-2 px-3 py-1.5 border-b bg-background z-50 shrink-0"
          style={{ height: 48 }}
        >
          {/* Back button */}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <span className="text-sm font-medium truncate max-w-[200px]">
            Drawing
          </span>

          <div className="flex-1" />

          {/* Templates */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setTemplatesOpen(true)}
          >
            <LayoutTemplate className="h-4 w-4" />
            <span className="hidden sm:inline">Templates</span>
          </Button>

          {/* Export dropdown */}
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
              <DropdownMenuItem onClick={exportSVG}>
                <Image className="mr-2 h-4 w-4" />
                Export SVG
              </DropdownMenuItem>
              <DropdownMenuItem onClick={copyToClipboard}>
                <ClipboardCopy className="mr-2 h-4 w-4" />
                Copy to clipboard
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Fullscreen toggle */}
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

      {/* Fullscreen exit button (visible in fullscreen mode) */}
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

      {/* Drawing canvas */}
      <div className="flex-1 relative">
        <DrawingBoard pageId={pageId} editorRef={editorRef} />
      </div>

      {/* Templates dialog */}
      <DrawingTemplates
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        editor={editorRef.current}
      />
    </div>
  )
}
