# jira

Create, update, and query Jira issues for Tipalti projects via MCP.

## When to use

Creating Epics, CD User Stories, Bugs, Tasks; searching with JQL; adding comments; linking issues; transitioning status.

## How it works

- Uses `CallMcpTool` with server `user-mcp-atlassian-local` as the primary interface.
- Project key, team, and domain context are read from the repo's `service.json` — never hardcoded.
- Falls back to direct REST API only for operations the MCP can't handle (e.g. editing/deleting comments).

## Key MCP tools

| Tool | Use |
|------|-----|
| `jira_create_issue` | Create Bug, Task, Epic, CD User Story |
| `jira_get_issue` | Fetch issue by key |
| `jira_update_issue` | Update fields |
| `jira_search` | JQL queries |
| `jira_add_comment` | Add a comment |
| `jira_create_issue_link` | Link two issues |
| `jira_batch_create_issues` | Bulk create |

## Auth

MCP handles auth natively. Direct REST API requires `$JIRA_PERSONAL_TOKEN` (not the `~/.npmrc` PAT — that's for Azure DevOps only).

## Files

| Path | Description |
|------|-------------|
| `SKILL.md` | Full workflow, MCP call examples, field formats |
| `references/custom_fields.md` | SYNC custom field IDs and option IDs |
| `references/api_examples.md` | curl examples and field formats |
| `references/workflow.md` | Checklists for Epics and CD User Stories |
| `references/mcp_limitations.md` | When to fall back to direct REST API |
| `references/sync_app_context.md` | Task templates and role guidance |
| `references/project_context_from_service_json.md` | How to extract context from service.json |
