// Stable, channel-independent surface for web chat, Realtime Voice, and future LINE adapters.
export { hotelKnowledge, knowledgeForPrompt, KNOWLEDGE_VERSION, groundingInstructions, groundedKnowledgePrompt } from "./knowledge.js";
export { BOOKING_INTENT_PATTERN, hasBookingIntent, bookingDates, datedBookingUrl } from "./booking.js";
export { normalizedGuestMessages, stayDateFromHistory, contactDetails, decideHandoff } from "./handoff.js";
export { performHandoff, handoffEmail, handoffGuestReply } from "./handoff-service.js";
export { hospitalityPersonalityInstructions, channelPresentationInstructions, renderHospitalityFact, styledInstructions } from "./hospitality-personality.js";
export { answerGuestMessage } from "./guest-response.js";
export { HOTEL_TIME_ZONE, FRONT_DESK_HOURS, TemporalContextProvider, temporalContextProvider, temporalContextPrompt } from "./temporal-context.js";
export { CONVERSATION_LIMITS, CHANNELS, opaqueConversationId, lineConversationId, createConversationRecord, appendTurn, minimizeConversationText } from "./conversation/record.js";
export { ConversationStore, RedisConversationStore, ConversationStoreError, ConversationConflictError, conversationStoreFromEnv } from "./conversation/store.js";
export { ConversationService } from "./conversation/service.js";
export { explicitTopic, resolveConversationTopic, resolveRequestedIntent, factsForTopic, factualContract, resolveKnowledgeGrounding, knowledgeGroundingInstructions, parkingReply, validateGroundedResponse } from "./knowledge-grounding.js";
