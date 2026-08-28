# Semantic conversation routing

HotelMapp routes every durable text conversation through a language-model
semantic pass before selecting hotel facts. This makes the complete current
sentence—not a matching keyword or a stale stored topic—the primary source of
the guest's current need.

## Turn flow

1. Read the current message, recent durable turns, and the stored topic/intent.
2. Ask the semantic router for strict JSON containing the current topics and
   intents. The router cannot answer the guest, select tools, or execute actions.
3. Validate the JSON, topic/intent pairing, current-turn consistency, and output
   size.
4. Re-ground only the selected topics in authoritative hotel facts.
5. Run deterministic authorization and side-effect controls.
6. Render or generate the guest answer, then store the new topic/intent.

Recent history may resolve a genuinely omitted subject, such as 「那第二台呢？」
after a parking question. It may not skip a newer self-contained booking turn to
recover an older parking topic. Negation, conditions, comparisons, subject,
object, time, and requested action are part of the routing instructions.

## Failure behavior

`SEMANTIC_ROUTER_ENABLED` is enabled by default and may be set to `false` for an
immediate rollback. `OPENAI_ROUTER_MODEL` optionally selects a router model;
otherwise the shared `OPENAI_MODEL` is used. `SEMANTIC_ROUTER_TIMEOUT_MS` defaults
to 5000 ms and is capped at 10000 ms.

If the model is unavailable, times out, returns invalid JSON, or contradicts a
clear current-message topic, routing falls back to deterministic grounding. The
fallback recognizes booking as a first-class topic and follows only an
uninterrupted chain of recent user follow-ups; it stops at a newer self-contained
request instead of scanning arbitrarily far back.

No AI system can guarantee zero mistakes. This design reduces the failure mode
by separating semantic understanding, authoritative facts, action authorization,
and final presentation, with validation and a safe fallback at each boundary.
