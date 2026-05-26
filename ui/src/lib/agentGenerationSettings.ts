import type { AgentGenerationSettings } from "../components/agent/agentTypes";

export const DEFAULT_AGENT_GENERATION_SETTINGS: AgentGenerationSettings = {
  provider: "oauth",
  model: "gpt-5.5",
  quality: "medium",
  size: "1024x1024",
  format: "png",
  moderation: "low",
  reasoningEffort: "medium",
  webSearchEnabled: true,
  generationStrategy: "auto",
  variants: 1,
  maxAutoVariants: 8,
  parallelism: 2,
};

const LEGACY_DEFAULT_AGENT_MODEL = "gpt-5.4-mini";

export function withAgentGenerationDefaults(
  value: Partial<AgentGenerationSettings> | null | undefined,
): AgentGenerationSettings {
  const settings = migrateLegacyAgentDefaults(value);
  return {
    ...DEFAULT_AGENT_GENERATION_SETTINGS,
    ...settings,
  };
}

function migrateLegacyAgentDefaults(
  value: Partial<AgentGenerationSettings> | null | undefined,
): Partial<AgentGenerationSettings> | null | undefined {
  if (!value || value.model !== LEGACY_DEFAULT_AGENT_MODEL || !matchesDefaultAgentSettings(value)) return value;
  return { ...value, model: DEFAULT_AGENT_GENERATION_SETTINGS.model };
}

function matchesDefaultAgentSettings(value: Partial<AgentGenerationSettings>): boolean {
  const defaults = { ...DEFAULT_AGENT_GENERATION_SETTINGS, model: LEGACY_DEFAULT_AGENT_MODEL };
  return Object.entries(value).every(([key, current]) => current === defaults[key as keyof AgentGenerationSettings]);
}
