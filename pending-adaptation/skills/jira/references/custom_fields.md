# SYNC Project Custom Fields (example)

**Project key and team** for any project come from the repo's **service.json** (see [project_context_from_service_json.md](project_context_from_service_json.md)). The table below documents SYNC-specific field IDs; other projects have their own.

| Field ID | Name | Type | Description / Options |
|----------|------|------|-----------------------|
| `customfield_10500` | Epic Link | string | Parent epic key (e.g. "SYNC-25791"). Required for CD User Story. |
| `customfield_10501` | Epic Name | string | Short label (required for Epic). |
| `customfield_10004` | Story Points | number | Dev effort estimation. |
| `customfield_16800` | Team | option-with-child | `{"value": "Sync", "child": {"value": "DeLorean"}}` or by id (Sync → DeLorean). **Required for Task and CD User Story in SYNC.** |
| `customfield_16903` | Task Category | option | `14206` (Inherited from Epic), `14209` (UCR), `14210` (OP Ticket), `15423` (Automation). |
| `customfield_16904` | CE | option | `14212`=1, `14500`=2, `14213`=3, `14214`=5, `14215`=10. |
| `customfield_17203` | Epic Category | option | `14560` (Feature), `14561` (Improvement), `14562` (Enabler), `14806` (Refactor), `16401` (QA Auto), `17609` (Security). |
| `customfield_16700` | T-shirt estimation | option | `13905`=S, `13906`=M, `13907`=L. |
| `customfield_17001` | Parent Link | string | Initiative key. Required for Epic. |
| `customfield_18009` | CE Related | option | Usually `{"value": "No"}`. |

## Quick Option IDs

### Epic Category (17203)
- Product Feature: `14560`
- Product Improvement: `14561`
- Tech Enabler: `14562`
- Refactor: `14806`
- QA Automation: `16401`
- Security: `17609`

### T-shirt (16700)
- S: `13905`
- M: `13906`
- L: `13907`

### Team (16800)
- Parent (Sync): `14000`
- Child DeLorean: `14008` (use `{"value": "Sync", "child": {"value": "DeLorean"}}` or `{"id": "14000", "child": {"id": "14008"}}`).

### Task Category (16903)
- Inherited from Epic: `14206`
- UCR: `14209`
- OP Ticket: `14210`
- Automation: `15423`

### CE (16904)
- 1: `14212`
- 2: `14500`
- 3: `14213`
- 5: `14214`
- 10: `14215`

### Priority (SYNC)
- Do not use `{"name": "High"}` — SYNC may use a different scheme. Omit priority or use `{"id": "..."}` from the project's priority scheme. Set in UI if needed.
