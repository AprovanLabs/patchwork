We want to integrate with the A2A protocol so we can manage interactions with agents. Specifically, I want to end up using this in the chat app.

HOWEVER, I don't really want to force this functionality into Patchwork. Patchwork manages generic service calls and renders widgets to the UI, as well as loads editable data from local file systems, mounted as virtual file systems.

We _should_ be able to support dispatching and monitoring A2A workflows in this way:

1. Expose some method for kicking off A2A workflows in chat, probably as an MCP (+ prompt)
2. As part of the agent process, it will create artifacts. Whether this is Git branches/worktrees, global Markdown file updates, streaming chats, remote GitHub ticket updates...
  - We _should_ be able to support displaying _all_ of these via a combination of 1) Hardcopy syncing remote sources 2) Hardcopy having some recent implementation of event streaming (see [event-streaming.md](docs/specs/event-streaming.md) in the hardcopy repo 3) Patchwork displaying local mounted files, with optional renderers for said files (so we can render Markdown of agent instructions that were dispatched, Markdown files generated as plan docs, etc) and 4) since we can integrate with MCP servers, any other functionality we might need cloud be exposed as such (e.g. expose metadata/management endpoints for agents via MCP, mount via UTCP, then use Patchwork to generate UI widgets to manage state, similar to how [dashboard.tsx](../../apps/chat/workspace/components/hardcopy/dashboard.tsx) allows us to manage Hardcopy state)

_Example a2a local file_

```ts
// server.ts
import express from 'express';
import { Server, ServerCredentials } from '@grpc/grpc-js';
import { v4 as uuidv4 } from 'uuid';
import { AgentCard, Message, AGENT_CARD_PATH } from '@a2a-js/sdk';
import {
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  DefaultRequestHandler,
  InMemoryTaskStore,
} from '@a2a-js/sdk/server';
import { agentCardHandler, jsonRpcHandler, restHandler, UserBuilder } from '@a2a-js/sdk/server/express';
import { grpcService, A2AService } from '@a2a-js/sdk/server/grpc';

// 1. Define your agent's identity card.
const helloAgentCard: AgentCard = {
  name: 'Hello Agent',
  description: 'A simple agent that says hello.',
  protocolVersion: '0.3.0',
  version: '0.1.0',
  url: 'http://localhost:4000/a2a/jsonrpc', // The public URL of your agent server
  skills: [{ id: 'chat', name: 'Chat', description: 'Say hello', tags: ['chat'] }],
  capabilities: {
    pushNotifications: false,
  },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  additionalInterfaces: [
    { url: 'http://localhost:4000/a2a/jsonrpc', transport: 'JSONRPC' }, // Default JSON-RPC transport
    { url: 'http://localhost:4000/a2a/rest', transport: 'HTTP+JSON' }, // HTTP+JSON/REST transport
    { url: 'localhost:4001', transport: 'GRPC' }, // GRPC transport
  ],
};

// 2. Implement the agent's logic.
class HelloExecutor implements AgentExecutor {
  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    // Create a direct message response.
    const responseMessage: Message = {
      kind: 'message',
      messageId: uuidv4(),
      role: 'agent',
      parts: [{ kind: 'text', text: 'Hello, world!' }],
      // Associate the response with the incoming request's context.
      contextId: requestContext.contextId,
    };

    // Publish the message and signal that the interaction is finished.
    eventBus.publish(responseMessage);
    eventBus.finished();
  }

  // cancelTask is not needed for this simple, non-stateful agent.
  cancelTask = async (): Promise<void> => {};
}

// 3. Set up and run the server.
const agentExecutor = new HelloExecutor();
const requestHandler = new DefaultRequestHandler(
  helloAgentCard,
  new InMemoryTaskStore(),
  agentExecutor
);

const app = express();

app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
app.use('/a2a/jsonrpc', jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));
app.use('/a2a/rest', restHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));

app.listen(4000, () => {
  console.log(`🚀 Server started on http://localhost:4000`);
});

const server = new Server();
server.addService(A2AService, grpcService({
  requestHandler,
  userBuilder: UserBuilder.noAuthentication,
}));
server.bindAsync(`localhost:4001`, ServerCredentials.createInsecure(), () => {
  console.log(`🚀 Server started on localhost:4001`);
});
```