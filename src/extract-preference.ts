import type { Preference, PreferenceTargetType, PreferenceValue } from "./types.js";

const CONFIDENCE_THRESHOLD = 0.58;

/**
 * 尝试从自然语言输入中提取偏好倾向。
 * 启发式第一版，不依赖 LLM；弱信号返回 null。
 */
export function extractPreferenceFromNaturalLanguage(input: string, source = "manual"): Preference | null {
  const text = input.trim();
  if (text.length < 5) {
    return null;
  }

  const pref = detectPreferenceValue(text);
  if (!pref) {
    return null;
  }

  if (isVagueLeadIn(text)) {
    return null;
  }

  const targetInfo = detectTarget(text);
  if (!targetInfo) {
    return null;
  }

  const confidence = scoreConfidence(text, pref, targetInfo);
  if (confidence < CONFIDENCE_THRESHOLD) {
    return null;
  }

  const now = new Date().toISOString();

  return {
    kind: "routing_preference",
    target_type: targetInfo.type,
    target: targetInfo.name,
    preference: pref.value,
    reason: text,
    confidence,
    source,
    created_at: now,
    updated_at: now,
    status: "active",
  };
}

interface PrefDetect {
  value: PreferenceValue;
  /** explicit: 明确措辞；implicit: 仅由「繁琐/太慢」等推断 */
  via: "explicit" | "implicit";
}

function detectPreferenceValue(text: string): PrefDetect | null {
  const lower = text.toLowerCase();

  /** 「除非…否则…」类条件句：优先于句内的「不要」，记为 require_review */
  if (/除非/.test(text)) {
    return { value: "require_review", via: "explicit" };
  }

  if (
    /\b(prefer|倾向于)\b/i.test(lower) ||
    /优先|推荐|倾向于/.test(text) ||
    /\b(always)\b/.test(lower)
  ) {
    return { value: "prefer", via: "explicit" };
  }

  if (/总是|习惯/.test(text)) {
    return { value: "prefer", via: "explicit" };
  }

  if (
    /\b(avoid|不要|禁止|别用|不要走|绕过|避免)\b/i.test(lower) ||
    /不要|禁止|别用|不要走|绕过|避免/.test(text)
  ) {
    return { value: "avoid", via: "explicit" };
  }

  if (/\b(review|确认|问我|提示我)\b/i.test(lower) || /审核|确认|问我|提示我/.test(text)) {
    return { value: "require_review", via: "explicit" };
  }

  if (/换一个|太繁琐|繁琐|太慢/.test(text) || /\b(换一个|太繁琐|繁琐|太慢)\b/i.test(lower)) {
    return { value: "avoid", via: "implicit" };
  }

  return null;
}

function isVagueLeadIn(text: string): boolean {
  const t = text.trim();
  return /^(maybe|perhaps|possibly|可能|也许|不太确定|不知道|再说吧|想想)(?:\s|[,.!?]|$)/i.test(t);
}

interface TargetInfo {
  type: PreferenceTargetType;
  name: string;
  specificity: "high" | "medium" | "low";
}

function detectTarget(text: string): TargetInfo | null {
  const lower = text.toLowerCase();

  const commonSkills = ["playwright", "jest", "eslint", "prettier", "tsc", "vitest", "cypress", "webpack", "rollup"];
  for (const s of commonSkills) {
    if (lower.includes(s)) {
      return { type: "skill", name: s, specificity: "high" };
    }
  }

  const afterWalk = text.match(/走\s*([^\s，。\n]+?)\s*流程/);
  if (afterWalk?.[1]) {
    return { type: "workflow", name: normalizeTargetName(afterWalk[1]), specificity: "high" };
  }

  const workflowLoose = text.match(/([^。\n]+?)\s*流程/);
  if (workflowLoose?.[1]) {
    const raw = workflowLoose[1].trim();
    return { type: "workflow", name: normalizeTargetName(raw), specificity: raw.length > 24 ? "medium" : "high" };
  }

  const routeLoose = text.match(/([^。\n]+?)\s*路线/);
  if (routeLoose?.[1]) {
    const raw = routeLoose[1].trim();
    return { type: "workflow", name: normalizeTargetName(raw), specificity: "medium" };
  }

  if (/(高风险|high[-\s]?risk)/i.test(text) && /(改动|变更|change)/i.test(text)) {
    return { type: "task_class", name: "high-risk-change", specificity: "high" };
  }

  if (/\btask\b/i.test(text) && /(class|类别|类型|场景)/i.test(text)) {
    const m = text.match(/task\s+class\s+([\w-]+)/i);
    if (m?.[1]) {
      return { type: "task_class", name: m[1].toLowerCase(), specificity: "medium" };
    }
  }

  const commonWorkflows = ["release", "test", "lint", "build", "deploy", "commit"];
  for (const w of commonWorkflows) {
    if (lower.includes(w)) {
      return { type: "workflow", name: w, specificity: "low" };
    }
  }

  const skillWordMatch = text.match(/skill\s+([\w-]+)/i);
  if (skillWordMatch?.[1]) {
    return { type: "skill", name: skillWordMatch[1].toLowerCase(), specificity: "medium" };
  }

  return null;
}

function normalizeTargetName(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  if (t.length <= 48) {
    return t;
  }

  const parts = t.split(/[，,]/);
  const last = parts[parts.length - 1]?.trim();
  if (last && last.length < t.length && last.length <= 48) {
    return last;
  }

  return t.slice(0, 48).trim();
}

function scoreConfidence(text: string, pref: PrefDetect, target: TargetInfo): number {
  let score = 0.38;

  if (pref.via === "explicit") {
    score += 0.22;
  } else {
    score += 0.08;
  }

  switch (target.specificity) {
    case "high":
      score += 0.28;
      break;
    case "medium":
      score += 0.18;
      break;
    default:
      score += 0.08;
  }

  if (pref.via === "implicit" && target.specificity === "low") {
    score -= 0.25;
  }

  if (pref.value === "avoid" && pref.via === "implicit" && /\b(test|lint|build)\b/i.test(text)) {
    score += 0.05;
  }

  return Math.min(0.95, Math.max(0.2, score));
}
