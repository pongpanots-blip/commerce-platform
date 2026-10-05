import { useEffect, type ReactNode } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { Extension } from '@tiptap/core';

const INDENT_STEP_EM = 2;
const INDENT_MAX = 3;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      indent: () => ReturnType;
      outdent: () => ReturnType;
    };
  }
}

/** Paragraph first-line indent as `text-indent: {level * 2}em` — Tab/Shift-Tab in the editor, mirrors list sink/lift. */
const Indent = Extension.create({
  name: 'indent',
  // Keymaps run in priority order; without this, StarterKit's Backspace
  // (joinBackward) wins at paragraph start and the indent never outdents.
  priority: 1000,
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => {
              // Legacy saved content used margin-left for indent; text-indent takes priority.
              const raw = element.style.textIndent || element.style.marginLeft;
              const match = /(\d+(?:\.\d+)?)em/.exec(raw);
              if (!match) return 0;
              const level = Math.round(Number(match[1]) / INDENT_STEP_EM);
              return Math.min(INDENT_MAX, Math.max(0, level));
            },
            renderHTML: (attributes) => {
              const level = attributes.indent as number;
              if (!level) return {};
              return { style: `text-indent: ${level * INDENT_STEP_EM}em` };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    const changeIndent = (delta: number) => () => ({ editor, commands }: { editor: any; commands: any }) => {
      if (!editor.isActive('paragraph')) return false;
      const current = (editor.getAttributes('paragraph').indent as number) ?? 0;
      const next = Math.min(INDENT_MAX, Math.max(0, current + delta));
      return commands.updateAttributes('paragraph', { indent: next });
    };
    return {
      indent: changeIndent(1),
      outdent: changeIndent(-1),
    } as any;
  },
  addKeyboardShortcuts() {
    return {
      // Always return true: sink/lift can be a no-op (first item of a list),
      // but Tab must never move focus out of the editor either way.
      Tab: ({ editor }) => {
        if (editor.isActive('listItem')) editor.chain().focus().sinkListItem('listItem').run();
        else editor.chain().focus().indent().run();
        return true;
      },
      'Shift-Tab': ({ editor }) => {
        if (editor.isActive('listItem')) editor.chain().focus().liftListItem('listItem').run();
        else editor.chain().focus().outdent().run();
        return true;
      },
      // Standard editor behavior: Backspace at the very start of an indented paragraph
      // outdents one level instead of joining/deleting. Any other case (mid-line, text
      // selected, indent already 0) falls through to ProseMirror's default Backspace.
      Backspace: ({ editor }) => {
        const { selection } = editor.state;
        if (!selection.empty) return false;
        const { $from } = selection;
        if ($from.parent.type.name !== 'paragraph') return false;
        if ($from.parentOffset !== 0) return false;
        const indent = ($from.parent.attrs.indent as number) ?? 0;
        if (indent <= 0) return false;
        editor.chain().focus().outdent().run();
        return true;
      },
    };
  },
});

// Module-level: shared across every editor instance on the page (up to ~30 sections).
// Headings are intentionally not offered here — section titles are separate inputs
// (see LegalDocsPage.tsx); h3/h4 stay in the backend allowlist and renderer CSS only
// so already-saved content with headings keeps rendering.
const EXTENSIONS = [
  StarterKit.configure({ heading: false, link: false }),
  TextAlign.configure({ types: ['paragraph'], alignments: ['left', 'center', 'right'] }),
  Indent,
];

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Legacy sections stored plain text (pre-editor data); `\n` = paragraph break. */
export function legacyBodyToHtml(body: string): string {
  if (/<\/?(p|br|strong|b|em|i|u|s|h3|h4|ol|ul|li)\b/i.test(body)) return body;
  return body
    .split('\n')
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
}

/** True if editor HTML has no visible content — e.g. `''`, `<p></p>`, `<p><br></p>`. */
export function isRichTextEmpty(html: string): boolean {
  return !html.replace(/<[^>]*>/g, '').trim();
}

const TOOLBAR_BUTTON_CLASS = 'rounded border px-1.5 py-0.5 text-xs font-medium';
const TOOLBAR_BUTTON_ACTIVE = 'border-gray-900 bg-gray-900 text-white';
const TOOLBAR_BUTTON_INACTIVE = 'border-gray-200 text-gray-600 hover:bg-gray-50';

/** 4 text-line bars, positioned per alignment. viewBox 0 0 14 14. */
const ALIGN_ROW_WIDTHS = [12, 8, 12, 6];
const ALIGN_ROW_Y = [1, 4.5, 8, 11.5];

function AlignIcon({ align }: { align: 'left' | 'center' | 'right' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      {ALIGN_ROW_WIDTHS.map((w, i) => {
        const x = align === 'left' ? 1 : align === 'right' ? 13 - w : (14 - w) / 2;
        return <rect key={i} x={x} y={ALIGN_ROW_Y[i]} width={w} height={1.5} rx={0.5} />;
      })}
    </svg>
  );
}

function IndentIcon({ direction }: { direction: 'increase' | 'decrease' }) {
  const arrow = direction === 'increase' ? '8,4.5 11,7 8,9.5' : '11,4.5 8,7 11,9.5';
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="1" y1="2" x2="13" y2="2" />
      <line x1="1" y1="7" x2="5.5" y2="7" />
      <polyline points={arrow} />
      <line x1="1" y1="12" x2="13" y2="12" />
    </svg>
  );
}

const SEGMENT_BUTTON_CLASS = 'px-1.5 py-0.5';
const SEGMENT_BUTTON_ACTIVE = 'bg-gray-900 text-white';
const SEGMENT_BUTTON_INACTIVE = 'text-gray-600 hover:bg-gray-50';

function SegmentButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      // keep focus (and the current selection) in the editor when clicking a toolbar button
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`${SEGMENT_BUTTON_CLASS} ${active ? SEGMENT_BUTTON_ACTIVE : SEGMENT_BUTTON_INACTIVE}`}
    >
      {children}
    </button>
  );
}

function ToolbarButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      // keep focus (and the current selection) in the editor when clicking a toolbar button
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`${TOOLBAR_BUTTON_CLASS} ${active ? TOOLBAR_BUTTON_ACTIVE : TOOLBAR_BUTTON_INACTIVE}`}
    >
      {label}
    </button>
  );
}

export function RichTextEditor({
  value,
  onChange,
  invalid,
  disabled,
  ariaLabel,
}: {
  value: string;
  onChange: (html: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const editor = useEditor({
    extensions: EXTENSIONS,
    content: legacyBodyToHtml(value),
    editorProps: { attributes: { 'aria-label': ariaLabel } },
    shouldRerenderOnTransaction: false,
    // Legal copy is full of manual outline numbers ("2.", "2.1 …") — without this,
    // typing "2. " at line start auto-converts into an <ol> and hijacks the text.
    // Lists are still available from the toolbar; markdown-style shortcuts are not.
    enableInputRules: false,
    onUpdate: ({ editor }) => {
      const html = editor.isEmpty ? '' : editor.getHTML();
      // tiptap can fire `onUpdate` right around editor creation even with no real edit (e.g.
      // content normalisation) — skip a no-op change so it can't propagate a spurious "changed"
      // event (a real edit always produces HTML that differs from the still-unedited `value`).
      if (html === value) return;
      onChange(html);
    },
  });

  // External updates (auto-translate result) — only push in while the user isn't typing here.
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const currentHtml = editor.isEmpty ? '' : editor.getHTML();
    if (value === currentHtml) return;
    editor.commands.setContent(legacyBodyToHtml(value), { emitUpdate: false });
  }, [value, editor]);

  // Lock the editor while a translation is in flight so typing can't race the write-back.
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  const activeState = useEditorState({
    editor,
    selector: (ctx) =>
      ctx.editor
        ? {
            bold: ctx.editor.isActive('bold'),
            italic: ctx.editor.isActive('italic'),
            underline: ctx.editor.isActive('underline'),
            strike: ctx.editor.isActive('strike'),
            ol: ctx.editor.isActive('orderedList'),
            ul: ctx.editor.isActive('bulletList'),
            alignCenter: ctx.editor.isActive({ textAlign: 'center' }),
            alignRight: ctx.editor.isActive({ textAlign: 'right' }),
          }
        : null,
  });

  if (!editor) return null;

  return (
    <div>
      <div className="mb-1 flex flex-wrap gap-1">
        <ToolbarButton
          active={!!activeState?.bold}
          onClick={() => editor.chain().focus().toggleBold().run()}
          label="B"
        />
        <ToolbarButton
          active={!!activeState?.italic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          label="I"
        />
        <ToolbarButton
          active={!!activeState?.underline}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          label="U"
        />
        <ToolbarButton
          active={!!activeState?.strike}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          label="S"
        />
        <ToolbarButton
          active={!!activeState?.ol}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          label="1."
        />
        <ToolbarButton
          active={!!activeState?.ul}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          label="•"
        />
        {/* Left is the default state, so it never lights up "stuck" — center/right
            highlight while set, and clicking the active one toggles back to normal. */}
        <div className="inline-flex overflow-hidden rounded border border-gray-200 divide-x divide-gray-200">
          <SegmentButton
            active={false}
            onClick={() => editor.chain().focus().unsetTextAlign().run()}
            title="จัดชิดซ้าย (ค่าปกติ)"
          >
            <AlignIcon align="left" />
          </SegmentButton>
          <SegmentButton
            active={!!activeState?.alignCenter}
            onClick={() =>
              activeState?.alignCenter
                ? editor.chain().focus().unsetTextAlign().run()
                : editor.chain().focus().setTextAlign('center').run()
            }
            title="จัดกึ่งกลาง (กดซ้ำเพื่อยกเลิก)"
          >
            <AlignIcon align="center" />
          </SegmentButton>
          <SegmentButton
            active={!!activeState?.alignRight}
            onClick={() =>
              activeState?.alignRight
                ? editor.chain().focus().unsetTextAlign().run()
                : editor.chain().focus().setTextAlign('right').run()
            }
            title="จัดชิดขวา (กดซ้ำเพื่อยกเลิก)"
          >
            <AlignIcon align="right" />
          </SegmentButton>
        </div>
        <div className="inline-flex overflow-hidden rounded border border-gray-200 divide-x divide-gray-200">
          <SegmentButton
            active={false}
            onClick={() => editor.chain().focus().indent().run()}
            title="ย่อหน้าบรรทัดแรก (Tab)"
          >
            <IndentIcon direction="increase" />
          </SegmentButton>
          <SegmentButton
            active={false}
            onClick={() => editor.chain().focus().outdent().run()}
            title="ถอยย่อหน้าบรรทัดแรก (Shift+Tab / Backspace ต้นบรรทัด)"
          >
            <IndentIcon direction="decrease" />
          </SegmentButton>
        </div>
      </div>
      <div
        className={`legal-editor rounded-lg border bg-white px-3 py-2 focus-within:border-primary ${
          invalid ? 'border-red-300' : 'border-gray-200'
        }`}
      >
        <EditorContent editor={editor} className="text-sm text-gray-700" />
      </div>
    </div>
  );
}
