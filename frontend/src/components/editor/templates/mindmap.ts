import type { Editor } from '@tldraw/tldraw'
import { toRichText } from '@tldraw/tlschema'
import type { DrawingTemplate } from './index'

const branchColors = [
  'green' as const,
  'violet' as const,
  'orange' as const,
  'red' as const,
  'light-blue' as const,
  'yellow' as const,
]

export const mindMapTemplate: DrawingTemplate = {
  id: 'mindmap',
  name: 'Mind Map',
  description: 'Central node with branches',
  icon: 'Network',
  apply: (editor: Editor) => {
    editor.run(() => {
      const cx = 500
      const cy = 400

      // Central node
      editor.createShape({
        type: 'geo',
        x: cx - 100,
        y: cy - 50,
        props: {
          geo: 'ellipse',
          w: 200,
          h: 100,
          fill: 'solid',
          color: 'blue',
          richText: toRichText('Main Idea'),
          font: 'sans',
          size: 'l',
          align: 'middle',
          verticalAlign: 'middle',
        },
      })

      // Branches
      const branches = [
        { label: 'Planning', angle: -60, dist: 280 },
        { label: 'Design', angle: -20, dist: 300 },
        { label: 'Development', angle: 20, dist: 300 },
        { label: 'Testing', angle: 60, dist: 280 },
        { label: 'Research', angle: -120, dist: 260 },
        { label: 'Launch', angle: 120, dist: 260 },
      ]

      branches.forEach((branch, bi) => {
        const rad = (branch.angle * Math.PI) / 180
        const bx = cx + Math.cos(rad) * branch.dist
        const by = cy + Math.sin(rad) * branch.dist
        const color = branchColors[bi]

        // Branch node
        editor.createShape({
          type: 'geo',
          x: bx - 80,
          y: by - 35,
          props: {
            geo: 'rectangle',
            w: 160,
            h: 70,
            fill: 'solid',
            color,
            richText: toRichText(branch.label),
            font: 'sans',
            size: 'm',
            align: 'middle',
            verticalAlign: 'middle',
          },
        })

        // Arrow from center to branch
        const startRad = (branch.angle * Math.PI) / 180
        const sx = cx + Math.cos(startRad) * 55
        const sy = cy + Math.sin(startRad) * 30
        const ex = bx - Math.cos(startRad) * 85
        const ey = by - Math.sin(startRad) * 40

        editor.createShape({
          type: 'arrow',
          x: 0,
          y: 0,
          props: {
            start: { x: sx, y: sy },
            end: { x: ex, y: ey },
            color,
          },
        })

        // Sub-branches (2 per branch)
        const subLabels = branch.label === 'Planning'
          ? ['Timeline', 'Resources']
          : branch.label === 'Design'
            ? ['UI/UX', 'Branding']
            : branch.label === 'Development'
              ? ['Frontend', 'Backend']
              : branch.label === 'Testing'
                ? ['Unit', 'E2E']
                : branch.label === 'Research'
                  ? ['Market', 'Users']
                  : ['Release', 'Monitor']

        subLabels.forEach((subLabel, si) => {
          const subAngle = branch.angle + (si === 0 ? -20 : 20)
          const subRad = (subAngle * Math.PI) / 180
          const subDist = 180
          const subX = bx + Math.cos(subRad) * subDist
          const subY = by + Math.sin(subRad) * subDist

          editor.createShape({
            type: 'geo',
            x: subX - 65,
            y: subY - 25,
            props: {
              geo: 'rectangle',
              w: 130,
              h: 50,
              fill: 'semi',
              color,
              richText: toRichText(subLabel),
              font: 'sans',
              size: 's',
              align: 'middle',
              verticalAlign: 'middle',
            },
          })

          // Sub arrow
          const subSx = bx + Math.cos(subRad) * 40
          const subSy = by + Math.sin(subRad) * 40
          const subEx = subX - Math.cos(subRad) * 70
          const subEy = subY - Math.sin(subRad) * 30

          editor.createShape({
            type: 'arrow',
            x: 0,
            y: 0,
            props: {
              start: { x: subSx, y: subSy },
              end: { x: subEx, y: subEy },
              color,
              size: 's',
            },
          })
        })
      })

      editor.zoomToFit({ animation: { duration: 400 } })
    }, { history: 'record' })
  },
}
