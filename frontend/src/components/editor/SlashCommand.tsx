import { useEffect, useRef, useState, forwardRef, useImperativeHandle, useCallback } from 'react'
import type { Editor, Range } from '@tiptap/core'
import type { SlashCommandItem } from './SlashCommandExtension'
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Code2,
  Quote,
  TableIcon,
  ImageIcon,
  Minus,
  Info,
} from '@/lib/icons'

export function getSlashCommandItems(query: string): SlashCommandItem[] {
  const items: SlashCommandItem[] = [
    {
      title: 'Heading 1',
      description: 'Large section heading',
      icon: 'heading-1',
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run()
      },
    },
    {
      title: 'Heading 2',
      description: 'Medium section heading',
      icon: 'heading-2',
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run()
      },
    },
    {
      title: 'Heading 3',
      description: 'Small section heading',
      icon: 'heading-3',
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run()
      },
    },
    {
      title: 'Bullet List',
      description: 'Create a bulleted list',
      icon: 'list',
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleBulletList().run()
      },
    },
    {
      title: 'Ordered List',
      description: 'Create a numbered list',
      icon: 'list-ordered',
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleOrderedList().run()
      },
    },
    {
      title: 'Task List',
      description: 'Create a checklist',
      icon: 'check-square',
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleTaskList().run()
      },
    },
    {
      title: 'Code Block',
      description: 'Insert a code block with syntax highlighting',
      icon: 'code',
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
      },
    },
    {
      title: 'Blockquote',
      description: 'Insert a blockquote',
      icon: 'quote',
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleBlockquote().run()
      },
    },
    {
      title: 'Table',
      description: 'Insert a 3x3 table',
      icon: 'table',
      command: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run()
      },
    },
    {
      title: 'Image',
      description: 'Insert an image from URL',
      icon: 'image',
      command: ({ editor, range }) => {
        const url = window.prompt('Enter image URL:')
        if (url) {
          editor.chain().focus().deleteRange(range).setImage({ src: url }).run()
        }
      },
    },
    {
      title: 'Horizontal Rule',
      description: 'Insert a horizontal divider',
      icon: 'minus',
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setHorizontalRule().run()
      },
    },
    {
      title: 'Callout',
      description: 'Insert an info callout block',
      icon: 'info',
      command: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent(
            '<div data-type="callout" class="callout callout-info"><p>Info callout content</p></div><p></p>'
          )
          .run()
      },
    },
  ]

  if (!query) return items

  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(query.toLowerCase()) ||
      item.description.toLowerCase().includes(query.toLowerCase())
  )
}

const iconMap: Record<string, React.ElementType> = {
  'heading-1': Heading1,
  'heading-2': Heading2,
  'heading-3': Heading3,
  'list': List,
  'list-ordered': ListOrdered,
  'check-square': CheckSquare,
  'code': Code2,
  'quote': Quote,
  'table': TableIcon,
  'image': ImageIcon,
  'minus': Minus,
  'info': Info,
}

export interface SlashCommandMenuRef {
  onKeyDown: (event: KeyboardEvent) => boolean
}

interface SlashCommandMenuProps {
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
  editor: Editor
  range: Range
}

export const SlashCommandMenu = forwardRef<SlashCommandMenuRef, SlashCommandMenuProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)
    const menuRef = useRef<HTMLDivElement>(null)

    const selectItem = useCallback(
      (index: number) => {
        const item = items[index]
        if (item) {
          command(item)
        }
      },
      [items, command]
    )

    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

    useEffect(() => {
      const menu = menuRef.current
      if (menu) {
        const selected = menu.children[selectedIndex] as HTMLElement
        selected?.scrollIntoView({ block: 'nearest' })
      }
    }, [selectedIndex])

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) => (prev + items.length - 1) % items.length)
          return true
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) => (prev + 1) % items.length)
          return true
        }
        if (event.key === 'Enter') {
          selectItem(selectedIndex)
          return true
        }
        if (event.key === 'Escape') {
          return true
        }
        return false
      },
    }))

    if (items.length === 0) {
      return (
        <div className="slash-command-menu">
          <div className="slash-command-empty">No results found</div>
        </div>
      )
    }

    return (
      <div className="slash-command-menu" ref={menuRef}>
        {items.map((item, index) => {
          const IconComponent = iconMap[item.icon]
          return (
            <button
              key={item.title}
              className={`slash-command-item ${index === selectedIndex ? 'is-selected' : ''}`}
              onClick={() => selectItem(index)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="slash-command-icon">
                {IconComponent ? <IconComponent className="h-4 w-4" /> : item.icon}
              </span>
              <span className="slash-command-text">
                <span className="slash-command-title">{item.title}</span>
                <span className="slash-command-desc">{item.description}</span>
              </span>
            </button>
          )
        })}
      </div>
    )
  }
)

SlashCommandMenu.displayName = 'SlashCommandMenu'
