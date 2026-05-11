# Project Context from service.json (Jira)

Use the **repo's service.json** as the source of project and team context for Jira. Do not hardcode project keys or team names.

## Rule to follow

See the **service-json-context** rule: read `service.json` at repo root (or in the current service directory) for:

- **Jira project key**: Prefer `jiraProjectKey` if present (e.g. `"SYNC"`). If missing, use known mapping (e.g. SyncApp → SYNC) or ask the user.
- **Jira base URL**: Use `jiraBaseUrl` if present; otherwise default to `https://jira.tipalti.com:7000`.
- **Team (customfield_16800)**: Use `groupName` as parent and `teamName` as child. Example: `groupName: "Sync"`, `teamName: "DeLorean"` → `{"value": "Sync", "child": {"value": "DeLorean"}}` or by id (Sync → DeLorean: 14000, 14008 for SYNC project).
- **Domain context**: Use `projectName` and `tags` when writing issue summaries and descriptions.

## Example (SyncApp)

```json
{
  "projectName": "SyncApp",
  "teamName": "DeLorean",
  "groupName": "Sync",
  "tags": "Sync, integration, netsuite, qbo, quickbooks, intacct, prebuilt, DeLorean, SyncApp"
}
```

- **Project key**: SYNC (from `jiraProjectKey` if present, else SyncApp → SYNC).
- **Team**: Sync → DeLorean.
- **Task ID format**: SYNC-###.
- **Domain**: ERP sync (NetSuite, Intacct, QBO), Tipalti integration.

For other repos, read their `service.json` and use the same pattern: project key from `jiraProjectKey` or convention, team from `groupName`/`teamName`, context from `tags`/`projectName`.
