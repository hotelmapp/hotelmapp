import { configuredConversationService } from "../ai-core/conversation/runtime.js";
import { frontDeskService } from "../ai-core/front-desk/service.js";
import { FrontDeskError } from "../ai-core/front-desk/store.js";
import { assertDeskOrigin, authenticateDesk, deskCookie, loginDesk, logoutDesk } from "../ai-core/front-desk/auth.js";

export const config = { maxDuration: 30 };
const FIELDS = {
  login: ["action", "password"], logout: ["action"], session: ["action"], inbox: ["action"],
  detail: ["action", "id"], takeover: ["action", "id"],
  reply: ["action", "id", "text", "epoch", "requestId"],
  reply_status: ["action", "id", "requestId"],
  close: ["action", "id", "summary", "epoch", "revision", "inboundVersion"]
};
export function createFrontDeskHandler({ env = process.env, createService = () => frontDeskService(configuredConversationService(), env) } = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "method_not_allowed" }); }
    try {
      assertDeskOrigin(req, env);
      if (String(req.headers?.["content-type"] || "").split(";")[0].trim().toLowerCase() !== "application/json") throw new FrontDeskError("json_required", 415);
      const body = req.body;
      if (!body || Array.isArray(body) || typeof body !== "object" || Buffer.byteLength(JSON.stringify(body)) > 12_000) throw new FrontDeskError("invalid_request", 400);
      const fields = Object.hasOwn(FIELDS, body.action) ? FIELDS[body.action] : null;
      if (!fields || Object.keys(body).some(key => !fields.includes(key))) throw new FrontDeskError("invalid_request", 400);
      const desk = createService();
      if (!desk) throw new FrontDeskError("front_desk_disabled", 503);
      if (body.action === "login") {
        const token = await loginDesk(body.password, desk.store, env);
        res.setHeader("Set-Cookie", deskCookie(token));
        return res.status(200).json({ authenticated: true });
      }
      await authenticateDesk(req, desk.store, env);
      if (body.action === "logout") {
        await logoutDesk(req, desk.store, env);
        res.setHeader("Set-Cookie", deskCookie("", 0));
        return res.status(200).json({ authenticated: false });
      }
      if (body.action === "session") return res.status(200).json({ authenticated: true });
      if (body.action === "inbox") return res.status(200).json({ conversations: await desk.inbox() });
      if (body.action === "detail") return res.status(200).json(await desk.detail(body.id));
      if (body.action === "takeover") return res.status(200).json({ control: await desk.takeover(body.id) });
      if (body.action === "reply") return res.status(200).json(await desk.reply(body));
      if (body.action === "reply_status") return res.status(200).json(await desk.replyStatus(body));
      if (body.action === "close") return res.status(200).json(await desk.close(body));
      throw new FrontDeskError("invalid_request", 400);
    } catch (error) {
      const code = error instanceof FrontDeskError ? error.code : error?.code === "conversation_conflict" ? "new_messages_arrived" : "front_desk_unavailable";
      const status = error instanceof FrontDeskError ? error.status : code === "new_messages_arrived" ? 409 : 503;
      // Never log passwords, cookies, route IDs, message contents or contacts.
      return res.status(status).json({ error: code });
    }
  };
}
export default createFrontDeskHandler();
