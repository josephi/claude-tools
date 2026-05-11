# Jira REST fallback

Always try MCP first. Fall back to direct `curl` / REST **only** when:

1. **Editing a comment** — MCP has no `jira_edit_comment` or `jira_update_comment` tool.
2. **Deleting a comment** — no MCP tool exists.
3. MCP returns persistent validation/permission errors after one retry with corrected fields.

## Auth (MCP vs direct)

- **MCP tools** handle auth natively — no token needed. Always prefer MCP.
- **Direct REST** requires a Jira PAT in `$JIRA_PERSONAL_TOKEN`. See the `jira-auth` skill.
- The `~/.npmrc` PAT is for Azure DevOps / TFS only — **never** use it for Jira REST.

## Base URL

```bash
BASE_URL="${JIRA_URL:-https://jira.tipalti.com:7000}"
AUTH_HEADER="Authorization: Bearer $JIRA_PERSONAL_TOKEN"
```

## Edit a comment

```bash
curl -s -X PUT "$BASE_URL/rest/api/2/issue/$ISSUE_KEY/comment/$COMMENT_ID" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -k \
  -d '{"body": "Updated comment text in Jira markup."}'
```

Find the comment ID first:

```bash
curl -s "$BASE_URL/rest/api/2/issue/$ISSUE_KEY?fields=comment" -H "$AUTH_HEADER" -k
```

## Delete a comment

```bash
curl -s -X DELETE "$BASE_URL/rest/api/2/issue/$ISSUE_KEY/comment/$COMMENT_ID" \
  -H "$AUTH_HEADER" -k
```
