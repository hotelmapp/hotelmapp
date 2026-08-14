import { RealtimeVoiceSession, VOICE_OPTIONS, loadSelectedVoice, saveSelectedVoice } from "./voice-assistant.js";

export const VOICE_STATUS = Object.freeze({
  idle: "語音待命", connecting: "連線中…", listening: "正在聆聽", user_speaking: "正在聽您說話",
  answering: "AI 正在思考", speaking: "AI 正在說話", muted: "麥克風已靜音"
});

export class VoiceMode {
  constructor({ root, home, storage = globalThis.localStorage, sessionFactory, onClose }) {
    this.root = root; this.home = home; this.storage = storage; this.onClose = onClose || (() => {});
    this.status = root.querySelector("[data-voice-status]");
    this.orb = root.querySelector("[data-voice-orb]");
    this.error = root.querySelector("[data-voice-error]");
    this.transcript = root.querySelector("[data-voice-transcript]");
    this.muteButton = root.querySelector("[data-voice-mute]");
    this.voiceSelector = root.querySelector("[data-voice-selector]");
    this.sessionFactory = sessionFactory || (callbacks => new RealtimeVoiceSession(callbacks));
    for (const voice of VOICE_OPTIONS) {
      const option = this.root.ownerDocument.createElement("option");
      option.textContent = `${voice.label} — ${voice.description}`; option.value = voice.id;
      this.voiceSelector.append(option);
    }
    this.voiceSelector.value = loadSelectedVoice(storage);
    this.root.querySelector("[data-voice-end]").addEventListener("click", () => this.close());
    this.muteButton.addEventListener("click", () => this.toggleMute());
    this.voiceSelector.addEventListener("change", () => this.changeVoice());
  }

  async open() {
    this.root.hidden = false;
    this.root.setAttribute("aria-hidden", "false");
    this.home?.setAttribute("inert", "");
    document.body.classList.add("voice-mode-open");
    this.error.textContent = "";
    this.transcript.replaceChildren();
    this.session = this.sessionFactory({
      onState: state => this.renderState(state),
      onTranscript: turn => this.addTranscript(turn),
      onError: message => { this.error.textContent = message; }
    });
    const connected = await this.session.start(this.voiceSelector.value);
    if (!connected) this.renderState("idle");
    return connected;
  }

  renderState(state) {
    this.root.dataset.state = state;
    this.orb.dataset.state = state;
    this.status.textContent = VOICE_STATUS[state] || state;
  }

  addTranscript(turn) {
    const line = document.createElement("p");
    const speaker = turn.role === "assistant" ? "AI" : "您";
    line.textContent = `${speaker}：${turn.text}`;
    this.transcript.append(line);
  }

  toggleMute() {
    if (!this.session?.active) return;
    const muted = this.session.setMuted(!this.session.muted);
    this.muteButton.setAttribute("aria-pressed", String(muted));
    this.muteButton.textContent = muted ? "🔇 解除靜音" : "🎙️ 麥克風";
  }

  async changeVoice() {
    saveSelectedVoice(this.storage, this.voiceSelector.value);
    if (!this.session?.active) return;
    this.session.stop();
    this.error.textContent = "";
    await this.session.start(this.voiceSelector.value);
  }

  close() {
    this.session?.stop();
    this.session = null;
    this.root.hidden = true;
    this.root.setAttribute("aria-hidden", "true");
    this.home?.removeAttribute("inert");
    document.body.classList.remove("voice-mode-open");
    this.muteButton.setAttribute("aria-pressed", "false");
    this.muteButton.textContent = "🎙️ 麥克風";
    this.renderState("idle");
    this.onClose();
  }
}
