# MCP Limitations & Direct API Fallbacks

## MCP Server

**Server identifier**: `user-mcp-atlassian-local`

## Operations That Work via MCP

| Operation | MCP Tool | Notes |
|---|---|---|
| Create Bug | `jira_create_issue` | Pass custom fields in `additional_fields` |
| Create Task | `jira_create_issue` | Pass Team in `additional_fields` |
| Create Epic | `jira_create_issue` | Pass Epic Name, Category, T-shirt, Parent Link in `additional_fields` |
| Create CD User Story | `jira_create_issue` | Works with hierarchical Team field via `additional_fields` (see example below) |
| Get issue | `jira_get_issue` | Use `fields: "*all"` to include custom fields |
| Update issue fields | `jira_update_issue` | Pass fields in `fields` param |
| Add comment | `jira_add_comment` | Markdown format |
| Search (JQL) | `jira_search` | Standard JQL syntax |
| Link issues | `jira_create_issue_link` | "Relates to", "Blocks", etc. |
| Link to epic | `jira_link_to_epic` | Separate tool for epic linking |
| Transition status | `jira_transition_issue` | Change issue workflow status |

### Creating a CD User Story via MCP (SYNC example)

The MCP tool handles hierarchical `option-with-child` fields (like Team) correctly. Pass all required custom fields through `additional_fields`:

```json
{
  "server": "user-mcp-atlassian-local",
  "toolName": "jira_create_issue",
  "arguments": {
    "project_key": "SYNC",
    "summary": "US: Title here",
    "issue_type": "CD User Story",
    "description": "Description in Jira markup.",
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

## Operations That Do NOT Work via MCP

### 1. Edit / Update an Existing Comment
**No MCP tool exists for this.** Use direct REST API (see [Auth for Direct API](#auth-for-direct-api) below):
```bash
# Find comment ID first
curl -s "https://jira.tipalti.com:7000/rest/api/2/issue/{issueKey}?fields=comment" \
  -H "Authorization: Bearer $JIRA_PERSONAL_TOKEN" -k

# Update the comment
curl -s -X PUT "https://jira.tipalti.com:7000/rest/api/2/issue/{issueKey}/comment/{commentId}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JIRA_PERSONAL_TOKEN" \
  -k \
  -d '{"body": "Updated comment text."}'
```

### 2. Delete a Comment
No MCP tool. Use REST:
```bash
curl -s -X DELETE "https://jira.tipalti.com:7000/rest/api/2/issue/{issueKey}/comment/{commentId}" \
  -H "Authorization: Bearer $JIRA_PERSONAL_TOKEN" -k
```

## Common MCP Pitfalls

### `additional_fields` Must Be a JSON Object
```json
// CORRECT
"additional_fields": { "labels": ["bug"], "customfield_10004": 5 }

// WRONG — do not pass as a string
"additional_fields": "{\"labels\": [\"bug\"]}"
```

### Priority in SYNC Project
Do **not** use `{"name": "High"}` — SYNC uses a custom priority scheme. Either omit priority entirely or use `{"id": "..."}` with a valid ID from the project.

### Team Field (SYNC — all issue types)
The hierarchical Team field works via MCP `additional_fields` for **all** issue types (Bug, Task, CD User Story):
```json
"additional_fields": {
  "customfield_16800": {
    "value": "Sync",
    "child": { "value": "DeLorean" }
  }
}
```

### Retry Strategy
If MCP `jira_create_issue` fails:
1. Check the error message — is it a field validation error?
2. Try once more with corrected fields (remove invalid fields like priority).
3. If it fails again, switch to direct REST API immediately. Do not keep retrying MCP.

## Auth for Direct API

**The MCP tool handles auth natively** — you do not need any token for MCP calls. Auth is only needed for direct REST API fallback (editing/deleting comments).

### Jira token (for direct REST API only)

```bash
BASE_URL="https://jira.tipalti.com:7000"
AUTH_HEADER="Authorization: Bearer $JIRA_PERSONAL_TOKEN"
```

**Where to find it:** Check the `JIRA_PERSONAL_TOKEN` environment variable. If not set, ask the user for their Jira PAT.

**IMPORTANT — Do NOT confuse with Azure DevOps / TFS credentials:**
- `~/.npmrc` contains a PAT for **Azure DevOps / TFS** (package registry). It is **NOT** valid for Jira.
- Jira and Azure DevOps are separate systems with separate auth. Never use one token for the other.
- When in doubt, **prefer MCP tools** — they handle auth automatically and avoid credential issues entirely.
