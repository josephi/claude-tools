# Jira Workflow (project-agnostic)

**Project key and team come from the repo's service.json.** See [project_context_from_service_json.md](project_context_from_service_json.md).

## Task Creation Workflow (generic)
1. **Summary**: Title.
2. **Description**: Jira markup (e.g. `h2.`, `{code}`).
3. **Issue Type**: Epic, CD User Story, Task, Bug, or Initiative.
4. **Project key**: From service.json (`jiraProjectKey` or convention).
5. **Team**: From service.json `groupName` → parent, `teamName` → child. Required for Task and CD User Story where the project requires it.
6. **Priority**: Omit or use a value valid for the project (some projects do not use "High"; use id if needed).

## SYNC Project – Task Checklist (example)
1. Summary, Description, Issue Type `{"name": "Task"}` (ID 3).
2. **Team (customfield_16800)**: `{"value": "Sync", "child": {"value": "DeLorean"}}` or `{"id": "14000", "child": {"id": "14008"}}` (from service.json groupName/teamName).
3. **Priority**: Omit or use project scheme; do not use `{"name": "High"}` in SYNC.

## SYNC Project – Epic Creation Checklist (example)
1. Summary, Description, Issue Type `{"name": "Epic"}` (ID 6).
2. Epic Name (customfield_10501), Epic Category (customfield_17203), T-shirt (customfield_16700), Parent Link (customfield_17001) = Initiative key.

## SYNC Project – CD User Story Checklist (example)
1. Summary, Description, Issue Type `{"id": "10200"}`.
2. Epic Link (customfield_10500), Team (customfield_16800) from service.json, Task Category (customfield_16903), CE (customfield_16904).

## JQL (use project key from service.json)
- Initiatives: `project = <projectKey> AND issuetype = Initiative AND status not in (Done, Closed, Cancelled)`
