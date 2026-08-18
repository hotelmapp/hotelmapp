# HotelMapp Core Personality Contract audit

## Root cause

The shared personality existed only as model instructions and in one parking
renderer. `answerGuestMessage()` also had deterministic branches that returned
`breakfastArrivalReply`, `parkingReply`, contact, sensitive-situation,
availability, special-request, informational, handoff, and fallback model text
directly. Consequently, using the prompt was optional rather than an output
invariant. The Messenger example selected the structured parking branch, so it
never reached generation with the shared instructions.

## Customer-visible path inventory

Before this contract the following ordinary reply producers could reach an
adapter without a common finalizer:

- structured breakfast-arrival and parking renderers;
- legacy `parkingReply` and deterministic informational/FAQ replies;
- availability, baby-equipment, contact, and sensitive-situation replies;
- handoff success/failure text and the conversation-memory safety fallback;
- model-generated grounded answers;
- durable and stateless returns from `answerWithConversation`.

All of those now converge inside `answerGuestMessage()` on
`finalizeGuestAnswer()` and `applyCorePersonalityContract()` before Web, LINE,
Messenger, or a future Instagram adapter can receive ordinary reply text. The
contract owns service presentation; grounding and business-rule modules still
own the selected facts. Channel adapters remain transport-only.

Realtime Voice receives the same contract as immutable session instructions,
because audio is generated peer-to-peer and no server-side text exists to
post-process. Its channel presentation is appended after the core personality.

## Intentional bypasses

Only non-conversational protocol or operational responses bypass the contract:

- HTTP method, validation, authentication, signature, configuration, upstream,
  and rate-limit error JSON;
- webhook verification challenges, duplicate/ignored event acknowledgements,
  and empty-event summaries;
- contact-form delivery status (a transactional UI result, not an AI reply);
- Realtime credential/session bootstrap responses;
- conversation persistence API status responses.

These are not normal hospitality answers and must remain deterministic for
protocol correctness, security, monitoring, or truthful transaction state.

