# Confluence REST fallback

The Jira MCP server has **no Confluence tools**. When a Jira issue references a Confluence page, use direct REST.

## Auth

```bash
CONFLUENCE_BASE_URL="${CONFLUENCE_URL:-https://confluence.tipalti.com:8090}"
AUTH_HEADER="Authorization: Bearer $CONFLUENCE_API_TOKEN"
```

Env var: `CONFLUENCE_API_TOKEN`. If not set, ask the user or run `node sync.mjs mcp-setup`.

> **Common misconfiguration**: Docker args in `~/.cursor/mcp.json` may pass `CONFLUENCE_PERSONAL_TOKEN` while `env` defines `CONFLUENCE_API_TOKEN`. The container's expected name must match. If Confluence returns a login page (HTML) instead of JSON, this is the likely cause.

## Preflight

```bash
curl -s -o /dev/null -w "%{http_code}" "$CONFLUENCE_BASE_URL/rest/api/content?limit=1" \
  -H "$AUTH_HEADER" -k
```

- `200` → auth works
- `401` / `403` → token invalid or missing
- HTML / `302` → token env var mismatch

## Fetch a page

Extract `pageId` from the URL (the numeric ID in `/pages/{pageId}/` or `?pageId={id}`), then:

```bash
curl -s "$CONFLUENCE_BASE_URL/rest/api/content/$PAGE_ID?expand=body.storage,version,space,title" \
  -H "$AUTH_HEADER" -k
```

## Fetch page children

```bash
curl -s "$CONFLUENCE_BASE_URL/rest/api/content/$PAGE_ID/child/page?expand=title" \
  -H "$AUTH_HEADER" -k
```

## Resolving Confluence URLs

| URL pattern | How to extract pageId |
|---|---|
| `/pages/viewpage.action?pageId=12345` | Query param `pageId` |
| `/display/SPACE/Page+Title` | Search by title: `/rest/api/content?title=Page+Title&spaceKey=SPACE` |
| `/wiki/spaces/SPACE/pages/12345/Title` | Path segment after `/pages/` |
