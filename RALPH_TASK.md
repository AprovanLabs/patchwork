# Patchwork + Hardcopy + Apprentice Consolidation

IMPLEMENT ONLY PATCHWORK FUNCTIONALITY

Prefer to be concise and simple with your approach. Avoid duplicated code and re-implementing exiting functionality. Always be aware of where code _should_ go.

- DO keep code in separated areas where possible
- DO keep implementation simple and free of comments
- Do NOT keep backwards compatibility. Break legacy implementations where needed and remove deprecated code.
- Re-factor and re-organize as-needed, as you go.

Be generic in your implementation. Think think thoroughly through the abstractions you create and consider if there is a more powerful variant that preserves functionality without major sacrifices.

- ALWAYS use a strong sense of module isolation
- Do NOT plan one-off variants or implementations, unless absolutely necessary and properly isolated.
- ALWAYS consider how the implementation will work long-term and be extensible.
- ALWAYS check with the user if there are open questions, conflicts, or fundamental issues with the approach.

> **Specs:** [projects/specs](projects/specs/)

## Apprentice Refactor

> Spec: [apprentice-refactor.md](projects/specs/apprentice-refactor.md)

### Phase A1: Add EntityGraph

- [x] Add `entities` table to DB schema
- [x] Add `entity_links` table to DB schema
- [x] Implement `EntityGraph` interface
- [x] Merge `assets` as entities with `file:` URI scheme
- [x] Merge `events` as entities with `event:` URI scheme
- [x] Add URI utilities: `parseUri`, `formatUri`, `normalizeUri`

### Phase A2: Upgrade EventBus

- [x] Refactor `events` table to match `Envelope` schema
- [x] Add in-memory subscription registry
- [x] Add filter matching (types, sources, subjects with wildcards)
- [x] Integrate EventBus with EntityGraph

### Phase A3: Add Orchestrator

- [x] Add `sessions` table
- [x] Implement `SessionManager`
- [x] Implement `Orchestrator` with event routing
- [x] Add concurrency control (`maxConcurrent` with queue)
- [x] Add pluggable `ExternalNotifier` interface

### Phase A4: Export Package

- [x] Export `EntityGraph`, `Entity`, `EntityLink`, `EntityFilter`
- [x] Export `EventBus`, `Envelope`, `EventFilter`, `Subscription`
- [x] Export `Orchestrator`, `Session`, `SessionManager`
- [x] Export `SearchEngine`, `SearchResult`
- [x] Export `createApprentice`, `ApprenticeConfig`

---

## Patchwork Refactor

> Spec: [patchwork-refactor.md](projects/specs/patchwork-refactor.md)

### Phase B1: Remove Duplicated Modules

- [x] Delete `packages/events/` (use `@aprovan/apprentice`)
- [x] Delete `packages/graph/` (use `@aprovan/apprentice`)
- [x] Delete `packages/orchestrator/` (use `@aprovan/apprentice`)

### Phase B2: Simplify ServiceRegistry

- [x] Remove `utcp` source type and related code
- [x] Remove `grpc` (not implemented)
- [x] Simplify to MCP spawn + HTTP fetch + local function
- [x] Keep caching with TTL and event-based invalidation

### Phase B3: Refactor SkillRegistry

- [x] Remove `SkillExecutor` from registry
- [x] Make registry purely for discovery and trigger matching
- [x] Skills reference services by namespace

### Phase B4: Wire Stitchery to Apprentice

- [x] Update `unified.ts` to use Apprentice runtime
- [x] Wire `ServiceRegistry` to Apprentice db/eventBus
- [x] Wire `SkillRegistry` to Apprentice entityGraph
- [x] Set skill resolver on orchestrator
- [x] Set tool executor on orchestrator

### Phase B5: Update apps/chat

- [x] Chat messages → `eventBus.publish()` as `chat.message.sent`
- [x] LLM responses → `eventBus.publish()` as `llm.{sessionId}.chunk`
- [x] Tool calls → `serviceRegistry.call()`
- [x] Entity references → `entityGraph.get()` + `traverse()`

---

## Hardcopy Refactor (OUT OF SCOPE)

> **SKIPPED**: Per directive "IMPLEMENT ONLY PATCHWORK FUNCTIONALITY"
> Hardcopy project does not exist in this repository.

---

## Integration (OUT OF SCOPE)

> **SKIPPED**: Requires Hardcopy which is out of scope per directive.
