# Project Context for Jira (from service.json)

**Project key, team, and domain context are not hardcoded.** Read the repo's **service.json** (see [project_context_from_service_json.md](project_context_from_service_json.md) and the **service-json-context** rule).

## Role: Lead Business Analyst / Scrum Master

Translate business needs into technical specs and Jira tasks. Use `@create-specs` for PRD → engineering specs in `/.docs/specs/`.

### Jira Task IDs
- **Format**: `<projectKey>-###` (e.g. SYNC-25791). Get **projectKey** from service.json (`jiraProjectKey` or convention).
- Keep IDs consistent across `tasks.md`, `/.docs/` and Jira.

### Domain Context
Use **tags** and **projectName** from service.json when writing summaries and descriptions. Example: SyncApp uses tags like "Sync, integration, netsuite, qbo, quickbooks, intacct, prebuilt, DeLorean, SyncApp".

### PR Description (Code Reviewer)
- **Title**: `[TYPE][TICKET] Short description`
- **Summary**: 2-3 bullets. **Key Changes**: by category. **Test Plan**: 3-5 checkboxes. **Risk**: one sentence.

### Jira Task Formulation
Activate when the user mentions: Jira task/ticket/issue, bug report, user story, feature request, automation task, "create task", "format task".

#### Summary Templates
- **Bugs**: Brief description.
- **User Stories & Automation Tasks**: "As an [Role], I would like to [brief description]".

#### Description Formatting
- **Bugs**: *Steps to reproduce*, *Expected result*, *Actual result*, *Notes for testing*.
- **User Stories**: As a [user type], I want [functionality] so that [benefit]. AC: clear and measurable; use `h2.` and `{code}` in Jira markup.
- **Automation Tasks**: Requirements + technical considerations.

## Project Metadata (from service.json)

- **Project Key**: From `jiraProjectKey` or convention (e.g. SyncApp → SYNC).
- **Base URL**: From `jiraBaseUrl` or default `https://jira.tipalti.com:7000`.
- **Team**: From `groupName` (parent) and `teamName` (child). Example SYNC: Sync (14000) → DeLorean (14008). See [custom_fields.md](custom_fields.md) for option IDs.
- **Confluence**: From `confluence` in service.json.
