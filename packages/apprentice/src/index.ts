export type {
  ParsedUri,
  Entity,
  EntityLink,
  EntityFilter,
  EntityGraph,
  Envelope,
  EventFilter,
  QueryOptions,
  Subscription,
  EventHandler,
  EventBus,
  Session,
  SessionManager,
  SkillTrigger,
  SkillResolver,
  ToolExecutor,
  OrchestratorConfig,
  Orchestrator,
  ExternalNotifier,
} from "./types.js";

export {
  parseUri,
  formatUri,
  normalizeUri,
  getScheme,
  createFileUri,
  createEventUri,
  isFileUri,
  isEventUri,
} from "./uri.js";

export { createDatabase, type DatabaseOptions } from "./db.js";
export { EntityGraphImpl, type EntityGraphOptions } from "./entity-graph.js";
export { EventBusImpl, createEnvelope, type EventBusOptions } from "./event-bus.js";
export { SessionManagerImpl, type SessionManagerOptions } from "./session.js";
export { OrchestratorImpl, type OrchestratorOptions } from "./orchestrator.js";
export { SearchEngineImpl, type SearchEngineOptions, type SearchResult, type SearchOptions, type SearchEngine } from "./search.js";

import type Database from "better-sqlite3";
import { createDatabase, type DatabaseOptions } from "./db.js";
import { EntityGraphImpl } from "./entity-graph.js";
import { EventBusImpl } from "./event-bus.js";
import { SessionManagerImpl } from "./session.js";
import { OrchestratorImpl } from "./orchestrator.js";
import { SearchEngineImpl, type SearchEngine } from "./search.js";
import type { EntityGraph, EventBus, SessionManager, Orchestrator, OrchestratorConfig, ExternalNotifier } from "./types.js";

export interface ApprenticeConfig {
  dbPath?: string;
  orchestrator?: OrchestratorConfig;
  notifier?: ExternalNotifier;
}

export interface Apprentice {
  db: Database.Database;
  entityGraph: EntityGraph;
  eventBus: EventBus;
  sessionManager: SessionManager;
  orchestrator: Orchestrator;
  searchEngine: SearchEngine;
  close(): void;
}

export function createApprentice(config: ApprenticeConfig = {}): Apprentice {
  const db = createDatabase({ path: config.dbPath });
  const eventBus = new EventBusImpl({ db });
  const entityGraph = new EntityGraphImpl({ db, eventBus });
  const sessionManager = new SessionManagerImpl({ db });
  const orchestrator = new OrchestratorImpl({
    eventBus,
    entityGraph,
    sessionManager,
    config: config.orchestrator,
    notifier: config.notifier,
  });
  const searchEngine = new SearchEngineImpl({ db });

  return {
    db,
    entityGraph,
    eventBus,
    sessionManager,
    orchestrator,
    searchEngine,
    close() {
      db.close();
    },
  };
}
