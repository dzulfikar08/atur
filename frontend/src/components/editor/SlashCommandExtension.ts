import { Extension } from '@tiptap/core'
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion'

export interface SlashCommandItem {
  title: string
  description: string
  icon: string
  command: (props: { editor: any; range: any }) => void
}

export type SlashCommandCallback = (props: {
  editor: any
  range: any
  query: string
}) => SlashCommandItem[]

let slashCommandCallback: SlashCommandCallback = () => []

export function setSlashCommandCallback(cb: SlashCommandCallback) {
  slashCommandCallback = cb
}

export const SlashCommandExtension = Extension.create<{
  suggestion: Partial<SuggestionOptions>
}>({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        command: ({
          editor,
          range,
          props,
        }: {
          editor: any
          range: any
          props: { command: (props: { editor: any; range: any }) => void }
        }) => {
          props.command({ editor, range })
        },
      } as Partial<SuggestionOptions>,
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        items: ({ query, editor }) => {
          return slashCommandCallback({
            editor,
            range: null as any,
            query,
          })
        },
      }),
    ]
  },
})
