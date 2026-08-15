# HotelMapp AI Front Desk V4 — shared AI Core and LINE adapter

## Architecture inventory

- `data/hotel-info.js` remains the single source of truth for hotel and breakfast facts. No channel owns a copy.
- `ai-core/knowledge.js` gives every channel the same knowledge version, serialized facts, and rules for unknown facts, breakfast grounding, live availability, and human escalation.
- `ai-core/hospitality-personality.js` is the single shared Hospitality Personality / Response Style layer. It defines the channel-independent Taiwanese hospitality voice and composes it with presentation-only constraints for Web, LINE, and Voice. It does not contain hotel facts or decide what may be said.
- `ai-core/booking.js` owns booking-intent detection, date extraction, and safe construction of dated URLs from the canonical booking URL. `stay-dates.js` remains the low-level multilingual date parser.
- `ai-core/handoff.js` owns the channel-neutral handoff decision, conversation normalization, stay-date extraction, category, and summary generation. `ai-core/handoff-service.js` builds the privacy-filtered payload, calls the single `ai-core/email-transport.js` Resend transport, and selects an honest channel presentation from the delivery result.
- `ai-core/guest-response.js` owns deterministic grounded replies and builds the shared Responses API payload; `ai-core/response-service.js` owns the channel-independent OpenAI transport.
- `ai-core/index.js` is the public interface used by channel adapters.

## Channel adapters

- `api/chat.js` retains only web HTTP validation and diagnostics, then calls the shared guest-response service.
- `api/realtime.js` retains ephemeral credential transport and the proven Realtime model, Marin fallback, WebRTC client contract, semantic VAD, and interruption behavior. It requests the shared personality with voice presentation constraints around the shared grounding and knowledge.
- Realtime Voice exposes only a `handoff_to_front_desk` function. The browser forwards that function call to `api/handoff.js`, which re-runs the shared deterministic decision and service; the model receives the actual delivery result before speaking.
- `api/contact.js` retains contact-form validation and reuses the same shared Resend email transport as automatic Web/LINE/Voice handoff; no adapter contains Resend logic.
- Operational delivery uses `FRONT_DESK_EMAIL`. During rollout only, an unset or blank value falls back to the legacy `hotel.mapp158@gmail.com` address centralized in `ai-core/operational-config.js`; adapters and handoff code must not duplicate that address.
- Handoff emails never include raw LINE user IDs. Only guest-provided display name, email, or phone may be included, and payment/private-booking messages redact long numbers and omit unrelated history.

## LINE Messaging API adapter (phase 2)

- `api/line/webhook.js` verifies the exact raw request body using HMAC-SHA256 and `LINE_CHANNEL_SECRET`, then handles every event in the webhook. Text messages call `answerGuestMessage`; other event/message types are acknowledged and ignored without calling AI.
- Replies use LINE's reply endpoint and `LINE_CHANNEL_ACCESS_TOKEN`. Neither credential is returned or logged, and diagnostics contain only allow-listed source, code, HTTP status, and request ID fields.
- Empty verification webhooks are acknowledged without an AI call. Failed AI or LINE delivery is returned as a retryable webhook failure with safe diagnostics.
- Duplicate suppression uses `webhookEventId` (or a SHA-256 event digest fallback), an in-flight set, and a bounded ten-minute in-memory cache. This prevents obvious duplicates within a warm serverless instance only. It is **not persistent across instances, deployments, or cold starts**; durable cross-instance idempotency requires a shared datastore in a later phase.

## Response examples

The verified facts remain the same across channels; only their presentation changes.

| Channel | Before | After |
| --- | --- | --- |
| Web | `飯店有 3 個車位，另有配合停車場；實際車位仍需依當日現場狀況安排。` | `有喔～飯店有 3 個車位，另外也有配合停車場。如果您是開車過來，可以先跟我們說一聲；車位還是會依當天現場狀況協助安排 😊` |
| LINE | `目前沒有確認的兒童早餐價格資訊，建議詢問櫃台。` | `兒童早餐的價格我這邊目前沒有確認到耶～如果您需要，建議再跟櫃檯確認一下，這樣會比較準確。` |
| Voice | `目前沒有確認的兒童早餐價格資訊。建議詢問櫃台。` | `兒童早餐的價格，我這邊目前沒有確認到耶。建議再跟櫃檯確認一下，會比較準確。` |

Voice keeps the same acknowledgement, warmth, uncertainty, and honesty; its composer additionally prohibits Markdown, lists, emoji, and spoken URLs, and favors one to three short spoken sentences.
