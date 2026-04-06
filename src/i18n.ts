type LocaleMessage = {
  en: string;
  "zh-CN": string;
};

export const MESSAGES = {
  "init.workspace_initialized": {
    en: "Initialized .brain workspace.",
    "zh-CN": "已初始化 .brain/ 目录。",
  },
  "init.steering_rules_generated": {
    en: "Generated steering rules: {{paths}}",
    "zh-CN": "已生成 steering rules: {{paths}}",
  },
  "init.project_brain_initialized": {
    en: "Initialized Project Brain in {{projectRoot}}",
    "zh-CN": "已在 {{projectRoot}} 初始化 Project Brain",
  },
  "setup.repobrain_initialized": {
    en: "Initialized RepoBrain in {{projectRoot}}",
    "zh-CN": "已在 {{projectRoot}} 初始化 RepoBrain",
  },
  "session.profile_updated": {
    en: "Session profile updated: {{path}}",
    "zh-CN": "会话 profile 已更新: {{path}}",
  },
  "session.profile_saved_local_runtime": {
    en: "Session hints were saved to local runtime only (not durable knowledge).",
    "zh-CN": "会话偏好已写入本地 runtime（非 durable knowledge）。",
  },
  "session.no_profile": {
    en: "No session profile file yet. Use `brain session-set` to create one.",
    "zh-CN": "尚无 session profile，可使用 `brain session-set` 创建。",
  },
  "session.profile_cleared": {
    en: "Session profile cleared.",
    "zh-CN": "已清除会话 profile。",
  },
  "session.preference_saved": {
    en: "Preference saved to: {{path}}",
    "zh-CN": "已保存偏好至: {{path}}",
  },
  "session.memory_saved": {
    en: "Memory saved to: {{path}}",
    "zh-CN": "已保存记忆至: {{path}}",
  },
  "preference.extract_failed": {
    en: "Could not extract a preference from this text (weak or ambiguous signal). Try explicit flags or a clearer sentence.",
    "zh-CN": "无法从该文本提取偏好（信号偏弱或含糊）。请写得更具体，或使用 --target / --type / --pref / --reason。",
  },
  "preference.input_required": {
    en: "Provide natural language via --input or stdin, or pass all of (--target, --type, --pref, --reason).",
    "zh-CN": "请使用 --input 或管道 stdin 输入自然语言，或提供 (--target, --type, --pref, --reason)。",
  },
  "preference.saved": {
    en: "Preference saved to: {{path}}",
    "zh-CN": "已保存偏好至: {{path}}",
  },
  "memory.supersede_already_exists": {
    en: "[brain] This supersede relationship already exists\n  New memory: {{newPath}} (v{{version}})\n  Old memory: {{oldPath}} -> already marked as stale",
    "zh-CN": "[brain] 该取代关系已存在\n  新记忆: {{newPath}} (v{{version}})\n  旧记忆: {{oldPath}} → 已标记为 stale",
  },
  "memory.supersede_existing_relationship": {
    en: "[brain] Existing supersede relationships:",
    "zh-CN": "[brain] 当前已存在取代关系:",
  },
  "memory.supersede_linked": {
    en: "✓ [brain] Supersede relationship linked\n  New memory: {{newPath}}  (v{{version}})\n  Old memory: {{oldPath}}  -> marked as stale",
    "zh-CN": "✓ [brain] 已建立取代关系\n  新记忆: {{newPath}}  (v{{version}})\n  旧记忆: {{oldPath}}  → 已标记为 stale",
  },
  "memory.reinforce_none_found": {
    en: "[brain] No memories to reinforce in this session ✓",
    "zh-CN": "[brain] 本次 session 未发现需要强化的记忆 ✓",
  },
} satisfies Record<string, LocaleMessage>;

export type MessageKey = keyof typeof MESSAGES;
export type SupportedLanguage = "en" | "zh-CN";

export function normalizeLanguage(lang: string | undefined): SupportedLanguage {
  if (!lang) {
    return "en";
  }
  const normalized = lang.trim().toLowerCase();
  return normalized.includes("zh") ? "zh-CN" : "en";
}

export function detectSystemLanguage(locales?: string[]): SupportedLanguage {
  if (Array.isArray(locales) && locales.length > 0) {
    const fromArgs = locales.join(",").toLowerCase();
    return fromArgs.includes("zh") ? "zh-CN" : "en";
  }
  const resolvedLocale = Intl.DateTimeFormat().resolvedOptions().locale ?? "";
  const envLocales = [process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG]
    .filter((value): value is string => Boolean(value))
    .join(",");
  const candidates = [resolvedLocale, envLocales].join(",").toLowerCase();
  return candidates.includes("zh") ? "zh-CN" : "en";
}

export function t(key: MessageKey, lang: string, vars: Record<string, string> = {}): string {
  const message = MESSAGES[key];
  const template = message[normalizeLanguage(lang)];
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => vars[name] ?? "");
}
