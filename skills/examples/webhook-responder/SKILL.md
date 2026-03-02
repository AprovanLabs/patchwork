---
id: webhook-responder
name: Webhook Responder
description: Responds to GitHub PR comments with code suggestions
triggers:
  - eventFilter:
      types: ["webhook:github.issue_comment.created"]
#       types: [
#         "https://github.com/AprovanLabs/projects/issues"
#       ]
    condition: "data.comment.body CONTAINS '/suggest'"
#     priority: 5
model:
  provider: anthropic
  model: claude-sonnet-4-20250514
tools:
  - git
  - github
---

# Webhook Responder

This skill responds to GitHub PR comments that contain `/suggest`, providing code suggestions based on the context.

## Trigger Flow

```
GitHub PR Comment: "/suggest improve error handling"
        ↓
POST /webhooks/github
        ↓
Event: webhook:github.issue_comment.created
        ↓
Skill Match: condition passes (/suggest in body)
        ↓
Orchestrator: builds context, starts LLM session
        ↓
LLM: analyzes PR diff, generates suggestion
        ↓
Tool Call: github.create_review_comment()
```

## Capabilities

1. **Context Gathering**
   - Fetch PR diff to understand changes
   - Get file contents for surrounding context
   - Check related issues for requirements

2. **Suggestion Generation**
   - Analyze the user's request
   - Generate code suggestions
   - Format as GitHub review comment

3. **Response**
   - Post suggestion as PR review comment
   - Include code diff in suggestion
   - Add explanation for the change

## Example

```
User comment: "/suggest add input validation"

Bot response:
> Here's a suggestion for adding input validation:
>
> ```diff
> + if (!input || typeof input !== 'string') {
> +   throw new ValidationError('Input must be a non-empty string');
> + }
> ```
```
