# Meta Messenger shared-channel adapter

## Architecture and reliability

`/api/meta/webhook` verifies Meta at the transport boundary and routes supported
Messenger text events through the same durable `answerWithConversation()` runtime
used by the other channels. Meta code contains no hotel facts, personality, topic
rules, service decisions, or handoff authorization. The common Meta security,
opaque identity, event normalization, dedupe and diagnostics are intentionally
usable by a future Instagram transport; Instagram delivery is not enabled yet.

The endpoint processes synchronously before acknowledging. This repository is a
plain Vercel serverless project and does not have a durable queue or a configured
`waitUntil` facility. Returning 200 before completion would therefore risk losing
work when the invocation is frozen. Dedupe is claimed in Upstash before the AI
call, and unsupported/echo/page-originated events safely return 200. A durable
queue should be introduced before switching to immediate acknowledgement at
higher volume.

## Vercel configuration

Set these encrypted environment variables manually (Preview first):

- `META_WEBHOOK_VERIFY_TOKEN`: a newly generated, high-entropy random value that
  is entered verbatim in Meta's **Messenger > Settings > Webhooks > Verify token**.
- `META_APP_SECRET`: Meta App Dashboard **App settings > Basic > App secret**.
- `META_PAGE_ACCESS_TOKEN`: the Page token generated/selected under **Messenger >
  Settings > Access tokens**. Never use a user token.
- `CONVERSATION_HMAC_SECRET`: the existing server-side conversation identity key.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or the existing
  `KV_REST_API_URL` and `KV_REST_API_TOKEN` aliases).
- Optional `META_GRAPH_API_VERSION`; the adapter defaults to `v26.0` so a future
  version change is scoped to this transport rather than unrelated integrations.

For production domain `https://<hotel-domain>`, the callback is
`https://<hotel-domain>/api/meta/webhook`. Subscribe the Page object to `messages`
only for this first text-only phase. Do not subscribe comments, reactions,
postbacks, attachments, payments, or marketing fields yet.

## Meta setup and review checklist

Meta's official Messenger Platform documentation specifies the GET subscription
challenge, `X-Hub-Signature-256` payload validation, and Send API. The adapter uses
`POST /<VERSION>/me/messages` with the Page access token in the Authorization
header. See the official [Webhooks](https://developers.facebook.com/docs/messenger-platform/webhooks),
[Send API](https://developers.facebook.com/docs/messenger-platform/send-messages),
and [Messenger permissions](https://developers.facebook.com/docs/permissions#messenger-platform)
documentation when performing the manual dashboard switch.

The Page must be connected to the app and the app needs `pages_messaging` for
Messenger replies. In Development mode, testing is limited to people with an app
role and test assets; public Page users require Live mode and the applicable App
Review/Business Verification approval for `pages_messaging`. Confirm the current
Graph version and review requirements in the dashboard immediately before the
manual switch because Meta versions and review policy change independently of
this repository.

No dashboard settings, Make.com callback, production deployment, or secrets are
changed by this commit.
