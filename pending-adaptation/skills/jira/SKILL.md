---
name: jira
description: Handle Jira interactions for Tipalti projects. Use for creating Epics, CD User Stories, Bugs, and Tasks. Project key, team, and context come from the repo's service.json (see service-json-context rule and references/project_context_from_service_json.md).
model: sonnet
tags: [audience/personal, portable/adapt]
---

# Jira

Workflows for creating and querying Jira issues. **Project key, team, and domain context are not hardcoded** — read the repo's **service.json** (see [references/project_context_from_service_json.md](references/project_context_from_service_json.md) and the **service-json-context** rule).

## Scope

This skill handles Jira only. The MCP server (`user-mcp-atlassian-local`) exposes only `jira_*` tools — **no Confluence tools**.

- If the user provides a Confluence URL, don't try Jira MCP tools on it. Use [references/confluence_fallback.md](references/confluence_fallback.md).
- For tasks needing both Jira and Confluence, use each method separately.

## Preflight (mandatory first step)

| # | Check | How | On failure |
|---|-------|-----|------------|
| 1 | MCP reachable | Call `jira_get_user_profile` | `auth_error` |
| 2 | Target issue accessible | Call `jira_get_issue` with `fields: "summary,description,comment,issuelinks"` | `permission_error` or `issue_not_found` |
| 3 | Issue has content | Description or comments non-empty | `empty_issue_content` → trigger [multi-hop](references/multi_hop.md) |
| 4 | Confluence links present? | Scan description, comments, remote links for `*/wiki/*` or `*/display/*` URLs | Verify Confluence REST access per [confluence_fallback](references/confluence_fallback.md) |
| 5 | Required fields writable | Creating/updating: verify project accepts issue type + custom fields | `field_validation_error` with specifics |

Example payloads in [references/mcp_examples.md](references/mcp_examples.md).

## Project context (required)

Before creating or formatting issues:

1. Read `service.json` (repo root or current service directory).
2. Use `jiraProjectKey` if present; otherwise project convention (SyncApp → SYNC) or ask.
3. Use `groupName` / `teamName` for the Jira Team field (parent → child).
4. Use `tags` + `projectName` for summaries and descriptions.

## MCP tools

**Server**: `user-mcp-atlassian-local`. Invoke via `CallMcpTool`. Always read the tool's JSON schema from the MCP descriptors folder **before** calling a tool for the first time.

| Tool | Use for |
|---|---|
| `jira_create_issue` | Bug, Task, Epic, CD User Story — all issue types |
| `jira_get_issue` | Fetch issue details by key |
| `jira_update_issue` | Update issue fields |
| `jira_search` | JQL queries |
| `jira_add_comment` | Add a comment |
| `jira_create_issue_link` | Link issues (Relates, Blocks, etc.) |
| `jira_link_to_epic` | Link an issue to an epic |
| `jira_transition_issue` | Change status |
| `jira_batch_create_issues` | Bulk create |

Worked examples for each tool: [references/mcp_examples.md](references/mcp_examples.md).

## Auth

Always try MCP first. For operations MCP can't do (edit comment, delete comment), fall back to direct REST — see [references/rest_fallback.md](references/rest_fallback.md) and the `jira-auth` skill.

## Core workflows

### Jira task formulation

- **Bugs**: Summary + Steps to Reproduce + Expected/Actual Result.
- **User Stories**: "As a [Role], I would like to [feature]" + acceptance criteria.
- **Automation tasks**: requirements + technical considerations.

Templates: [references/sync_app_context.md](references/sync_app_context.md).

### Creating an Epic

Epics need Epic Name, Epic Category, T-shirt estimation, Parent Link (Initiative). Find an active Initiative with JQL if not provided. Workflow: [references/workflow.md](references/workflow.md).

### Creating a CD User Story

Must link to an Epic. Requires Team (from service.json), Task Category, CE. Use MCP — pass all custom fields via `additional_fields` (including the hierarchical Team field). See [references/mcp_examples.md](references/mcp_examples.md) for the full payload and [references/custom_fields.md](references/custom_fields.md) for field IDs.

### PRD to specs

Break down PRD into specs in `/.docs/specs/`. Assign task IDs from `jiraProjectKey`. Keep AC clear and measurable.

### Sprint report

Provide Issue Key, Summary, Status, Assignee (and optional story points) for sprint issues. Use `jiraProjectKey` from service.json in JQL.

## JQL quick reference

- **Find Initiatives**: `project = <key> AND issuetype = Initiative AND status not in (Done, Closed, Cancelled)`
- **Search by Epic Link**: `"Epic Link" = <KEY>-<id>`
- **Search by Team**: `Team in ("Sync -> DeLorean")` (shape varies per project)

## References

- [project_context_from_service_json.md](references/project_context_from_service_json.md) — reading project key, team, domain from service.json
- [custom_fields.md](references/custom_fields.md) — SYNC custom field IDs and option IDs
- [mcp_examples.md](references/mcp_examples.md) — worked MCP tool payloads for every operation
- [rest_fallback.md](references/rest_fallback.md) — when and how to use direct REST
- [confluence_fallback.md](references/confluence_fallback.md) — Confluence page retrieval via REST
- [multi_hop.md](references/multi_hop.md) — walking the issue → epic → initiative → Confluence chain
- [failure_taxonomy.md](references/failure_taxonomy.md) — standard error codes
- [workflow.md](references/workflow.md) — Epic and CD User Story checklists
- [sync_app_context.md](references/sync_app_context.md) — task templates and role guidance
- [api_examples.md](references/api_examples.md) — curl examples and field formats
