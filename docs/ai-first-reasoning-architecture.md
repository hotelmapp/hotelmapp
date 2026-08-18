# HotelMapp shared AI-first reasoning architecture

## Decision record

The shared core separates **reasoning**, **truth**, **capability**, **execution**, and **presentation**. The model may understand intent, references, need, clarification, and useful next steps. It receives only a turn-scoped fact set whose leaves carry certainty and source. `null` is an explicit unknown, not an invitation to infer.

The capability registry separately describes what the hotel offers, what the assistant may propose, and what an authenticated executor can perform. An action is denied unless identity plus durable authorization exposes it. A natural-language completion claim is rejected unless the executor returned `completed`; a receipt may be recorded but is never model-created.

## Before

```text
guest -> channel -> regex/template OR large knowledge prompt -> prose
                    \-> handoff side effect
```

Consequences found in the audit:

* `guest-response.js` contained parking, breakfast, baby equipment, booking, sensitive-situation, and front-desk business replies. These deterministic replies bypassed shared model reasoning.
* The phase-one orchestrator only accepted parking intents and flattened parking facts.
* Free-form fallback prose received the complete knowledge document. Prompt instructions discouraged invention, but there was no claim/action verification boundary.
* Handoff had important delivery checks, but capabilities were not represented in a shared registry and channel entry points could select different handoff behavior.
* Personality was mostly shared already; webhook validation, signature verification, dedupe, durable conversation storage, privacy minimization, and authorization were correctly deterministic.

## After

```text
Guest message
  -> durable conversation context (references, language, need; never truth)
  -> AI decision (intent / need / clarification / next step)
  -> topic-scoped authoritative retrieval
  -> fact leaves { id, value, confirmed|unknown, source }
  -> deterministic capability registry + permission/authorization
  -> AI service decision using allowed fact IDs/capabilities only
  -> deterministic executor (optional)
  -> verified result: completed | failed | denied | not_executed
  -> grounded prose verification
  -> immutable provenance
  -> channel presentation (format only)
  -> existing authenticated/validated transport
```

## Boundaries and retained production safeguards

`data/hotel-info.js` remains the sole hotel truth. The grounding layer selects only relevant branches and makes absence explicit. Conversation history resolves omitted subjects but assistant/user prose cannot enter fact provenance. `reasoning-core.js` owns the channel-neutral fact envelope, capability registry, execution states, final claim checks, and provenance. Channel adapters remain transports and must not change `answer` or `provenance`.

Existing webhook signatures, request limits, idempotency/dedupe, persistence, privacy redaction, authenticated handoff confirmation, and rate/infrastructure controls remain deterministic. Existing templates remain temporarily as a feature-flagged rollback path; they are deprecated because they bypass AI need reasoning. Security checks and verified handoff delivery replies are retained, not delegated to the model.

## Rollout

1. Shadow the v2 decision/fact/provenance pipeline and compare it with production without executing tools.
2. Enable read-only turns by cohort and domain; monitor unknown rate, verification rejection, latency, fallback, and unsupported-claim incidents.
3. Enable authorized capabilities one at a time with idempotency keys, audit receipts, least privilege, and kill switches.
4. Expand Web, LINE, Messenger, Instagram, and Voice only after contract tests show identical answer/provenance at the adapter boundary.
5. Remove domain templates after sustained SLOs. Keep deterministic security, retrieval, permissions, executor verification, and safe unknown fallback permanently.

The cross-domain suite covers parking, check-in, late checkout, breakfast, luggage, room type, baby equipment, transportation, cancellation, payment, and complaint. Each domain exercises known retrieval, explicit unknown, and denied action. Separate invariants cover unsupported facts, unverified action claims, contextual reference resolution, channel immutability, and provenance.
