# HotelMapp AI Front Desk V4 — shared AI Core (phase 1)

## Architecture inventory

- `data/hotel-info.js` remains the single source of truth for hotel and breakfast facts. No channel owns a copy.
- `ai-core/knowledge.js` gives every channel the same knowledge version, serialized facts, and rules for unknown facts, breakfast grounding, live availability, and human escalation.
- `ai-core/booking.js` owns booking-intent detection, date extraction, and safe construction of dated URLs from the canonical booking URL. `stay-dates.js` remains the low-level multilingual date parser.
- `ai-core/handoff.js` owns channel-neutral conversation normalization, stay-date extraction, handoff category, and summary generation.
- `ai-core/index.js` is the public interface intended for channel adapters, including the next LINE phase.

## Channel adapters

- `api/chat.js` retains HTTP validation, Responses API transport, text-specific response style/history, and the existing deterministic web replies. It consumes shared knowledge grounding and booking functions.
- `api/realtime.js` retains ephemeral credential transport and the proven Realtime model, Marin fallback, WebRTC client contract, semantic VAD, and interruption behavior. It adds voice-specific conversational style around the shared grounding and knowledge.
- `api/contact.js` retains Resend validation and email delivery. Handoff classification and summary generation now come from the core.

## Next LINE phase

A LINE adapter can import `ai-core/index.js` to use `groundedKnowledgePrompt`, `hasBookingIntent`, `bookingDates`, `datedBookingUrl`, and `contactDetails`. It should add only LINE webhook verification, message formatting, reply-token handling, and delivery transport. It must not create or copy hotel facts. No LINE credentials or API integration are part of phase 1.
