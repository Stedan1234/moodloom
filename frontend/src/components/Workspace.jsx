import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Placeholder from '@tiptap/extension-placeholder';
import { api } from '../api';

// Palette for text/title color — deliberately small and legible on white, not
// a full picker. "Default" removes the color again.
const TEXT_COLORS = [
  { name: 'Ink', value: '#111827' },
  { name: 'Red', value: '#dc2626' },
  { name: 'Orange', value: '#ea580c' },
  { name: 'Green', value: '#16a34a' },
  { name: 'Blue', value: '#2563eb' },
  { name: 'Purple', value: '#9333ea' },
  { name: 'Grey', value: '#6b7280' },
];

// Notes used to be saved as plain text (the v1 textarea). Anything that
// doesn't look like HTML is treated as that old format and converted, so
// existing notes open intact instead of as one collapsed line.
function toEditorContent(saved) {
  if (!saved) return '';
  if (/^\s*</.test(saved)) return saved;
  const escaped = saved.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped
    .split('\n')
    .map((line) => `<p>${line}</p>`)
    .join('');
}

function ToolbarButton({ active, onClick, title, children, disabled }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      // mousedown (not click) + preventDefault keeps the text selection alive;
      // a normal click would blur the editor before the command runs.
      onMouseDown={(e) => {
        e.preventDefault();
        if (!disabled) onClick();
      }}
      className={`min-w-7 h-7 px-1.5 rounded text-sm flex items-center justify-center disabled:opacity-30 ${
        active ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
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
  });
  const run = () => editor.chain().focus();

  return (
    <div className="flex flex-wrap items-center gap-0.5 border border-b-0 border-gray-200 rounded-t px-1.5 py-1 bg-gray-50">
      <ToolbarButton title="Title" active={state.h1} onClick={() => run().toggleHeading({ level: 1 }).run()}>
        <span className="font-semibold">H1</span>
      </ToolbarButton>
      <ToolbarButton title="Heading" active={state.h2} onClick={() => run().toggleHeading({ level: 2 }).run()}>
        <span className="font-semibold">H2</span>
      </ToolbarButton>
      <ToolbarButton title="Subheading" active={state.h3} onClick={() => run().toggleHeading({ level: 3 }).run()}>
        <span className="font-semibold">H3</span>
      </ToolbarButton>
      <span className="w-px h-4 bg-gray-300 mx-1" />
      <ToolbarButton title="Bold" active={state.bold} onClick={() => run().toggleBold().run()}>
        <span className="font-bold">B</span>
      </ToolbarButton>
      <ToolbarButton title="Italic" active={state.italic} onClick={() => run().toggleItalic().run()}>
        <span className="italic">I</span>
      </ToolbarButton>
      <ToolbarButton title="Underline" active={state.underline} onClick={() => run().toggleUnderline().run()}>
        <span className="underline">U</span>
      </ToolbarButton>
      <ToolbarButton title="Strikethrough" active={state.strike} onClick={() => run().toggleStrike().run()}>
        <span className="line-through">S</span>
      </ToolbarButton>
      <ToolbarButton title="Highlight" active={state.highlight} onClick={() => run().toggleHighlight().run()}>
        <span className="bg-yellow-200 px-0.5">A</span>
      </ToolbarButton>
      <span className="w-px h-4 bg-gray-300 mx-1" />
      <ToolbarButton title="Bulleted list" active={state.bullet} onClick={() => run().toggleBulletList().run()}>
        •
      </ToolbarButton>
      <ToolbarButton title="Numbered list" active={state.ordered} onClick={() => run().toggleOrderedList().run()}>
        1.
      </ToolbarButton>
      <ToolbarButton title="Quote" active={state.quote} onClick={() => run().toggleBlockquote().run()}>
        ❝
      </ToolbarButton>
      <span className="w-px h-4 bg-gray-300 mx-1" />
      {TEXT_COLORS.map((c) => (
        <button
          key={c.value}
          type="button"
          title={`Text color: ${c.name}`}
          onMouseDown={(e) => {
            e.preventDefault();
            run().setColor(c.value).run();
          }}
          className={`w-4 h-4 rounded-full border ${
            state.color === c.value ? 'ring-2 ring-offset-1 ring-gray-400' : 'border-white'
          }`}
          style={{ backgroundColor: c.value }}
        />
      ))}
      <ToolbarButton title="Remove color" onClick={() => run().unsetColor().run()}>
        <span className="text-xs">✕</span>
      </ToolbarButton>
      <span className="w-px h-4 bg-gray-300 mx-1" />
      <ToolbarButton title="Undo" disabled={!state.canUndo} onClick={() => run().undo().run()}>
        ↶
      </ToolbarButton>
      <ToolbarButton title="Redo" disabled={!state.canRedo} onClick={() => run().redo().run()}>
        ↷
      </ToolbarButton>
    </div>
  );
}

// Rich-text notes living next to the board: titles/headings, bold/italic/
// underline, highlights, colors, lists, quotes. Still deliberately NOT a
// sketching canvas — that remains a v2 undertaking (see mvp-scope.md).
// Saved as HTML in the same workspace_notes.content column; Tiptap only ever
// loads it through its own schema, which drops anything it doesn't know
// (scripts, event handlers), so stored content can't inject markup.
export default function Workspace({ projectId }) {
  const [status, setStatus] = useState('idle'); // idle | saving | saved | error
  const debounceRef = useRef(null);
  const loadedRef = useRef(false); // don't autosave the initial load as an "edit"

  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      Highlight,
      Placeholder.configure({
        placeholder: 'Write notes, direction, ideas — right next to your references.',
      }),
    ],
    content: '',
    editorProps: {
      attributes: { class: 'workspace-prose focus:outline-none min-h-full' },
    },
    onUpdate({ editor: e }) {
      if (!loadedRef.current) return;
      setStatus('saving');
      clearTimeout(debounceRef.current);
      const html = e.isEmpty ? '' : e.getHTML();
      debounceRef.current = setTimeout(async () => {
        try {
          await api.saveWorkspace(projectId, html);
          setStatus('saved');
        } catch {
          setStatus('error');
        }
      }, 600);
    },
  });

  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    loadedRef.current = false;
    api.getWorkspace(projectId).then((data) => {
      if (cancelled) return;
      editor.commands.setContent(toEditorContent(data.content), { emitUpdate: false });
      loadedRef.current = true;
    });
    return () => {
      cancelled = true;
      clearTimeout(debounceRef.current);
    };
  }, [projectId, editor]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium text-gray-700">Workspace</h2>
        <span className="text-xs text-gray-400">
          {status === 'saving'
            ? 'Saving…'
            : status === 'saved'
              ? 'Saved'
              : status === 'error'
                ? "Couldn't save — retrying on next edit"
                : ''}
        </span>
      </div>
      {editor && <Toolbar editor={editor} />}
      <div
        className="flex-1 min-h-0 overflow-y-auto border border-gray-200 rounded-b p-3 text-sm cursor-text"
        onClick={() => editor?.chain().focus().run()}
      >
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  );
}
