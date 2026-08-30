# Semantic conversation routing

HotelMapp routes every durable text conversation through a language-model
semantic pass before selecting hotel facts. This makes the complete current
sentence—not a matching keyword or a stale stored topic—the primary source of
the guest's current need.

## Turn flow

1. Read the current message, recent durable turns, and the stored topic/intent.
2. Ask Semantic Router v2.3 for strict JSON containing current topics/intents and
   a non-authoritative handoff recommendation. The router cannot answer the
   guest, authorize delivery, select execution tools, or execute actions.
3. Validate the JSON, topic/intent pairing, current-turn consistency, and output
   size.
4. Re-ground only the selected topics in authoritative hotel facts.
5. If the route recommends a staff action, an independent grounded AI review
   checks the whole sentence, recent context, selected intent, authoritative
   facts, and factual contract before contact collection may begin.
6. Validate the reviewed action decision, then run deterministic contact,
   confirmation, idempotency and side-effect controls.
7. Render or generate the guest answer, then store the new topic/intent.

Recent history may resolve a genuinely omitted subject, such as 「那第二台呢？」
after a parking question. It may not skip a newer self-contained booking turn to
recover an older parking topic. Negation, conditions, comparisons, subject,
object, time, and requested action are part of the routing instructions.

Polite action wording is not itself a handoff signal. Semantically equivalent
questions share one intent even when one says 「可以幫我」 and another does not.
This is enforced system-wide rather than by one parking phrase: every message
first receives semantic routing, and every proposed handoff receives the same
topic-neutral grounded AI review. If authoritative information answers the
need, the answer path wins; explicit staff contact, operational problems, and
confirmed transactional handoffs retain their existing flow.

Subsidy participation is its own `subsidy_participation` intent. Negative
questions such as 「你們沒有參加國旅補助嗎？」 remain participation checks;
they are not expanded into a full subsidy overview.

Calendar applicability is a separate `subsidy_date_applicability` intent.
Questions about a specific date, weekday, national long holiday, or the day
before a long holiday cannot be collapsed into personal eligibility. The
router derives the requested stay date and weekday from the current turn. With
no exact date, the reply states the published day rule and asks only for the
check-in date; with an exact date, it answers calendar applicability before any
government-system qualification disclaimer.

## Failure behavior

`SEMANTIC_ROUTER_ENABLED` is enabled by default and may be set to `false` for an
immediate rollback. `OPENAI_ROUTER_MODEL` optionally selects a router model;
otherwise the shared `OPENAI_MODEL` is used, then the central default
`gpt-5.6-terra`. The router uses low reasoning by default for latency-sensitive
classification; `OPENAI_ROUTER_REASONING_EFFORT` may override it.
`SEMANTIC_ROUTER_TIMEOUT_MS` defaults to 5000 ms and is capped at 10000 ms.

If the model is unavailable, times out, returns invalid JSON, or contradicts a
clear current-message topic, routing falls back to deterministic grounding. The
fallback recognizes booking as a first-class topic and follows only an
uninterrupted chain of recent user follow-ups; it stops at a newer self-contained
request instead of scanning arbitrarily far back.

`AI_HANDOFF_REVIEW_ENABLED` controls the independent semantic action review and
defaults to enabled whenever `OPENAI_API_KEY` is configured. It may be disabled
for emergency rollback. If that review alone is unavailable, a known grounded
answer is preferred over collecting personal contact details; explicit safe
action patterns remain only as a provider-outage fallback. They are not the
normal production decision path. The action review uses medium reasoning by
default; `OPENAI_HANDOFF_REVIEW_REASONING_EFFORT` may override it, and
`HANDOFF_REVIEW_TIMEOUT_MS` defaults to 7000 ms with a 10000 ms cap.

No AI system can guarantee zero mistakes. This design reduces the failure mode
by separating semantic understanding, authoritative facts, action authorization,
and final presentation, with validation and a safe fallback at each boundary.
