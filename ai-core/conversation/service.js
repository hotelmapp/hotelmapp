import { appendTurn, createConversationRecord } from "./record.js";
import { ConversationConflictError } from "./store.js";

export class ConversationService {
  constructor({ store, now = () => new Date() }) { this.store = store; this.now = now; }
  async context(id) { return await this.store.get(id); }
  async history(id) { return (await this.store.get(id))?.turns?.map(({ role, content }) => ({ role, content })) || []; }
  async append(id, channel, turns, { topic, intent, state } = {}) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = await this.store.get(id);
      let next = current || createConversationRecord({ id, channel, now: this.now() });
      for (const turn of turns) next = appendTurn(next, turn, { now: this.now() });
      if (topic) next.topic = topic;
      if (intent) next.intent = intent;
      if (state) next.state = state;
      try { await this.store.compareAndSet(id, current?.revision ?? -1, next); return { ...next, revision: (current?.revision ?? -1) + 1 }; }
      catch (error) { if (!(error instanceof ConversationConflictError) || attempt === 3) throw error; }
    }
  }
}
