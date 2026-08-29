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

The finalizer no longer prepends a generic acknowledgement. For authoritative
single-topic facts, `answerGuestMessage()` supplies only the selected fact
subset, current user turn, recent context, and a verified fallback draft to the
configured GPT-5.6 Terra text model. The result must match the user's speech
act and pass both grounding and final-fact verification. A provider failure or
validation failure returns the intent-aware fallback draft instead of exposing
an unverified rewrite.

The finalizer owns one conversation-wide greeting rule: the first ordinary
reply receives one natural greeting in the guest's language, while later
turns continue the conversation without repeating it. Model-composed known
facts must also contain contextual warmth; a neutral data sentence is rejected
and falls back to the verified, hospitable intent renderer. This makes warmth
an output invariant instead of a collection of per-answer patches.
Formal wording alone is not warmth: a lone 「請」, 「了解」, or 「好的」 does not
satisfy the validator. A follow-up must naturally reflect the guest's actual
concern or provide a guest-facing service step, while still avoiding repeated
greetings and irrelevant permission openings such as 「可以喔」。

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
