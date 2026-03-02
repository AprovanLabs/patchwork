Primary 'control' plane is an LLM, given context and instructions
- Where do instructions come from? From an API/pull-based? -> NO, always scheduled?

Event stream
- Scheduled heartbeat
    - LLM or human can register events in this hook system
    - Always result in a 'script' call?
- Should event stream be persisted? -> Yes
- How do we marry event stream like streamed text? Greppable? Tag-based? Point-in-time? Graph retrieval?

Remote assets
- Some database version on 3rd party...can't know exactly the format -> impute from contract? (HTTP/MCP)? How would we know graph database entries? THIS MUST BE DYNAMIC!

For LLMs: they are given context and tools
- For LLMs, they're given a purpose, context around the purpose, and tools to accomplish this purpose
- Purpose may be augmented by metadata from tools
- In a lot of ways, LLMs are unstructured pipeline executions
- Remove DAGS -> prompts and context are unstructured DAGs. We need to tell how to give outputs

How does an LLM know how to work with Websocket, SSE, or Webhooks? -> Events
- LLM schedules a 'check in' or 'event condition' that it cares about
    - Do wee need to provide example data? A format?
    - How do we know what format might be created?
    - How do we get it to start looking

There's a big open question on 'syncing'

Base toolset
- `schedule(cron, "here is a prompt")` -> a high-level scheduling agent manages downstream running
- File system gives the current state of files
    - Edit/read/...


LLMs best understand Markdown, but external systems understand structured
Hardcopy converts to/from external structure to unstructured


Generate jobs that can access 3rd party APIs as Patchwork widgets?

Inputs -> Transformations / Queries / Augmentations -> Outputs

COnvert schedule -> heartbeat event

HTTP (versioned), MCP (semi-versioned), StdIO (unstructured)
Websocket streams
Server sent events (SSE)

Assets (Markdown, JSON, YAML, blobs) -> can or should we marry these?
There a sense of 

Webhooks
Queues
CRON

Buckets
- File system

SQLite
- GraphDB
- SQL DB
- DocumentDB / JSON blobs
