// @ts-nocheck
import type { Editor } from '@tldraw/tldraw'
import { toRichText } from '@tldraw/tlschema'
import type { DrawingTemplate } from './index'

export const sprintRetroTemplate: DrawingTemplate = {
  id: 'sprintRetro',
  name: 'Sprint Retro',
  description: '3 columns: Went Well, Improve, Actions',
  icon: 'MessageSquare',
  apply: (editor: Editor) => {
    editor.run(() => {
      const cols = [
        { label: 'Went Well', color: 'green', noteColor: 'light-green' },
        { label: 'Improve', color: 'orange', noteColor: 'light-yellow' },
        { label: 'Actions', color: 'blue', noteColor: 'light-blue' },
      ]

      const colWidth = 300
      const colGap = 40
      const startX = 100
      const startY = 120

      // Title
      editor.createShape({
        type: 'text',
        x: startX,
        y: 40,
        props: {
          richText: toRichText('Sprint Retrospective'),
          font: 'sans',
          size: 'xl',
        },
      })

      // Sprint label
      editor.createShape({
        type: 'text',
        x: startX,
        y: 80,
        props: {
          richText: toRichText('Sprint 12 — Jan 6 to Jan 17'),
          font: 'sans',
          size: 's',
          color: 'grey',
        },
      })

      cols.forEach((col, i) => {
        const x = startX + i * (colWidth + colGap)

        // Column background
        editor.createShape({
          type: 'geo',
          x,
          y: startY,
          props: {
            geo: 'rectangle',
            w: colWidth,
            h: 600,
            fill: 'semi',
            color: col.color,
            richText: toRichText(''),
            dash: 'dashed',
          },
        })

        // Column header
        editor.createShape({
          type: 'geo',
          x: x + 10,
          y: startY + 10,
          props: {
            geo: 'rectangle',
            w: colWidth - 20,
            h: 50,
            fill: 'solid',
            color: col.color,
            richText: toRichText(col.label),
            font: 'sans',
            size: 'm',
            align: 'middle',
            verticalAlign: 'middle',
          },
        })

        // Sample notes
        const sampleNotes = i === 0
          ? ['Great team collaboration', 'Delivered on time', 'Good test coverage']
          : i === 1
            ? ['Too many meetings', 'Unclear requirements', 'Need better docs']
            : ['Daily standups at 9am', 'Add acceptance criteria', 'Pair programming sessions']

        sampleNotes.forEach((text, j) => {
          editor.createShape({
            type: 'note',
            x: x + 20,
            y: startY + 80 + j * 120,
            props: {
              richText: toRichText(text),
              color: col.noteColor,
              font: 'sans',
              size: 's',
            },
          })
        })
      })

      editor.zoomToFit({ animation: { duration: 400 } })
    }, { history: 'record' })
  },
}
