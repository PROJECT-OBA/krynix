// @krynix/adapter-openclaw — public API
// This is the single entry point for the OpenClaw adapter package.
// All public exports must go through this file.

export { OpenClawAdapter } from "./adapter.js";

export type {
  OpenClawHookEvent,
  OpenClawBeforeToolCallEvent,
  OpenClawAfterToolCallEvent,
  OpenClawLlmInputEvent,
  OpenClawLlmOutputEvent,
  OpenClawSessionStartEvent,
  OpenClawSessionEndEvent,
  OpenClawToolContext,
  OpenClawAgentContext,
  OpenClawSessionContext,
} from "./openclaw-types.js";

export {
  createKrynixPlugin,
  type KrynixPluginOptions,
  type KrynixPluginHandle,
  type OpenClawPluginApiMinimal,
} from "./plugin.js";
