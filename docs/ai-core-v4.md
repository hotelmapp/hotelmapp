# HotelMapp AI Front Desk V4 — shared AI Core and LINE adapter

## Architecture inventory

- `data/hotel-info.js` remains the single source of truth for hotel and breakfast facts. No channel owns a copy.
- `ai-core/knowledge.js` gives every channel the same knowledge version, serialized facts, and rules for unknown facts, breakfast grounding, live availability, and human escalation.
- `ai-core/booking.js` owns booking-intent detection, date extraction, and safe construction of dated URLs from the canonical booking URL. `stay-dates.js` remains the low-level multilingual date parser.
- `ai-core/handoff.js` owns channel-neutral conversation normalization, stay-date extraction, handoff category, and summary generation.
- `ai-core/guest-response.js` owns deterministic grounded replies and builds the shared Responses API payload; `ai-core/response-service.js` owns the channel-independent OpenAI transport.
- `ai-core/index.js` is the public interface used by channel adapters.

## Channel adapters

- `api/chat.js` retains only web HTTP validation and diagnostics, then calls the shared guest-response service.
- `api/realtime.js` retains ephemeral credential transport and the proven Realtime model, Marin fallback, WebRTC client contract, semantic VAD, and interruption behavior. It adds voice-specific conversational style around the shared grounding and knowledge.
- `api/contact.js` retains Resend validation and email delivery. Handoff classification and summary generation now come from the core.

## LINE Messaging API adapter (phase 2)

- `api/line/webhook.js` verifies the exact raw request body using HMAC-SHA256 and `LINE_CHANNEL_SECRET`, then handles every event in the webhook. Text messages call `answerGuestMessage`; other event/message types are acknowledged and ignored without calling AI.
- Replies use LINE's reply endpoint and `LINE_CHANNEL_ACCESS_TOKEN`. Neither credential is returned or logged, and diagnostics contain only allow-listed source, code, HTTP status, and request ID fields.
- Empty verification webhooks are acknowledged without an AI call. Failed AI or LINE delivery is returned as a retryable webhook failure with safe diagnostics.
- Duplicate suppression uses `webhookEventId` (or a SHA-256 event digest fallback), an in-flight set, and a bounded ten-minute in-memory cache. This prevents obvious duplicates within a warm serverless instance only. It is **not persistent across instances, deployments, or cold starts**; durable cross-instance idempotency requires a shared datastore in a later phase.
