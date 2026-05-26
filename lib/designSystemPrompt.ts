import { config } from "../config.js";
import {
  getActiveProjectDesignSystem,
  type ProjectDesignSystem,
} from "./designSystemStore.js";

export type DesignSystemApplication = {
  prompt: string;
  meta: {
    designSystemApplied: boolean;
    designSystemId?: string;
    designSystemTitle?: string;
    designSystemSource?: string;
    designSystemSkippedReason?: string;
  };
};

export function applyProjectDesignSystem(
  projectId: string,
  userPrompt: string,
  options: { enabled?: boolean } = {},
): DesignSystemApplication {
  if (options.enabled === false) {
    return {
      prompt: userPrompt,
      meta: {
        designSystemApplied: false,
        designSystemSkippedReason: "node-disabled",
      },
    };
  }
  const designSystem = getActiveProjectDesignSystem(projectId);
  if (!designSystem) {
    return {
      prompt: userPrompt,
      meta: {
        designSystemApplied: false,
        designSystemSkippedReason: "none-active",
      },
    };
  }
  return {
    prompt: [renderDesignSystemPrefix(designSystem), userPrompt].join("\n\n"),
    meta: {
      designSystemApplied: true,
      designSystemId: designSystem.id,
      designSystemTitle: designSystem.title,
      designSystemSource: designSystem.source,
    },
  };
}

function renderDesignSystemPrefix(designSystem: ProjectDesignSystem) {
  const body = designSystem.body
    .replace(/^#\s+.+$/m, "")
    .replace(/^>\s*Category:.*$/gim, "")
    .trim()
    .slice(0, config.designSystems.maxPromptPrefixChars);
  return [
    "MANDATORY PROJECT DESIGN SYSTEM RULES:",
    `Design system: ${designSystem.title}`,
    "Apply these rules consistently. If the user prompt conflicts with these rules, the project design system wins.",
    body,
    "END PROJECT DESIGN SYSTEM RULES.",
  ].filter(Boolean).join("\n");
}
