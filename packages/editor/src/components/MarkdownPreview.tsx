import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Typography from '@tiptap/extension-typography';
import { Markdown } from 'tiptap-markdown';
import { useEffect, useCallback, useRef, useState } from 'react';
import { CodeBlockExtension } from './CodeBlockExtension';

function parseFrontmatter(content: string): { frontmatter: string; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: '', body: content };
  return { frontmatter: match[1], body: match[2] };
}

function assembleFrontmatter(frontmatter: string, body: string): string {
  if (!frontmatter.trim()) return body;
  return `---\n${frontmatter}\n---\n${body}`;
}

interface MarkdownPreviewProps {
  value: string;
  onChange?: (value: string) => void;
  editable?: boolean;
  className?: string;
}

export function MarkdownPreview({
  value,
  onChange,
  editable = false,
  className = '',
}: MarkdownPreviewProps) {
  const { frontmatter, body } = parseFrontmatter(value);
  const [fm, setFm] = useState(frontmatter);
  const fmRef = useRef(frontmatter);
  const bodyRef = useRef(body);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const parsed = parseFrontmatter(value);
    fmRef.current = parsed.frontmatter;
    bodyRef.current = parsed.body;
    setFm(parsed.frontmatter);
  }, [value]);

  const emitChange = useCallback(
    (newFm: string, newBody: string) => {
      onChange?.(assembleFrontmatter(newFm, newBody));
    },
    [onChange]
  );

  const handleFmChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newFm = e.target.value;
      setFm(newFm);
      fmRef.current = newFm;
      emitChange(newFm, bodyRef.current);
    },
    [emitChange]
  );

  // Auto-resize frontmatter textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [fm]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        bulletList: { keepMarks: true, keepAttributes: false },
        orderedList: { keepMarks: true, keepAttributes: false },
        codeBlock: false,
        code: {
          HTMLAttributes: {
            class: 'bg-muted rounded px-1 py-0.5 font-mono text-sm',
          },
        },
        blockquote: {
          HTMLAttributes: {
            class: 'border-l-4 border-muted-foreground/30 pl-4 italic',
          },
        },
        hardBreak: { keepMarks: false },
      }),
      CodeBlockExtension,
      Typography,
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: body,
    editable,
    editorProps: {
      attributes: {
        class: `outline-none ${className}`,
      },
    },
    onUpdate: ({ editor }) => {
      const markdownStorage = (editor.storage as any).markdown;
      const newBody = markdownStorage?.getMarkdown?.() ?? editor.getText();
      bodyRef.current = newBody;
      emitChange(fmRef.current, newBody);
    },
  });

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  // Sync external body changes
  useEffect(() => {
    if (!editor) return;
    const parsed = parseFrontmatter(value);
    const markdownStorage = (editor.storage as any).markdown;
    const current = markdownStorage?.getMarkdown?.() ?? editor.getText();
    if (parsed.body !== current) {
      editor.commands.setContent(parsed.body);
    }
  }, [editor, value]);

  return (
    <div className="markdown-preview">
      {frontmatter && (
        <div className="mb-4 rounded-md border border-border bg-muted/40 overflow-hidden">
          <div className="px-3 py-1.5 text-xs font-mono text-muted-foreground border-b border-border bg-muted/60 select-none">
            yml
          </div>
          <textarea
            ref={textareaRef}
            value={fm}
            onChange={handleFmChange}
            readOnly={!editable}
            className="w-full bg-transparent px-3 py-2 font-mono text-sm outline-none resize-none"
            spellCheck={false}
          />
        </div>
      )}
      <EditorContent editor={editor} className="markdown-editor" />
    </div>
  );
}
