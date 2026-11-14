import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle, Color } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import Placeholder from '@tiptap/extension-placeholder'
import { Bold, ChevronsLeft, Heading1, Heading2, Highlighter, Italic, List, ListOrdered, Minus, Redo2, Strikethrough, TextQuote, Underline, Undo2 } from 'lucide-react'
import { api } from '../api'
import { THREADS } from '../lib/util'

// Notes written before rich text existed are plain text. Anything that
// doesn't look like markup is converted to paragraphs on the way in.
export function toEditorContent(saved) {
  if (!saved) return ''
  if (/^\s*</.test(saved)) return saved
  const escaped = saved.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escaped
    .split('\n')
    .map((line) => `<p>${line}</p>`)
    .join('')
}

const EXTENSIONS = [StarterKit.configure({ link: { openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] } }), TextStyle, Color, Highlight]

function Tool({ active, onClick, title, children, disabled }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      // mousedown, not click: a click would blur the editor and drop the selection first.
      onMouseDown={(e) => {
        e.preventDefault()
        if (!disabled) onClick()
      }}
      className={`w-8 h-8 rounded-md grid place-items-center disabled:opacity-30 ${active ? 'bg-spruce text-paper' : 'text-mute hover:bg-ink/7 hover:text-ink'}`}
    >
      {children}
    </button>
  )
}

function Toolbar({ editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      highlight: e.isActive('highlight'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      color: e.getAttributes('textStyle').color || null,
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })
  const run = () => editor.chain().focus()
  const sep = <span className="w-px h-5 bg-line mx-1 shrink-0" />
  return (
    <div className="flex flex-wrap items-center gap-0.5 px-3 py-1.5 border-b border-line">
      <Tool title="Title" active={s.h1} onClick={() => run().toggleHeading({ level: 1 }).run()}><Heading1 size={17} /></Tool>
      <Tool title="Heading" active={s.h2} onClick={() => run().toggleHeading({ level: 2 }).run()}><Heading2 size={17} /></Tool>
      {sep}
      <Tool title="Bold" active={s.bold} onClick={() => run().toggleBold().run()}><Bold size={16} /></Tool>
      <Tool title="Italic" active={s.italic} onClick={() => run().toggleItalic().run()}><Italic size={16} /></Tool>
      <Tool title="Underline" active={s.underline} onClick={() => run().toggleUnderline().run()}><Underline size={16} /></Tool>
      <Tool title="Strikethrough" active={s.strike} onClick={() => run().toggleStrike().run()}><Strikethrough size={16} /></Tool>
      <Tool title="Highlight" active={s.highlight} onClick={() => run().toggleHighlight().run()}><Highlighter size={16} /></Tool>
      {sep}
      <Tool title="Bulleted list" active={s.bullet} onClick={() => run().toggleBulletList().run()}><List size={17} /></Tool>
      <Tool title="Numbered list" active={s.ordered} onClick={() => run().toggleOrderedList().run()}><ListOrdered size={17} /></Tool>
      <Tool title="Quote" active={s.quote} onClick={() => run().toggleBlockquote().run()}><TextQuote size={17} /></Tool>
      <Tool title="Divider" onClick={() => run().setHorizontalRule().run()}><Minus size={17} /></Tool>
      {sep}
      <span className="flex items-center gap-1 px-1" role="group" aria-label="Text colour">
        <button
          type="button"
          title="Default colour"
          aria-label="Default text colour"
          onMouseDown={(e) => { e.preventDefault(); run().unsetColor().run() }}
          className={`w-4.5 h-4.5 rounded-full bg-ink ${!s.color ? 'ring-2 ring-offset-2 ring-offset-paper ring-ink/40' : ''}`}
        />
        {THREADS.slice(0, 6).map((t) => (
          <button
            key={t.hex}
            type="button"
            title={`Colour: ${t.name}`}
            aria-label={`Text colour ${t.name}`}
            onMouseDown={(e) => { e.preventDefault(); run().setColor(t.hex).run() }}
            className={`w-4.5 h-4.5 rounded-full ${s.color === t.hex ? 'ring-2 ring-offset-2 ring-offset-paper ring-ink/40' : ''}`}
            style={{ background: t.hex }}
          />
        ))}
      </span>
      {sep}
      <Tool title="Undo" disabled={!s.canUndo} onClick={() => run().undo().run()}><Undo2 size={16} /></Tool>
      <Tool title="Redo" disabled={!s.canRedo} onClick={() => run().redo().run()}><Redo2 size={16} /></Tool>
    </div>
  )
}

// The notes that sit beside the board. Saved as HTML; only ever loaded back
// through the editor's schema, which keeps the marks it knows and drops
// everything else (scripts, event handlers, unknown tags).
export default function Notes({ projectId, canEdit, wide, onClose }) {
  const [status, setStatus] = useState('idle')
  const timer = useRef(null)
  const loaded = useRef(false)
  const pending = useRef(null)

  const editor = useEditor({
    extensions: [...EXTENSIONS, Placeholder.configure({ placeholder: 'What is this project about? What did the client actually say? What are you noticing on the wall?' })],
    editable: canEdit,
    content: '',
    editorProps: { attributes: { class: 'prose-notes min-h-full', 'aria-label': 'Project notes' } },
    onUpdate({ editor: e }) {
      if (!loaded.current) return
      setStatus('saving')
      clearTimeout(timer.current)
      const html = e.isEmpty ? '' : e.getHTML()
      pending.current = html
      timer.current = setTimeout(() => save(html), 700)
    },
  })

  async function save(html) {
    try {
      await api.saveNotes(projectId, html)
      if (pending.current === html) pending.current = null
      setStatus('saved')
    } catch {
      setStatus('error')
    }
  }

  useEffect(() => {
    if (!editor) return
    let live = true
    loaded.current = false
    api
      .notes(projectId)
      .then((data) => {
        if (!live) return
        editor.commands.setContent(toEditorContent(data.content), { emitUpdate: false })
        loaded.current = true
      })
      .catch(() => live && setStatus('error'))
    return () => {
      live = false
      // Leaving with an edit still waiting: send it now rather than lose it.
      clearTimeout(timer.current)
      if (pending.current !== null) api.saveNotes(projectId, pending.current).catch(() => {})
    }
  }, [projectId, editor])

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1.5">
        <div className="flex items-center gap-1">
          {onClose && (
            <button className="btn btn-quiet btn-icon -ml-2" onClick={onClose} title="Show the board again" aria-label="Show the board again">
              <ChevronsLeft size={17} className="rotate-180" />
            </button>
          )}
          <h2 className="text-[1.05rem]">Notes</h2>
        </div>
        <span className="text-xs text-mute" aria-live="polite">
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : status === 'error' ? 'Not saved. Check your connection; the next edit tries again.' : ''}
        </span>
      </div>
      {editor && canEdit && <Toolbar editor={editor} />}
      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin cursor-text" onClick={() => canEdit && !editor?.isFocused && editor?.chain().focus().run()}>
        <div className={`px-4 py-4 min-h-full ${wide ? 'max-w-[46rem] mx-auto text-[1.02rem]' : ''}`}>
          <EditorContent editor={editor} className="h-full" />
        </div>
      </div>
    </div>
  )
}

// Read-only rendering of saved notes (the shared page). Goes through the
// same schema, so stored markup can't carry anything executable.
export function NotesView({ content }) {
  const editor = useEditor({ extensions: EXTENSIONS, editable: false, content: toEditorContent(content), editorProps: { attributes: { class: 'prose-notes' } } })
  return <EditorContent editor={editor} />
}
