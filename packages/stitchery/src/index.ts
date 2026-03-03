export { createStitcheryServer, type StitcheryServer } from './server/index.js';
export { PATCHWORK_PROMPT, EDIT_PROMPT } from './prompts.js';
export {
  ServiceRegistry,
  generateServicesPrompt,
  type ServiceBackend,
  type ServiceToolInfo,
  type SearchServicesOptions,
} from './server/services.js';
export type {
  ServerConfig,
  McpServerConfig,
  UtcpConfig,
  ChatRequest,
  EditRequest,
} from './types.js';
export {
  createUnifiedContext,
  buildEntityContext,
  formatEntityContext,
  extractEntityUris,
  publishChatEvent,
  publishLLMComplete,
  publishServiceCall,
  publishGitHubWebhook,
  type UnifiedContext,
  type UnifiedContextConfig,
} from './server/unified.js';
