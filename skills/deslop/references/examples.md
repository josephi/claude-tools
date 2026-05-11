# Before / after examples

Real-shaped before/after pairs for the contexts the skill cares about — PR descriptions, PR inline comments, Slack messages, Jira descriptions, RCA narratives.

## PR description

**Before**

> ## Summary
>
> This PR introduces several important changes to the queue consumer module, which serves as a critical component of our event processing pipeline. The changes include a comprehensive refactor of the retry logic, enabling more robust handling of transient failures. Additionally, we've introduced a new dead-letter queue strategy that seamlessly integrates with the existing infrastructure, providing enhanced observability for failed jobs. These changes are expected to significantly improve the reliability of our system.
>
> ## Key Changes
>
> - **Retry logic**: Refactored for robustness
> - **Dead-letter queue**: New strategy implemented
> - **Observability**: Enhanced logging
>
> ## Test Plan
>
> It is important to note that we have thoroughly tested these changes in the staging environment.

**After**

> ## Summary
>
> Refactors the queue consumer so transient errors retry up to 3 times with exponential backoff, and terminal errors route to a dead-letter queue with the original payload attached. Before this change, terminal errors silently dropped.
>
> ## Key Changes
>
> - Retries now capped at 3 attempts with 2s / 4s / 8s backoff (was: no cap, no backoff)
> - Dead-letter queue `sync-dlq` receives failed jobs with original payload
> - Logs the retry attempt number and the final terminal error
>
> ## Test plan
>
> - [ ] Integration test: retriable error → 3 attempts then DLQ
> - [ ] Integration test: terminal error → DLQ on first failure
> - [ ] Verified on staging: dlq receives expected payload shape

---

## PR inline comment

**Before**

> It's worth noting that this approach might have some implications for performance. You may want to consider whether a more efficient pattern could be used here, particularly given the scale at which this runs. Perhaps something like a batched update could be worth exploring, as it would potentially reduce the number of round trips to the database.

**After**

> This runs per-record inside a loop that can hit 10k+ records per job. Consider batching into `bulkUpdate` (50-row chunks) — should cut round trips by ~98%.

---

## Slack announcement (PR opened)

**Before**

> :tada: New PR ready for review!
>
> I've just opened a PR that introduces some exciting new changes to our retry logic. This is a pivotal update that will seamlessly integrate with our existing infrastructure to foster more robust error handling in our event processing pipeline.
>
> — PR: [here](https://...)
> — Jira: [SYNC-1234](https://...)
>
> Would love to get some eyes on this when you have a moment! :pray:

**After**

> :ticket: SYNC-1234 — queue retry with DLQ
>
> PR: https://tfs01.tipalti.com:8080/tfs/.../pullrequest/9876
> Jira: https://jira.tipalti.com:7000/browse/SYNC-1234
>
> Changes retries to capped exponential backoff and routes terminal errors to `sync-dlq`. Review when you have a sec :pray:

---

## Jira description

**Before**

> As a developer, I would like to refactor the retry logic in the queue consumer so that we can seamlessly handle transient failures and foster a more robust event processing pipeline.
>
> This pivotal change will unlock new capabilities for the team and enable us to deliver best-in-class reliability for our customers.

**After**

> [Queue] Cap retries with exponential backoff and route terminal errors to DLQ
>
> Current state: retries are uncapped and terminal errors silently drop.
>
> Target state: up to 3 retries with 2s / 4s / 8s backoff; terminal errors → `sync-dlq` with original payload.
>
> Acceptance criteria:
> - Retriable error retries up to 3 times then routes to DLQ
> - Terminal error routes to DLQ on first failure
> - DLQ entries include the original payload and the final error

---

## RCA narrative paragraph

**Before**

> Despite these challenges, the team worked tirelessly to identify the root cause of the incident. Through careful analysis and collaboration across multiple teams, we were able to quietly restore service and foster a culture of continuous improvement. This incident serves as a testament to our commitment to excellence and our ability to navigate complex production landscapes.

**After**

> The incident was caused by a stale cached Jira transition ID after a workflow rebuild. Service was restored at 14:22 UTC by clearing the cache and retrying the failed webhook dispatches. The cache now expires after 1 hour instead of never, and the webhook retries from the dispatch queue.
