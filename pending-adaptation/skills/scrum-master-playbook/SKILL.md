---
name: scrum-master-playbook
description: Extended playbook for the scrum-master agent — project-level inheritance template, extra JQL patterns, and examples of project-specific overrides. TRIGGER when creating or extending a project-level scrum-master agent, or when the base scrum-master agent refers to this playbook. SKIP when doing routine Jira task creation — the scrum-master agent itself has enough.
model: opus
tags: [audience/personal, portable/adapt]
---

# Scrum master playbook

Material that supports the `scrum-master` agent but doesn't need to load every time the agent runs.

## Extending the agent (project-level)

The base `scrum-master` agent is project-agnostic. Projects extend it by adding a `.cursor/agents/scrum-master.md` in the repo that inherits the global behavior and adds project-specific context.

### How inheritance works

1. **Global agent** (`~/.cursor/agents/scrum-master.md`): universal workflow — preflight, MCP usage, failure taxonomy, Confluence fallback, multi-hop context.
2. **Project agent** (`.cursor/agents/scrum-master.md` in the repo): project-specific overrides — custom fields, sprint cadence, extra workflows, project-specific JQL.

Project-level agents should reference the global agent's behavior and only define what's different.

### Project-level template

```markdown
---
name: scrum-master
description: Scrum Master for [ProjectName]. Extends the global scrum-master agent with project-specific Jira configuration.
model: opus
---

# Scrum Master — [ProjectName]

Extends the global scrum-master agent. Follow all global workflow steps (preflight, MCP, failure taxonomy) and apply these project-specific overrides.

## Project context (hardcoded — no service.json lookup needed)
- Project key: PROJ
- Team field: `{"value": "TeamParent", "child": {"value": "TeamChild"}}`
- Sprint board ID: 123

## Project-specific custom fields
| Field | ID | Notes |
|---|---|---|
| My Custom Field | customfield_99999 | Required for all Tasks |

## Project-specific workflows
- All bugs must be linked to an OP ticket
- User stories require QA sign-off comment before transition to Done

## Extra JQL shortcuts
- Active sprint: `project = PROJ AND sprint in openSprints()`
- My team's bugs: `project = PROJ AND issuetype = Bug AND Team = "TeamParent -> TeamChild"`
```

### What belongs in the project agent

- Custom field IDs and option values specific to the project
- Sprint cadence and board IDs
- Project-specific workflow rules (e.g. "all bugs must link to OP")
- Extra JQL patterns the team uses frequently
- Team-specific conventions (naming, labeling, component assignment)

### What does NOT belong in the project agent

- MCP tool invocation patterns — defined in the global agent + Jira skill
- Preflight checklist — defined globally
- Failure taxonomy — defined globally
- Confluence fallback recipe — defined in the Jira skill

## RCA / postmortem creation

When the user asks to create an RCA, postmortem, or root cause analysis from an OP ticket:

1. Read and follow the `create-rca` skill.
2. It reads the OP ticket, analyzes comments by stakeholder role, and creates a Confluence Postmortem page in the `IT/Postmortem` space.
3. Requires Jira MCP; Confluence uses MCP if available, otherwise REST fallback.

## OP ticket comments

When writing comments on OP tickets, use plain customer-support language. Avoid:
- Code references
- Technical field names (e.g. `customfield_16800`)
- Stack traces

Explain problems and solutions in business terms. The audience is support and stakeholders, not engineers.
