// Stable, channel-independent surface for web chat, Realtime Voice, and future LINE adapters.
export { hotelKnowledge, knowledgeForPrompt, KNOWLEDGE_VERSION, groundingInstructions, groundedKnowledgePrompt } from "./knowledge.js";
export { BOOKING_INTENT_PATTERN, hasBookingIntent, bookingDates, datedBookingUrl } from "./booking.js";
export { normalizedGuestMessages, stayDateFromHistory, contactDetails } from "./handoff.js";
export { hospitalityPersonalityInstructions, channelPresentationInstructions, styledInstructions } from "./hospitality-personality.js";
export { answerGuestMessage } from "./guest-response.js";
