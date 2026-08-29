# Semantic conversation routing

HotelMapp routes every durable text conversation through a language-model
semantic pass before selecting hotel facts. This makes the complete current
sentence—not a matching keyword or a stale stored topic—the primary source of
the guest's current need.

## Turn flow

1. Read the current message, recent durable turns, and the stored topic/intent.
2. Ask Semantic Router v2 for strict JSON containing current topics/intents and
   a non-authoritative handoff recommendation. The router cannot answer the
   guest, authorize delivery, select execution tools, or execute actions.
3. Validate the JSON, topic/intent pairing, current-turn consistency, and output
   size.
4. Re-ground only the selected topics in authoritative hotel facts.
5. Validate the handoff recommendation, then run deterministic contact,
   confirmation, idempotency and side-effect controls.
6. Render or generate the guest answer, then store the new topic/intent.

Recent history may resolve a genuinely omitted subject, such as 「那第二台呢？」
after a parking question. It may not skip a newer self-contained booking turn to
recover an older parking topic. Negation, conditions, comparisons, subject,
object, time, and requested action are part of the routing instructions.

Subsidy participation is its own `subsidy_participation` intent. Negative
questions such as 「你們沒有參加國旅補助嗎？」 remain participation checks;
they are not expanded into a full subsidy overview.

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

No AI system can guarantee zero mistakes. This design reduces the failure mode
by separating semantic understanding, authoritative facts, action authorization,
and final presentation, with validation and a safe fallback at each boundary.
