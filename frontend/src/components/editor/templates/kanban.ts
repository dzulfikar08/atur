import type { Editor } from '@tldraw/tldraw'
import { toRichText } from '@tldraw/tlschema'
import type { DrawingTemplate } from './index'

const noteColors = [
  'yellow' as const,
  'light-blue' as const,
  'light-green' as const,
  'light-red' as const,
  'light-violet' as const,
]

export const kanbanTemplate: DrawingTemplate = {
  id: 'kanban',
  name: 'Kanban Board',
  description: '4 columns with sticky notes',
  icon: 'Columns3',
  apply: (editor: Editor) => {
    editor.run(() => {
      const cols = ['Backlog', 'Todo', 'In Progress', 'Done'] as const
      const colX = [100, 420, 740, 1060]
      const colWidth = 280
      const colHeight = 600
      const headerH = 50
      const colors = ['grey', 'blue', 'yellow', 'green'] as const

      cols.forEach((label, i) => {
        // Column frame
        editor.createShape({
          type: 'geo',
          x: colX[i],
          y: 100,
          props: {
            geo: 'rectangle',
            w: colWidth,
            h: colHeight,
            fill: 'semi',
            color: colors[i],
            richText: toRichText(''),
            dash: 'dashed',
          },
        })

        // Column header
        editor.createShape({
          type: 'geo',
          x: colX[i]! + 10,
          y: 110,
          props: {
            geo: 'rectangle',
            w: colWidth - 20,
            h: headerH,
            fill: 'solid',
            color: colors[i],
            richText: toRichText(label),
            font: 'sans',
            size: 'm',
            align: 'middle',
            verticalAlign: 'middle',
          },
        })

        // Sample sticky notes
        const notes: string[][] = [
          ['Research competitors', 'Draft proposal'],
          ['Setup CI/CD', 'Design mockups'],
          ['Build API endpoint', 'Write unit tests'],
          ['Deploy v1.0', 'Post-release review'],
        ]

        notes[i]!.forEach((text, j) => {
          editor.createShape({
            type: 'note',
          x: colX[i]! + 20,
            y: 180 + j * 120,
            props: {
              richText: toRichText(text),
              color: noteColors[(i + j) % noteColors.length],
              font: 'sans',
              size: 's',
            },
          })
        })
      })

      // Title
      editor.createShape({
        type: 'text',
        x: 100,
        y: 40,
        props: {
          richText: toRichText('Kanban Board'),
          font: 'sans',
          size: 'xl',
        },
      })

      editor.zoomToFit({ animation: { duration: 400 } })
    }, { history: 'record' })
  },
}
