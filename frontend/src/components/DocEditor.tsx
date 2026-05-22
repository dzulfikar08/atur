import { useEditor, EditorContent, ReactRenderer } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Image from '@tiptap/extension-image'
import HorizontalRule from '@tiptap/extension-horizontal-rule'
import { createLowlight } from 'lowlight'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import css from 'highlight.js/lib/languages/css'
import json from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'
import markdown from 'highlight.js/lib/languages/markdown'
import bash from 'highlight.js/lib/languages/bash'
import sql from 'highlight.js/lib/languages/sql'
import rust from 'highlight.js/lib/languages/rust'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import yaml from 'highlight.js/lib/languages/yaml'
import { useCallback, useState, useEffect } from 'react'
import tippy, { type Instance as TippyInstance } from 'tippy.js'
import { Markdown } from 'tiptap-markdown'
import { useCollab } from '../hooks/useCollab'
import { SlashCommandExtension } from './editor/SlashCommandExtension'
import {
  SlashCommandMenu,
  getSlashCommandItems,
  type SlashCommandMenuRef,
} from './editor/SlashCommand'

const lowlight = createLowlight()

// Register common languages for syntax highlighting
lowlight.register({ javascript })
lowlight.register({ typescript })
lowlight.register({ python })
lowlight.register({ css })
lowlight.register({ json })
lowlight.register({ xml })
lowlight.register({ markdown })
lowlight.register({ bash })
lowlight.register({ sql })
lowlight.register({ rust })
lowlight.register({ go })
lowlight.register({ java })
lowlight.register({ yaml })

interface DocEditorProps {
  pageId: string
}

