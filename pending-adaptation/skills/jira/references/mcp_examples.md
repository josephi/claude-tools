# MCP tool invocation examples

Complete JSON payloads for the key `jira_*` MCP tools on `user-mcp-atlassian-local`.

## Preflight

```json
// Verify MCP + auth
{ "server": "user-mcp-atlassian-local", "toolName": "jira_get_user_profile", "arguments": {} }

// Verify issue access
{ "server": "user-mcp-atlassian-local", "toolName": "jira_get_issue",
  "arguments": { "issue_key": "SYNC-26318", "fields": "summary,description,comment,issuelinks" } }
```

## Create a Bug

```json
{
  "server": "user-mcp-atlassian-local",
  "toolName": "jira_create_issue",
  "arguments": {
    "project_key": "SYNC",
    "summary": "Bug title here",
    "issue_type": "Bug",
    "description": "h2. Steps to Reproduce\n...\n\nh2. Expected Result\n...\n\nh2. Actual Result\n...",
    "additional_fields": {
      "customfield_16800": {
        "value": "Sync",
        "child": { "value": "DeLorean" }
      }
    }
  }
}
```

## Create a Task

```json
{
  "server": "user-mcp-atlassian-local",
  "toolName": "jira_create_issue",
  "arguments": {
    "project_key": "SYNC",
    "summary": "Task title here",
    "issue_type": "Task",
    "description": "Task description in Jira markup.",
    "additional_fields": {
      "customfield_16800": {
        "value": "Sync",
        "child": { "value": "DeLorean" }
      }
    }
  }
}
```

## Create a CD User Story

```json
{
  "server": "user-mcp-atlassian-local",
  "toolName": "jira_create_issue",
  "arguments": {
    "project_key": "SYNC",
    "summary": "US: User story title",
    "issue_type": "CD User Story",
    "description": "h2. Goal\n...\n\nh2. Acceptance Criteria\n...",
    "additional_fields": {
      "customfield_10500": "SYNC-25841",
      "customfield_16800": {
        "value": "Sync",
        "child": { "value": "DeLorean" }
      },
      "customfield_16903": { "value": "Inherited from Epic" },
      "customfield_16904": { "id": "14212" },
      "customfield_18009": { "value": "No" }
    }
  }
}
```

## Add a comment

```json
{
  "server": "user-mcp-atlassian-local",
  "toolName": "jira_add_comment",
  "arguments": {
    "issue_key": "SYNC-12345",
    "comment": "Comment text in Markdown format."
  }
}
```

## Search with JQL

```json
{
  "server": "user-mcp-atlassian-local",
  "toolName": "jira_search",
  "arguments": {
    "jql": "project = SYNC AND issuetype = Bug AND status not in (Done, Closed)",
    "fields": "summary,status,assignee",
    "limit": 10
  }
}
```

## Get an issue

```json
{
  "server": "user-mcp-atlassian-local",
  "toolName": "jira_get_issue",
  "arguments": {
    "issue_key": "OP-76152",
    "fields": "*all"
  }
}
```

## `additional_fields` format

The `additional_fields` parameter is a **flat JSON object**, not a string. Each key is a field name or customfield ID:

```json
{
  "customfield_16800": { "value": "Sync", "child": { "value": "DeLorean" } },
  "labels": ["performance", "netsuite"],
  "customfield_10004": 5
}
```

**Common mistakes:**

- Do NOT pass `additional_fields` as a JSON string — it must be an object.
- Do NOT set `priority: {"name": "High"}` in SYNC project — omit priority or use `{"id": "..."}`.
- Do NOT nest `fields` inside `additional_fields` — the MCP tool constructs the API payload for you.
