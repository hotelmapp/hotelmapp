export const DEFAULT_TEXT_MODEL = "gpt-5.6-terra";
export const DEFAULT_TEXT_REASONING_EFFORT = "medium";
export const DEFAULT_ROUTING_REASONING_EFFORT = "low";

const REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh", "max"]);

function configuredValue(env, keys) {
  for (const key of keys) {
    const value = env?.[key]?.trim();
    if (value) return value;
  }
  return null;
}

export function configuredTextModel(env = process.env, componentKey = null) {
  return configuredValue(env, [componentKey, "OPENAI_MODEL"].filter(Boolean)) || DEFAULT_TEXT_MODEL;
}

export function supportsReasoning(model) {
  return /^(?:gpt-5(?:[.-]|$)|o[1-9](?:[.-]|$))/iu.test(String(model || ""));
}

export function configuredReasoning(model, env = process.env, {
  componentKeys = [],
  fallback = DEFAULT_TEXT_REASONING_EFFORT
} = {}) {
  if (!supportsReasoning(model)) return {};
  const requested = configuredValue(env, [...componentKeys, "OPENAI_REASONING_EFFORT"]);
  const effort = REASONING_EFFORTS.has(requested) ? requested : fallback;
  return REASONING_EFFORTS.has(effort) ? { reasoning: { effort } } : {};
}
