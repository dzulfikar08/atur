import type { Editor } from '@tldraw/tldraw'

export interface DrawingTemplate {
  id: string
  name: string
  description: string
  icon: string
  /** Applies the template by creating shapes on the editor canvas */
  apply: (editor: Editor) => void
}

export { blankTemplate } from './blank'
export { kanbanTemplate } from './kanban'
export { flowchartTemplate } from './flowchart'
export { wireframeTemplate } from './wireframe'
export { mindMapTemplate } from './mindmap'
export { sprintRetroTemplate } from './sprintRetro'
export { timelineTemplate } from './timeline'

import { blankTemplate } from './blank'
import { kanbanTemplate } from './kanban'
import { flowchartTemplate } from './flowchart'
import { wireframeTemplate } from './wireframe'
import { mindMapTemplate } from './mindmap'
import { sprintRetroTemplate } from './sprintRetro'
import { timelineTemplate } from './timeline'

export const templates: DrawingTemplate[] = [
  blankTemplate,
  kanbanTemplate,
  flowchartTemplate,
  wireframeTemplate,
  mindMapTemplate,
  sprintRetroTemplate,
  timelineTemplate,
]
