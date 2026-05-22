import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { TldrawBlockView } from './TldrawBlockView'

export interface TldrawBlockOptions {
  HTMLAttributes: Record<string, string>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tldrawBlock: {
      insertTldrawBlock: (attrs?: { data?: string }) => ReturnType
    }
  }
}

export const TldrawBlock = Node.create<TldrawBlockOptions>({
  name: 'tldraw-block',
  group: 'block',
  atom: true,
  defining: true,

  addOptions() {
    return { HTMLAttributes: {} }
  },

  addAttributes() {
    return {
      data: {
        default: '{}',
        parseHTML: (el) => el.getAttribute('data-tldraw') ?? '{}',
        renderHTML: (attrs) => ({
          'data-tldraw': attrs.data ?? '{}',
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-tldraw-block]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes({ 'data-tldraw-block': '' }, HTMLAttributes),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TldrawBlockView)
  },

  addCommands() {
    return {
      insertTldrawBlock:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { data: attrs?.data ?? '{}' },
          })
        },
    }
  },
})
