// Backwards-compatible Vercel route. Meta was originally configured with
// /api/meta-webhook, while the production adapter lives at /api/meta/webhook.
// Re-export `config` as well as the handler so Vercel preserves the raw request
// body required by X-Hub-Signature-256 verification on either route.
export { config, default } from "./meta/webhook.js";
