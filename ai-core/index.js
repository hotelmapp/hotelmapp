// Stable, channel-independent surface for web chat, Realtime Voice, and future LINE adapters.
export { hotelKnowledge, knowledgeForPrompt, KNOWLEDGE_VERSION, groundingInstructions, groundedKnowledgePrompt } from "./knowledge.js";
export { BOOKING_INTENT_PATTERN, hasBookingIntent, bookingDates, datedBookingUrl } from "./booking.js";
export { normalizedGuestMessages, stayDateFromHistory, contactDetails, decideHandoff } from "./handoff.js";
export { performHandoff, handoffEmail, handoffGuestReply } from "./handoff-service.js";
export { hospitalityPersonalityInstructions, channelPresentationInstructions, styledInstructions } from "./hospitality-personality.js";
export { answerGuestMessage } from "./guest-response.js";
