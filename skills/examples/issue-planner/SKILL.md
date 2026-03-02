---
id: issue-planner
name: Issue Planner
description: Automatically plans tasks when GitHub issues are labeled with 'auto-plan'
triggers:
  - eventFilter:
      types: ["webhook:github.issue.labeled"]
    condition: "data.label.name = 'auto-plan'"
    priority: 5
model:
  provider: anthropic
  model: claude-opus-4-20250514
tools:
  - git
  - github
---

# Issue Planner

This skill automatically creates a task breakdown when a GitHub issue is labeled with `auto-plan`.

## Workflow

1. **Trigger**: GitHub webhook fires `issue.labeled` event
2. **Match**: Skill matches because label name is `auto-plan`
3. **Context**: Orchestrator builds context from entity graph
4. **Execute**: LLM analyzes issue and creates task plan

## Task Output

The skill will:
- Read the issue body and any linked issues
- Break down the work into concrete tasks
- Create or update a `backlog.md` file in the repo
- Add a comment to the issue with the plan

## Example Output

```markdown
## Tasks for Issue #42

- [ ] Design API schema for new endpoint
- [ ] Implement database migrations
- [ ] Create service layer with validation
- [ ] Add unit tests for edge cases
- [ ] Update API documentation
```

## Configuration

The skill uses Claude Opus 4.5 for planning because:
- Complex reasoning required for task breakdown
- Understanding of codebase patterns needed
- Quality of task definitions impacts implementation