export default function DocEditor({ pageId }: DocEditorProps) {
  const { ydoc, connected } = useCollab(pageId)
  const [isMarkdownMode, setIsMarkdownMode] = useState(false)
  const [markdownText, setMarkdownText] = useState('')
  const [wordCount, setWordCount] = useState(0)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        undoRedo: false, // Let Y.js handle history
        codeBlock: false, // Replaced by CodeBlockLowlight
        horizontalRule: false, // Replaced by our extension
      }),
      HorizontalRule,
      CodeBlockLowlight.configure({
        lowlight,
        HTMLAttributes: {
          class: 'code-block-highlighted',
        },
      }),
      Collaboration.configure({
        document: ydoc,
      }),
      Placeholder.configure({
        placeholder: 'Start writing... Type / for commands',
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableCell,
      TableHeader,
      Image.configure({
        inline: true,
        allowBase64: true,
      }),
      Markdown,
      SlashCommandExtension.configure({
        suggestion: {
          items: ({ query }) => getSlashCommandItems(query),
          render: () => {
            let component: ReactRenderer<SlashCommandMenuRef> | null = null
            let popup: TippyInstance[] | null = null

            return {
              onStart: (props) => {
                component = new ReactRenderer(SlashCommandMenu, {
                  props,
                  editor: props.editor,
                })

                if (!props.clientRect) return

                popup = tippy('body', {
                  getReferenceClientRect: props.clientRect as () => DOMRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: 'manual',
                  placement: 'bottom-start',
                  theme: 'slash-command',
                  zIndex: 99999,
                })
              },
              onUpdate(props) {
                component?.updateProps(props)
                if (props.clientRect) {
                  popup?.[0]?.setProps({
                    getReferenceClientRect: props.clientRect as () => DOMRect,
                  })
                }
              },
              onKeyDown(props) {
                if (props.event.key === 'Escape') {
                  popup?.[0]?.hide()
                  return true
                }
                return component?.ref?.onKeyDown(props.event) ?? false
              },
              onExit() {
                popup?.[0]?.destroy()
                component?.destroy()
                popup = null
                component = null
              },
            }
          },
        },
      }),
    ],
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[500px] p-4',
      },
    },
    onUpdate: ({ editor }) => {
      const text = editor.getText()
      setWordCount(text ? text.split(/\s+/).filter(Boolean).length : 0)
    },
  })

  useEffect(() => {
    if (editor) {
      const text = editor.getText()
      setWordCount(text ? text.split(/\s+/).filter(Boolean).length : 0)
    }
  }, [editor])

  const toggleMarkdown = useCallback(() => {
    if (!editor) return

    if (!isMarkdownMode) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const md = (editor.storage as any).markdown?.getMarkdown?.() as string | undefined
      setMarkdownText(md ?? '')
      setIsMarkdownMode(true)
    } else {
      editor.commands.setContent(markdownText)
      setIsMarkdownMode(false)
    }
  }, [editor, isMarkdownMode, markdownText])

  if (!ydoc) return <div className="p-4">Loading editor...</div>

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b px-4 py-2 bg-gray-50 dark:bg-gray-900 dark:border-gray-700 flex-wrap">
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleBold().run()}
          active={editor?.isActive('bold') ?? false}
          title="Bold"
        >
          B
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          active={editor?.isActive('italic') ?? false}
          title="Italic"
          className="italic"
        >
          I
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleStrike().run()}
          active={editor?.isActive('strike') ?? false}
          title="Strikethrough"
          className="line-through"
        >
          S
        </ToolbarButton>
        <div className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
          active={editor?.isActive('heading', { level: 1 }) ?? false}
          title="Heading 1"
        >
          H1
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor?.isActive('heading', { level: 2 }) ?? false}
          title="Heading 2"
        >
          H2
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor?.isActive('heading', { level: 3 }) ?? false}
          title="Heading 3"
        >
          H3
        </ToolbarButton>
        <div className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          active={editor?.isActive('bulletList') ?? false}
          title="Bullet List"
        >
          &#8226;
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          active={editor?.isActive('orderedList') ?? false}
          title="Ordered List"
        >
          1.
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleTaskList().run()}
          active={editor?.isActive('taskList') ?? false}
          title="Task List"
        >
          &#9745;
        </ToolbarButton>
        <div className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          active={editor?.isActive('blockquote') ?? false}
          title="Blockquote"
        >
          &#8220;
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
          active={editor?.isActive('codeBlock') ?? false}
          title="Code Block"
        >
          {'</>'}
        </ToolbarButton>
        <ToolbarButton
          onClick={() => {
            const url = window.prompt('Enter image URL:')
            if (url) editor?.chain().focus().setImage({ src: url }).run()
          }}
          active={false}
          title="Insert Image"
        >
          &#128444;
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
          active={editor?.isActive('table') ?? false}
          title="Insert Table"
        >
          &#9638;
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().setHorizontalRule().run()}
          active={false}
          title="Horizontal Rule"
        >
          &#8213;
        </ToolbarButton>

        <div className="flex-1" />
        <span className="text-xs text-gray-500 dark:text-gray-400 mr-2">
          {wordCount} words
        </span>
        <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mr-2">
          <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
          {connected ? 'Connected' : 'Disconnected'}
        </span>
        <button
          onClick={toggleMarkdown}
          className={`px-3 py-1 rounded text-sm border ${isMarkdownMode ? 'bg-blue-100 border-blue-300 dark:bg-blue-900 dark:border-blue-700' : 'hover:bg-gray-200 dark:hover:bg-gray-700 dark:border-gray-600'}`}
        >
          {isMarkdownMode ? 'Rich Text' : 'Markdown'}
        </button>
      </div>

      {/* Editor area */}
      {isMarkdownMode ? (
        <textarea
          className="flex-1 p-4 font-mono text-sm resize-none focus:outline-none bg-white dark:bg-gray-900 dark:text-gray-100"
          value={markdownText}
          onChange={(e) => setMarkdownText(e.target.value)}
        />
      ) : (
        <EditorContent editor={editor} className="flex-1 overflow-auto" />
      )}
    </div>
  )
}

function ToolbarButton({
  onClick,
  active,
  title,
  className = '',
  children,
}: {
  onClick: () => void
  active: boolean
  title: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`px-2 py-1 rounded text-sm font-medium transition-colors ${className} ${
        active
          ? 'bg-gray-300 dark:bg-gray-600'
          : 'hover:bg-gray-200 dark:hover:bg-gray-700'
      }`}
    >
      {children}
    </button>
  )
}
