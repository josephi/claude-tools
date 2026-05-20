# GitHub Issues — worked examples

Snippets for common operations. Default to `gh` CLI; fall back to `gh api` for REST/GraphQL.

## Create a bug

```sh
gh issue create \
  --title "bug: null metadata crashes upload initiator" \
  --label bug \
  --assignee @me \
  --body "$(cat <<'EOF'
## Steps to reproduce
1. Upload a file with empty metadata header.
2. Initiator throws on line 47.

## Expected
Upload proceeds with default metadata.

## Actual
`TypeError: Cannot read property 'mime' of null`.

## Notes
- Repro on commit `abc1234`.
- Same path as #38 but different field.
EOF
)"
```

## Create a feature with acceptance criteria

```sh
gh issue create \
  --title "feat: retry strategy for dead-letter flow" \
  --label feat \
  --body "$(cat <<'EOF'
## Why
DLQ fills up under partial-outage; manual replay is the only recovery today.

## Acceptance criteria
- [ ] Exponential backoff with jitter, max 5 attempts.
- [ ] DLQ message includes attempt count in headers.
- [ ] Metric `dlq_retry_total` exposed via /metrics.
- [ ] Integration test covers the 4th-attempt-succeeds path.

## Out of scope
- Per-queue retry policy. (Tracked separately.)
EOF
)"
```

## Add a comment

```sh
gh issue comment 42 --body "Reproduced on Node 20 as well. Pushing fix on branch fix/42_null-metadata."
```

## Close with a reason

```sh
gh issue close 42 --reason completed --comment "Fixed in #57."
# Or:
gh issue close 99 --reason "not planned" --comment "Superseded by #102."
```

## Find issues you're assigned to across all your repos

```sh
gh search issues "assignee:@me state:open"  --limit 50
```

## Add a label via REST (when gh doesn't expose what you need)

```sh
gh api \
  -X POST \
  /repos/<owner>/<repo>/issues/42/labels \
  -f labels[]=blocked
```

## Get all comments for an issue (raw JSON)

```sh
gh api /repos/<owner>/<repo>/issues/42/comments | jq '.[] | {user: .user.login, body, created_at}'
```

## Find Projects v2 item ID for an issue (GraphQL)

```sh
gh api graphql -f query='
  query($owner: String!, $repo: String!, $num: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $num) {
        projectItems(first: 10) {
          nodes { id, project { title } }
        }
      }
    }
  }' -F owner=<owner> -F repo=<repo> -F num=42
```

## Set a Projects v2 single-select field (Status: In review)

```sh
# 1. Get project + field IDs (one-time, cache them).
gh api graphql -f query='
  query { user(login: "<me>") { projectV2(number: <project-num>) {
    id, fields(first: 20) { nodes { ... on ProjectV2SingleSelectField { id, name, options { id, name } } } }
  } } }'

# 2. Update the item's Status field.
gh api graphql -f query='
  mutation($project: ID!, $item: ID!, $field: ID!, $value: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $project, itemId: $item, fieldId: $field,
      value: { singleSelectOptionId: $value }
    }) { projectV2Item { id } }
  }' -F project=<project-id> -F item=<item-id> -F field=<field-id> -F value=<option-id>
```
