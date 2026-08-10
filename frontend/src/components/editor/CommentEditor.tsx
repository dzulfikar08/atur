import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import ImageExt from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import { Markdown } from 'tiptap-markdown'
import { createLowlight } from 'lowlight'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import css from 'highlight.js/lib/languages/css'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import sql from 'highlight.js/lib/languages/sql'
import rust from 'highlight.js/lib/languages/rust'
import { useCallback, useRef } from 'react'
import {
  Bold, Italic, Strikethrough,
  Heading2, Heading3,
  List, ListOrdered, CheckSquare,
  Quote, Code2,
  ImageIcon, LinkIcon,
} from '@/lib/icons'

const lowlight = createLowlight()
lowlight.register({ javascript, typescript, python, css, json, bash, sql, rust })

interface CommentEditorProps {
  value: string
  onChange: (html: string) => void
  onSubmit?: () => void
  placeholder?: string
  compact?: boolean
  uploadUrl?: string
}

export default function CommentEditor({ value, onChange, onSubmit, placeholder, compact: _compact, uploadUrl = '/api/assets/upload/' }: CommentEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        codeBlock: false,
      }),
      CodeBlockLowlight.configure({ lowlight }),
      ImageExt.configure({ inline: true, allowBase64: true }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: 'text-primary underline' } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: placeholder || 'Add a comment...' }),
      Markdown,
    ],
    content: value || '',
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[80px] px-3 py-2',
      },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          onSubmit?.()
          return true
        }
        return false
      },
      handlePaste: (_view, event) => {
        const items = event.clipboardData?.items
        if (!items) return false
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            event.preventDefault()
            const file = item.getAsFile()
            if (file) uploadAndInsertImage(file)
            return true
          }
        }
        return false
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files
        if (!files || files.length === 0) return false
        for (const file of files) {
          if (file.type.startsWith('image/')) {
            event.preventDefault()
            uploadAndInsertImage(file)
            return true
          }
        }
        return false
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
  })

  const uploadAndInsertImage = useCallback(async (file: File) => {
    if (!editor) return
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch(uploadUrl, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) throw new Error('Upload failed')
      const data = await res.json()
      const src = data.url || `/api/assets/${data.id}`
      editor.chain().focus().setImage({ src, alt: file.name }).run()
    } catch (err) {
      console.error('Image upload failed:', err)
    }
  }, [editor, uploadUrl])

  const handleImageUpload = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type.startsWith('image/')) {
      uploadAndInsertImage(file)
    }
    e.target.value = ''
  }, [uploadAndInsertImage])

  if (!editor) return null

  return (
    <div className="border rounded-md overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1 bg-muted/30 border-b flex-wrap">
        <TBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
          <Bold className="h-3.5 w-3.5" />
        </TBtn>
        <TBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
          <Italic className="h-3.5 w-3.5" />
        </TBtn>
        <TBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strike">
          <Strikethrough className="h-3.5 w-3.5" />
        </TBtn>
        <Sep />
        <TBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading">
          <Heading2 className="h-3.5 w-3.5" />
        </TBtn>
        <TBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Subheading">
          <Heading3 className="h-3.5 w-3.5" />
        </TBtn>
        <Sep />
        <TBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">
          <List className="h-3.5 w-3.5" />
        </TBtn>
        <TBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Ordered list">
          <ListOrdered className="h-3.5 w-3.5" />
        </TBtn>
        <TBtn onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive('taskList')} title="Task list">
          <CheckSquare className="h-3.5 w-3.5" />
        </TBtn>
        <Sep />
        <TBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Quote">
          <Quote className="h-3.5 w-3.5" />
        </TBtn>
        <TBtn onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')} title="Code block">
          <Code2 className="h-3.5 w-3.5" />
        </TBtn>
        <Sep />
        <TBtn onClick={handleImageUpload} active={false} title="Upload image">
          <ImageIcon className="h-3.5 w-3.5" />
        </TBtn>
        <TBtn
          onClick={() => {
            const url = window.prompt('Enter URL:')
            if (url) editor.chain().focus().setLink({ href: url }).run()
          }}
          active={editor.isActive('link')}
          title="Insert link"
        >
          <LinkIcon className="h-3.5 w-3.5" />
        </TBtn>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
        <div className="flex-1" />
        <span className="text-[10px] text-muted-foreground">Ctrl+Enter to send</span>
      </div>
      {/* Editor */}
      <EditorContent editor={editor} />
    </div>
  )
}

function TBtn({ onClick, active, title, children }: { onClick: () => void; active: boolean; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1 rounded transition-colors ${
        active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

function Sep() {
  return <div className="w-px h-4 bg-border mx-0.5" />
}
