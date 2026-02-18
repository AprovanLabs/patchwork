import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import { Markdown } from 'tiptap-markdown';
import { TextSelection } from '@tiptap/pm/state';
import { useEffect, useCallback, useRef } from 'react';
import { CodeBlockExtension } from './CodeBlockExtension';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  onSubmit,
  placeholder = 'Type a message...',
  disabled = false,
  className = '',
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        bulletList: { keepMarks: true, keepAttributes: false },
        orderedList: { keepMarks: true, keepAttributes: false },
        codeBlock: false, // Use our custom CodeBlockExtension
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
        horizontalRule: false,
        hardBreak: { keepMarks: false },
      }),
      CodeBlockExtension,
      Placeholder.configure({
        placeholder,
        emptyEditorClass: 'is-editor-empty',
      }),
      Typography,
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: value,
    editable: !disabled,
    editorProps: {
      attributes: {
        class: `outline-none min-h-[40px] max-h-[200px] overflow-y-auto px-3 py-2 ${className}`,
      },
      handleKeyDown: (view, event) => {
        const { state } = view;
        const { selection } = state;
        const { $from, $to, empty } = selection;

        const parentType = $from.parent.type.name;
        const isInList = parentType === 'listItem';
        const isInCodeBlock = parentType === 'codeBlock';

        // Cmd/Ctrl+A in code block: select just the code block content
        if ((event.metaKey || event.ctrlKey) && event.key === 'a' && isInCodeBlock) {
          event.preventDefault();
          const { tr } = state;
          tr.setSelection(TextSelection.create(tr.doc, $from.start(), $from.end()));
          view.dispatch(tr);
          return true;
        }

        // ArrowUp at first line of code block: focus language input
        if (event.key === 'ArrowUp' && isInCodeBlock) {
          const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
          if (!textBefore.includes('\n')) {
            const domPos = view.domAtPos($from.start());
            const wrapper = domPos.node.parentElement?.closest('.code-block-wrapper');
            const langInput = wrapper?.querySelector('.language-input') as HTMLInputElement;
            if (langInput) {
              event.preventDefault();
              langInput.focus();
              langInput.select();
              return true;
            }
          }
        }

        // Tab handling in code blocks
        if (event.key === 'Tab' && isInCodeBlock) {
          event.preventDefault();
          const { tr } = state;

          if (empty) {
            if (event.shiftKey) {
              const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
              if (textBefore.endsWith('  ')) {
                tr.delete($from.pos - 2, $from.pos);
              } else if (textBefore.endsWith(' ')) {
                tr.delete($from.pos - 1, $from.pos);
              }
            } else {
              tr.insertText('  ');
            }
          } else {
            const text = $from.parent.textContent;
            const lineStart = text.lastIndexOf('\n', $from.parentOffset - 1) + 1;
            const lineEnd = text.indexOf('\n', $to.parentOffset);
            const actualEnd = lineEnd === -1 ? text.length : lineEnd;
            const selectedText = text.slice(lineStart, actualEnd);
            const lines = selectedText.split('\n');

            const newText = event.shiftKey
              ? lines.map(line => line.replace(/^  ?/, '')).join('\n')
              : lines.map(line => '  ' + line).join('\n');

            const blockStart = $from.start();
            tr.replaceWith(blockStart + lineStart, blockStart + actualEnd, state.schema.text(newText));
          }

          view.dispatch(tr);
          return true;
        }

        // Enter key handling
        if (event.key === 'Enter') {
          if (isInCodeBlock) {
            if (event.shiftKey) {
              event.preventDefault();
              const { tr } = state;
              tr.insertText('\n');
              view.dispatch(tr);
              return true;
            }
            event.preventDefault();
            onSubmit();
            return true;
          }

          // Shift+Enter: create new paragraph (enables input rules on new lines)
          if (event.shiftKey) {
            event.preventDefault();
            const { tr } = state;
            view.dispatch(tr.split($from.pos));
            return true;
          }

          // Regular Enter: submit (unless in list)
          if (!isInList) {
            event.preventDefault();
            onSubmit();
            return true;
          }
        }

        return false;
      },
    },
    onUpdate: ({ editor }) => {
      // Get markdown output from tiptap-markdown extension
      const markdownStorage = (editor.storage as any).markdown;
      if (markdownStorage?.getMarkdown) {
        onChange(markdownStorage.getMarkdown());
      } else {
        onChange(editor.getText());
      }
    },
  });

  // Handle paste - prefer plain text to avoid VS Code HTML wrapping
  useEffect(() => {
    if (!editor) return;

    const handlePaste = (event: ClipboardEvent) => {
      const plainText = event.clipboardData?.getData('text/plain');
      const htmlText = event.clipboardData?.getData('text/html');

      if (!plainText) return;

      const { $from } = editor.state.selection;
      const isInCodeBlock = $from.parent.type.name === 'codeBlock';

      // In code blocks, always paste as plain text
      if (isInCodeBlock) {
        event.preventDefault();
        event.stopPropagation();
        const { tr } = editor.state;
        tr.insertText(plainText);
        editor.view.dispatch(tr);
        return;
      }

      // Outside code blocks: intercept HTML to parse as markdown
      if (htmlText) {
        event.preventDefault();
        event.stopPropagation();

        const markdownStorage = (editor.storage as any).markdown;
        if (markdownStorage?.parser) {
          try {
            const parsed = markdownStorage.parser.parse(plainText);
            if (parsed?.content?.size > 0) {
              const nodes: any[] = [];
              parsed.content.forEach((node: any) => nodes.push(node.toJSON()));
              editor.chain().focus().insertContent(nodes).run();
              return;
            }
          } catch (e) {
            console.warn('Markdown parse failed, falling back to plain text', e);
          }
        }

        editor.chain().focus().insertContent(plainText).run();
      }
    };

    const container = containerRef.current;
    container?.addEventListener('paste', handlePaste, { capture: true });
    return () => container?.removeEventListener('paste', handlePaste, { capture: true });
  }, [editor]);

  // Clear content when value is reset externally
  useEffect(() => {
    if (editor && value === '' && editor.getText() !== '') {
      editor.commands.clearContent();
    }
  }, [editor, value]);

  // Update editable state
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  const focus = useCallback(() => {
    editor?.commands.focus();
  }, [editor]);

  useEffect(() => {
    if (editor) {
      (editor as any).focusInput = focus;
    }
  }, [editor, focus]);

  return (
    <div
      ref={containerRef}
      className={`
        flex-1 rounded-md border border-input bg-background text-sm
        ring-offset-background
        focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2
        ${disabled ? 'cursor-not-allowed opacity-50' : ''}
      `}
      onClick={() => editor?.commands.focus()}
    >
      <EditorContent editor={editor} className="markdown-editor" />
    </div>
  );
}
