import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState, useRef, useEffect, useMemo, useCallback, createContext, useContext } from 'react';
import {
  Send,
  Loader2,
  Wrench,
  AlertCircle,
  Brain,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { UIMessage } from 'ai';
import { createCompiler, type Compiler } from '@aprovan/patchwork-compiler';
import {
  extractCodeBlocks,
  CodePreview,
  MarkdownEditor,
  ServicesInspector,
  type ServiceInfo,
} from '@aprovan/patchwork-editor';

const APROVAN_LOGO =
  'https://raw.githubusercontent.com/AprovanLabs/aprovan.com/main/docs/assets/social-labs.png';

interface PatchworkContext {
  compiler: Compiler | null;
  namespaces: string[];
}

const PatchworkCtx = createContext<PatchworkContext>({ compiler: null, namespaces: [] });
const useCompiler = () => useContext(PatchworkCtx).compiler;
const useServices = () => useContext(PatchworkCtx).namespaces;

function TextPart({ text, isUser }: { text: string; isUser: boolean }) {
  const compiler = useCompiler();
  const services = useServices();

  if (isUser) {
    return (
      <div className="prose prose-sm prose-invert prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none">
        <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
      </div>
    );
  }

  const parts = extractCodeBlocks(text);

  return (
    <div className="prose prose-sm dark:prose-invert prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none">
      {parts.map((part, index) => {
        if (part.type === 'code') {
          return (
            <CodePreview
              key={index}
              code={part.content}
              compiler={compiler}
              services={services}
              filePath={part.attributes?.path}
            />
          );
        }
        return <Markdown key={index} remarkPlugins={[remarkGfm]}>{part.content}</Markdown>;
      })}
    </div>
  );
}

function ReasoningPart({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming?: boolean;
}) {
  return (
    <Collapsible defaultOpen={isStreaming}>
      <CollapsibleTrigger className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400 hover:opacity-80 w-full">
        <Brain className="h-4 w-4" />
        <span className="text-xs font-medium">Thinking</span>
        {isStreaming && <Loader2 className="h-3 w-3 animate-spin" />}
        <ChevronDown className="h-3 w-3 ml-auto transition-transform [[data-state=open]>&]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 p-3 rounded border-l-4 border-yellow-500 bg-yellow-50 dark:bg-yellow-950/50">
          <p className="text-sm text-muted-foreground italic whitespace-pre-wrap">
            {text}
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolPart({
  toolName,
  state,
  input,
  output,
  errorText,
}: {
  toolName: string;
  state: string;
  input: unknown;
  output?: unknown;
  errorText?: string;
}) {
  const isRunning = state === 'input-streaming' || state === 'input-available';
  const hasError = state === 'output-error';

  return (
    <Collapsible className="my-1 w-full">
      <CollapsibleTrigger className="inline-flex items-center gap-2 px-3 py-1 rounded-full border bg-muted/50 hover:bg-muted text-xs transition-colors">
        <Wrench className="h-3 w-3 text-muted-foreground" />
        <span className="font-mono">{toolName}</span>
        <span className="w-3 h-3 flex items-center justify-center">
          {isRunning && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
          {hasError && <AlertCircle className="h-3 w-3 text-destructive" />}
        </span>
        <ChevronDown className="h-3 w-3 text-muted-foreground transition-transform [[data-state=open]>&]:rotate-180" />
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-2 p-3 rounded-lg border bg-white space-y-2">
        {input !== undefined && (
          <div>
            <span className="text-xs font-medium text-muted-foreground">
              Input
            </span>
            <div className="mt-1 p-2 bg-muted/30 rounded text-xs overflow-auto max-h-48">
              <pre className="whitespace-pre-wrap break-words m-0">
                {typeof input === 'string'
                  ? input
                  : JSON.stringify(input, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {output !== undefined && (
          <div>
            <span className="text-xs font-medium text-muted-foreground">
              Output
            </span>
            <div className="mt-1 p-2 bg-muted/30 rounded text-xs overflow-auto max-h-48">
              <pre className="whitespace-pre-wrap break-words m-0">
                {typeof output === 'string'
                  ? output
                  : JSON.stringify(output, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {errorText && (
          <div className="text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="break-words">{errorText}</span>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';
  const isStreaming = message.parts?.some(
    (p) =>
      'state' in p &&
      (p.state === 'input-streaming' || p.state === 'input-available'),
  );

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <Avatar className="h-8 w-8 shrink-0">
          <img
            src={APROVAN_LOGO}
            alt="Assistant"
            className="rounded-full"
          />
          <AvatarFallback className="bg-primary text-primary-foreground">
            A
          </AvatarFallback>
        </Avatar>
      )}

      <div
        className={`flex flex-col gap-1 max-w-[80%] min-w-0 ${
          isUser ? 'items-end' : 'items-start'
        }`}
      >
        <div className="flex items-center gap-2 h-5">
          <span className="text-xs text-muted-foreground capitalize">
            {message.role}
          </span>
          {isStreaming && (
            <Badge
              variant="outline"
              className="text-xs"
            >
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              streaming
            </Badge>
          )}
        </div>

        <div
          className={`rounded-lg px-4 py-2 overflow-hidden w-full ${
            isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
          }`}
        >
          {message.parts?.map((part, i) => {
            if (part.type === 'text') {
              return (
                <TextPart
                  key={i}
                  text={part.text}
                  isUser={isUser}
                />
              );
            }

            if (part.type === 'reasoning') {
              return (
                <ReasoningPart
                  key={i}
                  text={part.text}
                  isStreaming={part.state === 'streaming'}
                />
              );
            }

            if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
              const toolPart = part as {
                type: string;
                toolName?: string;
                toolCallId: string;
                state: string;
                input?: unknown;
                output?: unknown;
                errorText?: string;
              };
              const toolName =
                toolPart.toolName ?? part.type.replace('tool-', '');
              return (
                <ToolPart
                  key={i}
                  toolName={toolName}
                  state={toolPart.state}
                  input={toolPart.input}
                  output={toolPart.output}
                  errorText={toolPart.errorText}
                />
              );
            }

            return null;
          })}
        </div>
      </div>

      {isUser && (
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarFallback className="bg-secondary">U</AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}

const PROXY_URL = '/api/proxy';
const IMAGE_SPEC = '@aprovan/patchwork-image-shadcn';
// Local proxy for loading image packages, esm.sh for widget imports
const IMAGE_CDN_URL = import.meta.env.DEV ? '/_local-packages' : 'https://esm.sh';
const WIDGET_CDN_URL = 'https://esm.sh'; // Widget imports need esm.sh bundles like @packagedcn

export default function ChatPage() {
  const [input, setInput] = useState('What\'s the weather in Houston, Texas like?');
  const [compiler, setCompiler] = useState<Compiler | null>(null);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Fetch available services
    fetch('/api/services')
      .then((res) => res.json())
      .then((data) => {
        setNamespaces(data.namespaces ?? []);
        // In dev mode, also store full service details for inspection
        if (import.meta.env.DEV && data.services) {
          setServices(data.services);
        }
      })
      .catch(() => {
        setNamespaces([]);
        setServices([]);
      });

    // Initialize compiler
    createCompiler({ 
      image: IMAGE_SPEC, 
      proxyUrl: PROXY_URL, 
      cdnBaseUrl: IMAGE_CDN_URL,
      widgetCdnBaseUrl: WIDGET_CDN_URL,
    })
      .then(setCompiler)
      .catch(console.error);
  }, []);

  const patchworkCtx = useMemo(() => ({ compiler, namespaces }), [compiler, namespaces]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        body: () => ({
          metadata: {
            patchwork: { compilers: [IMAGE_SPEC] },
          },
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, error } = useChat({ transport });

  const isLoading = status === 'submitted' || status === 'streaming';

  const handleSubmit = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim()) return;
    sendMessage({ text: input });
    setInput('');
  }, [input, sendMessage]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages]);

  return (
    <PatchworkCtx.Provider value={patchworkCtx}>
      <div className="flex flex-col h-screen max-w-4xl mx-auto p-4">
        <Card className="flex-1 flex flex-col min-h-0 overflow-hidden border">
          <CardHeader className="border-b py-3">
            <CardTitle className="flex items-center gap-3">
              <img
                src={APROVAN_LOGO}
                alt="Aprovan"
                className="h-8 w-8 rounded-full"
              />
              <span className="text-lg">patchwork</span>
              <ServicesInspector namespaces={namespaces} services={services} />
            </CardTitle>
          </CardHeader>

          <CardContent className="flex-1 p-0 min-h-0">
            <ScrollArea
              className="h-full"
              ref={scrollRef}
            >
              <div className="p-4 space-y-4">
                {messages.length === 0 ? (
                  <div className="text-center text-muted-foreground py-12">
                    <img
                      src={APROVAN_LOGO}
                      alt=""
                      className="h-12 w-12 mx-auto mb-4 opacity-50 rounded-full"
                    />
                    <p>Start a conversation</p>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                    />
                  ))
                )}

                {isLoading &&
                  messages[messages.length - 1]?.role !== 'assistant' && (
                    <div className="flex gap-3 justify-start">
                      <Avatar className="h-8 w-8 shrink-0">
                        <img
                          src={APROVAN_LOGO}
                          alt=""
                          className="rounded-full"
                        />
                        <AvatarFallback>A</AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col gap-1">
                        <div className="h-5" />
                        <div className="bg-muted rounded-lg px-4 py-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      </div>
                    </div>
                  )}
              </div>
            </ScrollArea>
          </CardContent>

          {error && (
            <div className="px-4 py-2 bg-destructive/10 text-destructive text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {error.message}
            </div>
          )}

          <div className="p-4 border-t">
            <form
              onSubmit={handleSubmit}
              className="flex gap-2 items-end"
            >
              <MarkdownEditor
                value={input}
                onChange={setInput}
                onSubmit={() => {
                  if (!isLoading && input.trim()) {
                    handleSubmit();
                  }
                }}
                placeholder="Type a message... (Shift+Enter for new line)"
                disabled={isLoading}
              />
              <Button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="shrink-0"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </form>
          </div>
        </Card>
      </div>
    </PatchworkCtx.Provider>
  );
}
