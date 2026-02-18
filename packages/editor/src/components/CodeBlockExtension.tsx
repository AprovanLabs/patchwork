import { Node, textblockTypeInputRule } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react';
import { useCallback, useRef } from 'react';

const BACKTICK_INPUT_REGEX = /^```([a-z]*)?$/;

function CodeBlockComponent({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const focusCodeContent = useCallback(() => {
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos !== undefined) {
      editor.chain().focus().setTextSelection(pos + 1).run();
    }
  }, [editor, getPos]);

  const focusPreviousNode = useCallback(() => {
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos !== undefined && pos > 1) {
      const $pos = editor.state.doc.resolve(pos);
      if ($pos.nodeBefore) {
        editor.chain().focus().setTextSelection(pos - 1).run();
      } else {
        editor.chain().focus().setTextSelection(1).run();
      }
    }
  }, [editor, getPos]);

  const handleLanguageChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateAttributes({ language: e.target.value });
    },
    [updateAttributes]
  );

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
    switch (e.key) {
      case 'Enter':
      case 'ArrowDown':
        e.preventDefault();
        focusCodeContent();
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusPreviousNode();
        break;
      case 'Escape':
        e.preventDefault();
        focusCodeContent();
        break;
    }
  }, [focusCodeContent, focusPreviousNode]);

  const handleInputMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    focusInput();
  }, [focusInput]);

  return (
    <NodeViewWrapper className="code-block-wrapper my-2" data-type="codeBlock">
      <div className="language-input-wrapper flex items-center gap-1 mb-1" contentEditable={false}>
        <span className="text-xs text-muted-foreground select-none">```</span>
        <input
          ref={inputRef}
          type="text"
          value={(node.attrs.language as string) || ''}
          onChange={handleLanguageChange}
          onKeyDown={handleInputKeyDown}
          onKeyUp={(e) => e.stopPropagation()}
          onMouseDown={handleInputMouseDown}
          onClick={(e) => { e.stopPropagation(); focusInput(); }}
          onFocus={(e) => e.stopPropagation()}
          onBlur={(e) => e.stopPropagation()}
          placeholder="language"
          className="language-input bg-transparent text-xs text-muted-foreground outline-none border-none min-w-[60px] max-w-[120px] focus:ring-1 focus:ring-ring rounded px-1"
          style={{ width: `${Math.max(60, ((node.attrs.language as string)?.length || 8) * 7)}px` }}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
      </div>
      <pre className="bg-muted rounded-md px-3 py-2 font-mono text-sm overflow-x-auto !mt-0">
        <NodeViewContent as={'code' as any} />
      </pre>
    </NodeViewWrapper>
  );
}

export const CodeBlockExtension = Node.create({
  name: 'codeBlock',

  addOptions() {
    return {
      languageClassPrefix: 'language-',
      HTMLAttributes: {},
    };
  },

  content: 'text*',
  marks: '',
  group: 'block',
  code: true,
  defining: true,

  addAttributes() {
    return {
      language: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const { languageClassPrefix } = this.options;
          const classNames = [...(element.firstElementChild?.classList || [])];
          const languages = classNames
            .filter((className) => className.startsWith(languageClassPrefix))
            .map((className) => className.replace(languageClassPrefix, ''));
          return languages[0] || null;
        },
        rendered: false,
      },
    };
  },

  parseHTML() {
    return [{ tag: 'pre', preserveWhitespace: 'full' }];
  },

  renderHTML({ node, HTMLAttributes }: { node: any; HTMLAttributes: Record<string, any> }) {
    return [
      'pre',
      HTMLAttributes,
      [
        'code',
        {
          class: node.attrs.language
            ? this.options.languageClassPrefix + node.attrs.language
            : null,
        },
        0,
      ],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockComponent, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;
        return target.classList.contains('language-input') || 
               !!target.closest('.language-input-wrapper');
      },
    });
  },

  addInputRules() {
    return [
      textblockTypeInputRule({
        find: BACKTICK_INPUT_REGEX,
        type: this.type,
        getAttributes: (match: RegExpMatchArray) => ({
          language: match[1] || '',
        }),
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-c': () => this.editor.commands.toggleCodeBlock(),
      Backspace: () => {
        const { empty, $anchor } = this.editor.state.selection;
        const isAtStart = $anchor.pos === 1;

        if (!empty || $anchor.parent.type.name !== this.name) {
          return false;
        }

        if (isAtStart || !$anchor.parent.textContent.length) {
          return this.editor.commands.clearNodes();
        }

        return false;
      },
    };
  },
});
