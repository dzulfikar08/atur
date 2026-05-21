import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import Placeholder from '@tiptap/extension-placeholder'
import { useCallback, useState } from 'react'
import { useCollab } from '../hooks/useCollab'

interface DocEditorProps {
  pageId: string
}

export default function DocEditor({ pageId }: DocEditorProps) {
  const { ydoc, connected } = useCollab(pageId)
  const [isMarkdownMode, setIsMarkdownMode] = useState(false)
  const [markdownText, setMarkdownText] = useState('')

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        undoRedo: false, // Let Y.js handle history
      }),
      Collaboration.configure({
        document: ydoc,
      }),
      Placeholder.configure({
        placeholder: 'Start writing...',
      }),
    ],
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[500px] p-4',
      },
    },
  })

  const toggleMarkdown = useCallback(() => {
    if (!editor) return

    if (!isMarkdownMode) {
      // Switching to markdown mode — extract markdown from editor content
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const md = (editor.storage as any).markdown?.getMarkdown?.() as string | undefined
      setMarkdownText(md ?? '')
      setIsMarkdownMode(true)
    } else {
      // Switching back to rich text — set content from markdown
      editor.commands.setContent(markdownText)
      setIsMarkdownMode(false)
    }
  }, [editor, isMarkdownMode, markdownText])

  if (!ydoc) return <div className="p-4">Loading editor...</div>

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b px-4 py-2 bg-gray-50">
        <button
          onClick={() => editor?.chain().focus().toggleBold().run()}
          className={`px-2 py-1 rounded text-sm ${editor?.isActive('bold') ? 'bg-gray-300' : 'hover:bg-gray-200'}`}
        >
          B
        </button>
        <button
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          className={`px-2 py-1 rounded text-sm italic ${editor?.isActive('italic') ? 'bg-gray-300' : 'hover:bg-gray-200'}`}
        >
          I
        </button>
        <button
          onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
          className={`px-2 py-1 rounded text-sm ${editor?.isActive('heading', { level: 1 }) ? 'bg-gray-300' : 'hover:bg-gray-200'}`}
        >
          H1
        </button>
        <button
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          className={`px-2 py-1 rounded text-sm ${editor?.isActive('heading', { level: 2 }) ? 'bg-gray-300' : 'hover:bg-gray-200'}`}
        >
          H2
        </button>
        <button
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          className={`px-2 py-1 rounded text-sm ${editor?.isActive('bulletList') ? 'bg-gray-300' : 'hover:bg-gray-200'}`}
        >
          List
        </button>
        <button
          onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
          className={`px-2 py-1 rounded text-sm ${editor?.isActive('codeBlock') ? 'bg-gray-300' : 'hover:bg-gray-200'}`}
        >
          Code
        </button>
        <div className="flex-1" />
        <span className="text-xs text-gray-500">
          {connected ? 'Connected' : 'Disconnected'}
        </span>
        <button
          onClick={toggleMarkdown}
          className={`px-3 py-1 rounded text-sm border ${isMarkdownMode ? 'bg-blue-100 border-blue-300' : 'hover:bg-gray-200'}`}
        >
          {isMarkdownMode ? 'Rich Text' : 'Markdown'}
        </button>
      </div>

      {/* Editor area */}
      {isMarkdownMode ? (
        <textarea
          className="flex-1 p-4 font-mono text-sm resize-none focus:outline-none"
          value={markdownText}
          onChange={(e) => setMarkdownText(e.target.value)}
        />
      ) : (
        <EditorContent editor={editor} className="flex-1 overflow-auto" />
      )}
    </div>
  )
}
