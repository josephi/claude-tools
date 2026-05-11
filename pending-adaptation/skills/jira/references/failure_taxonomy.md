# Failure taxonomy

Standardize error reports. Removes ambiguity between "tool is broken" and "data is empty".

| Code | Meaning | Action |
|------|---------|--------|
| `auth_error` | MCP server unreachable or token invalid | Check MCP config, verify `jira_get_user_profile` |
| `tool_scope_error` | Requested operation has no MCP tool (e.g. Confluence via Jira MCP) | Use REST fallback or the correct tool |
| `permission_error` | Authenticated but insufficient permissions for the resource | Report to user, suggest checking Jira/Confluence permissions |
| `issue_not_found` | Issue key does not exist | Verify key with user |
| `empty_issue_content` | Issue exists but has no description/comments/links | Trigger multi-hop context retrieval |
| `field_validation_error` | Issue creation/update rejected due to invalid fields | Check field IDs, re-read custom_fields.md, retry once |
| `confluence_auth_error` | Confluence REST returns 401/403/login page | Check `CONFLUENCE_API_TOKEN` env and MCP config alignment |
| `success_with_partial_data` | Operation succeeded but some data is missing or truncated | Report what was retrieved and what's missing |

When reporting a failure, always include:

1. The failure code
2. The exact tool/endpoint that failed
3. The error message or HTTP status
4. The recommended next step
