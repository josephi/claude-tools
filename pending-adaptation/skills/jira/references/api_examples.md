# Jira API Examples (SYNC Project)

**Base URL:** `https://jira.tipalti.com:7000` (Jira Server).  
Use `-k` with curl if SSL verification is skipped.  
Auth: `Authorization: Bearer $JIRA_PERSONAL_TOKEN` (env var).

**Prefer MCP tools over direct API** — MCP handles auth natively. Only use curl when MCP lacks the operation (e.g. editing a comment). See [mcp_limitations.md](mcp_limitations.md).

**Auth warning:** The `JIRA_PERSONAL_TOKEN` is a Jira-specific PAT. The `~/.npmrc` PAT is for Azure DevOps / TFS only and will **NOT** work for Jira. If `$JIRA_PERSONAL_TOKEN` is not set, ask the user.

**Important:** Project SYNC does not use issue type "Story". Use **Epic** for epics and **CD User Story** (id `10200`) for user stories.

## SYNC Issue Types

| Name            | ID     | Use for                          |
|-----------------|--------|----------------------------------|
| Epic            | 6      | Epics (requires Parent Link)     |
| CD User Story   | 10200  | User stories under an epic       |
| Task            | 3      | Tasks                            |
| Bug             | 1      | Bugs                             |
| Initiative      | 10800  | Parent of Epics (Epic Link up)   |

## Creating an Epic in SYNC

Required fields for Epic in SYNC:

| Field ID             | Name             | Example value / notes                    |
|----------------------|------------------|-----------------------------------------|
| `summary`            | Summary          | string                                  |
| `issuetype`          | Issue Type       | `{"name": "Epic"}` or `{"id": "6"}`     |
| `customfield_10501`  | Epic Name        | string (short label for the epic)       |
| `customfield_17203`  | Epic Category    | `{"id": "14806"}` = Refactor            |
| `customfield_16700`  | T-shirt estimation | `{"id": "13907"}` = L                 |
| `customfield_17001`  | Parent Link      | Initiative key, e.g. `"SYNC-25425"`    |

**Epic Category (customfield_17203)**:
- `14560` Product Feature, `14561` Product Improvement, `14562` Tech Enabler, `14806` Refactor, `16401` QA Automation, `17609` Security.

**T-shirt estimation (customfield_16700)**: `13905` S, `13906` M, `13907` L.

**Parent Link (customfield_17001)**: Key of an existing Initiative in SYNC.

### Example (curl)
```bash
curl -s -X POST "https://jira.tipalti.com:7000/rest/api/2/issue" 
  -H "Content-Type: application/json" 
  -H "Authorization: Bearer YOUR_JIRA_TOKEN" 
  -k 
  -d '{
    "fields": {
      "project": {"key": "SYNC"},
      "summary": "Epic title",
      "issuetype": {"name": "Epic"},
      "customfield_10501": "Epic short name",
      "customfield_17203": {"id": "14806"},
      "customfield_16700": {"id": "13907"},
      "customfield_17001": "SYNC-25425",
      "description": "Epic description."
    }
  }'
```

## Creating a CD User Story in SYNC (under an Epic)

Required fields for **CD User Story** (id `10200`):

| Field ID             | Name          | Example value / notes                          |
|----------------------|---------------|-------------------------------------------------|
| `summary`            | Summary       | string                                          |
| `issuetype`          | Issue Type    | `{"id": "10200"}` (CD User Story)               |
| `customfield_10500`  | Epic Link     | Epic key, e.g. `"SYNC-25791"`                   |
| `customfield_16800`  | Team          | `{"id": "14000", "child": {"id": "14008"}}` or `{"value": "Sync", "child": {"value": "DeLorean"}}` (Sync → DeLorean) |
| `customfield_16903`  | Task Category | `{"id": "14206"}` = Inherited from Epic         |
| `customfield_16904`  | CE            | `{"id": "14212"}` = 1                          |

**Team (customfield_16800)**: Sync parent: `14000`. Children: DeLorean `14008`, Appcellent `14008`, Tesla `14005`, Morpheus `14007`. For SyncApp use **Sync → DeLorean**: `{"value": "Sync", "child": {"value": "DeLorean"}}` or `{"id": "14000", "child": {"id": "14008"}}`.

**Task Category (customfield_16903)**: `14206` Inherited from Epic, `14209` UCR, `14210` OP Ticket, `15423` Automation.

**CE (customfield_16904)**: `14212`=1, `14500`=2, `14213`=3, `14214`=5, `14215`=10.

### Example (curl)
```bash
curl -s -X POST "https://jira.tipalti.com:7000/rest/api/2/issue" 
  -H "Content-Type: application/json" 
  -H "Authorization: Bearer YOUR_JIRA_TOKEN" 
  -k 
  -d '{
    "fields": {
      "project": {"key": "SYNC"},
      "summary": "US1: Title",
      "issuetype": {"id": "10200"},
      "customfield_10500": "SYNC-25791",
      "customfield_16800": {"value": "Sync", "child": {"value": "DeLorean"}},
      "customfield_16903": {"id": "14206"},
      "customfield_16904": {"id": "14213"},
      "description": "Goal, tasks, acceptance criteria."
    }
  }'
```
