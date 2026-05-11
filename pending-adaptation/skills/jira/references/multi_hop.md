# Multi-hop context retrieval

When a Jira issue has sparse or empty content, **do not stop at the issue body**. Walk the linked context until you find something.

1. **Issue → Epic**: read `customfield_10500` (Epic Link). Fetch the epic with `jira_get_issue` for its description, acceptance criteria, and links.
2. **Epic → Initiative**: read `customfield_17001` (Parent Link). Fetch the initiative for broader context.
3. **Issue → Linked issues**: walk `issuelinks` — fetch "blocks", "is blocked by", "relates to" issues for related specs or context.
4. **Issue → Confluence**: extract Confluence URLs from description, comments, or remote links. Fetch via [Confluence fallback](confluence_fallback.md).
5. **Issue → Comments**: read all comments. Stakeholders often add context, links, and decisions in comments rather than the description.

If all hops yield nothing useful, report `empty_issue_content` with the traversal path attempted.
