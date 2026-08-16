# Phase 4.1 conversation foundation

Web, LINE, and Voice use the channel-neutral contract in `ai-core/conversation`. Production memory is Redis REST only; there is deliberately no process-memory authoritative fallback.

## Runtime configuration

- `KV_REST_API_URL` and `KV_REST_API_TOKEN` (Vercel KV), or `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (Upstash Redis REST).
- `CONVERSATION_HMAC_SECRET`: a high-entropy server-only secret used to derive LINE conversation identities. Rotating it intentionally loses existing short-term LINE context.

Records use a 24-hour sliding TTL, non-extendable 48-hour absolute expiry, at most 20 turns, and 48 KB serialized capacity. Redis Lua CAS protects updates and atomic `SET NX PX` provides event idempotency. Web IDs are server-generated opaque values. LINE source IDs are HMAC-derived and never Redis keys. Voice IDs are short opaque capabilities issued with ephemeral Realtime credentials. Channels are intentionally not linked into a guest profile.

If Redis is unavailable, public FAQ answers may run stateless. State-dependent handoff is denied rather than sent, and memory failure never triggers email. This phase creates neither a permanent guest profile nor a new conversational email flow.

Conversation records retain the resolved topic for reference continuity. Before an answer, the shared grounding layer resolves the topic primarily from guest turns and reloads current authoritative facts. Generated assistant turns remain non-authoritative transcript content and cannot override current hotel knowledge.
