import { useState } from 'react'
import type { Editor } from '@tldraw/tldraw'
import {
  File,
  Columns3,
  GitBranch,
  Smartphone,
  Network,
  MessageSquare,
  Calendar,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { templates } from './templates'

const iconMap: Record<string, React.ElementType> = {
  File,
  Columns3,
  GitBranch,
  Smartphone,
  Network,
  MessageSquare,
  Calendar,
}

interface DrawingTemplatesProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editor: Editor | null
}

export default function DrawingTemplates({ open, onOpenChange, editor }: DrawingTemplatesProps) {
  const [applying, setApplying] = useState<string | null>(null)

  const handleApply = (templateId: string) => {
    const tmpl = templates.find((t) => t.id === templateId)
    if (!tmpl || !editor) return

    setApplying(templateId)

    try {
      // Clear existing canvas content
      editor.selectAll()
      editor.deleteShapes(editor.getSelectedShapeIds())

      // Apply template
      tmpl.apply(editor)
    } finally {
      setApplying(null)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Drawing Templates</DialogTitle>
          <DialogDescription>
            Choose a template to start your drawing. This will replace the current canvas content.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
          {templates.map((tmpl) => {
            const Icon = iconMap[tmpl.icon] ?? File
            return (
              <Button
                key={tmpl.id}
                variant="outline"
                className="flex flex-col items-center justify-center h-32 gap-2 p-3 hover:bg-accent/50 transition-colors"
                onClick={() => handleApply(tmpl.id)}
                disabled={applying !== null}
              >
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium">{tmpl.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{tmpl.description}</p>
                </div>
              </Button>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
