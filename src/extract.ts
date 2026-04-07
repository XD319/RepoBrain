import { spawn } from "node:child_process";

import { appendErrorLog } from "./store.js";
import type {
  BrainConfig,
  ExtractedMemoriesPayload,
  Importance,
  Memory,
  MemoryArea,
  MemorySource,
  MemoryType,
} from "./types.js";
import { IMPORTANCE_LEVELS, MEMORY_TYPES } from "./types.js";

const EXTRACTION_PROMPT = `You are a repo knowledge extractor. Analyze the completed coding conversation or change summary and extract only project knowledge that deserves to persist across future sessions.

Only extract these categories:
1. DECISION: important architecture or technology choices and why they were made
2. GOTCHA: known pitfalls, limitations, or "do not do X because Y"
3. CONVENTION: naming, directory layout, code style, or collaboration conventions
4. PATTERN: reusable implementation or workflow patterns
5. WORKING: temporary but still useful working context that should expire soon
6. GOAL: durable project goals or migration targets worth tracking across sessions

Extraction rules:
- Only keep knowledge that is still useful in future sessions
- Prefer why and scope, not a plain description of what changed
- Ignore temporary discussion, greetings, and one-off details
- Fewer and more accurate memories are better than many weak ones

Return strict JSON only:
{
  "memories": [
    {
      "type": "decision",
      "title": "Short title",
      "summary": "One-sentence summary",
      "detail": "Markdown detail with background, decision or limitation, and scope",
      "tags": ["tag1", "tag2"],
      "importance": "high|medium|low",
      "source": "session",
      "created": "YYYY-MM-DD",
      "updated": "YYYY-MM-DD",
      "area": "auth|api|db|infra|ui|testing|general",
      "files": ["src/auth/**"],
      "expires": "YYYY-MM-DD",
      "status": "active|done|stale"
    }
  ]
}

If there is nothing worth saving, return {"memories": []}. Do not output anything except JSON.`;

type EvidenceKind = "prefix" | "keyword" | "structure" | "path" | "risk" | "cause" | "limit" | "commit" | "noise";
type RejectReason =
  | "low_information_density"
  | "temporary_debug_noise"
  | "action_log_without_reusable_learning"
  | "weak_type_signal"
  | "duplicate_candidate";

interface ExtractionSection {
  name: string;
  content: string;
  kind: "prose" | "metadata" | "changed-files" | "diff-stat";
}

interface PreprocessedExtractionInput {
  text: string;
  source: MemorySource;
  sections: ExtractionSection[];
  commitFiles: string[];
  discoveredFiles: string[];
}

interface ExtractionFragment {
  order: number;
  text: string;
  contextText: string;
  section: string;
  source: MemorySource;
  relatedFiles: string[];
  structureSignals: string[];
}

interface ExtractionEvidence {
  kind: EvidenceKind;
  detail: string;
  weight: number;
}

interface LocalCandidateDraft {
  fragment: ExtractionFragment;
  chosenType: MemoryType;
  typeScores: Record<MemoryType, number>;
  extractionEvidence: ExtractionEvidence[];
}

interface ScoredLocalCandidate extends LocalCandidateDraft {
  memory: Memory;
  qualityScore: number;
  rejectReason?: RejectReason;
}

interface SignalRule {
  pattern: RegExp;
  weight: number;
  detail: string;
  kind?: EvidenceKind;
}

const TYPE_SIGNAL_RULES: Record<MemoryType, SignalRule[]> = {
  decision: [
    {
      pattern:
        /\b(?:decision|decided|choose|chose|adopt|adopted|switch to|standardize|standardized|keep using|use\b|selected)\b/iu,
      weight: 2.2,
      detail: "decision keyword",
    },
    { pattern: /(?:决定|采用|改为|统一使用|选用|保留|切换到|标准化)/u, weight: 2.3, detail: "decision keyword (zh)" },
    {
      pattern: /\b(?:because|so that|to avoid|for consistency|for rollback|for safety)\b/iu,
      weight: 1.2,
      detail: "decision rationale",
      kind: "cause",
    },
  ],
  gotcha: [
    {
      pattern:
        /\b(?:gotcha|pitfall|beware|avoid|never|must not|do not|don't|fails? when|breaks? when|otherwise|regression|partial write|data loss|rollback|race condition|deadlock)\b/iu,
      weight: 2.8,
      detail: "risk or gotcha keyword",
      kind: "risk",
    },
    {
      pattern: /(?:不要|避免|否则|会导致|陷阱|注意|坑|报错|失败|死锁|回滚|半写入|数据丢失)/u,
      weight: 2.8,
      detail: "risk or gotcha keyword (zh)",
      kind: "risk",
    },
    {
      pattern: /\b(?:must stay|must keep|only when|cannot|can't|outside the|directly write)\b/iu,
      weight: 1.3,
      detail: "limitation wording",
      kind: "limit",
    },
  ],
  convention: [
    {
      pattern:
        /\b(?:convention|naming|directory|layout|folder|style|standard|always put|store .* under|keep .* under|use the .* folder)\b/iu,
      weight: 2.3,
      detail: "convention keyword",
    },
    {
      pattern: /(?:约定|规范|统一放在|统一使用|命名|目录|放到.*目录|保持.*结构)/u,
      weight: 2.4,
      detail: "convention keyword (zh)",
    },
    {
      pattern: /\b(?:prefer|recommended|should live in|belongs in)\b/iu,
      weight: 1.1,
      detail: "convention preference",
      kind: "keyword",
    },
  ],
  pattern: [
    {
      pattern:
        /\b(?:pattern|reusable|workflow|pipeline|helper|wrap .* with|route .* through|extract .* helper|template|fan out|shared .* parser)\b/iu,
      weight: 2.3,
      detail: "pattern keyword",
    },
    {
      pattern: /(?:模式|流程|封装|抽成.*helper|通过.*处理|复用|共享解析器|统一走)/u,
      weight: 2.4,
      detail: "pattern keyword (zh)",
    },
    {
      pattern: /\b(?:use .* to|so callers|shared path|common path)\b/iu,
      weight: 1.1,
      detail: "pattern phrasing",
      kind: "keyword",
    },
  ],
  working: [
    {
      pattern:
        /\b(?:working|for now|in progress|pending|follow-up|remaining|checklist|track this|until rollout|next step|ongoing)\b/iu,
      weight: 2.2,
      detail: "working-context keyword",
    },
    {
      pattern: /(?:进行中|待办|剩余|跟进|清单|当前先|后续|推进中|直到发布)/u,
      weight: 2.2,
      detail: "working-context keyword (zh)",
    },
  ],
  goal: [
    {
      pattern: /\b(?:goal|target|migration|roadmap|objective|end state|eventually|long term|north star)\b/iu,
      weight: 2.4,
      detail: "goal keyword",
    },
    { pattern: /(?:目标|迁移到|最终|长期|收敛到|规划|里程碑|终态)/u, weight: 2.4, detail: "goal keyword (zh)" },
    {
      pattern: /\b(?:finish|complete|move .* to|remove the legacy path)\b/iu,
      weight: 1.1,
      detail: "goal action phrasing",
      kind: "keyword",
    },
  ],
};

const CAUSE_PATTERN =
  /\b(?:because|since|so that|to avoid|to prevent|to keep|ensures?|prevents?|due to|why:)\b|(?:因为|因此|以便|为了|避免|防止|否则|这样可以|原因是)/iu;
const RISK_PATTERN =
  /\b(?:risk|bug|regression|rollback|corrupt|partial|leak|crash|panic|unsafe|inconsistent|drift)\b|(?:风险|问题|报错|失败|泄漏|回滚|不一致|漂移|半写入)/iu;
const LIMIT_PATTERN =
  /\b(?:must|must not|should|should not|never|always|cannot|can't|only|required|forbidden)\b|(?:必须|不要|不能|只能|禁止|务必|一律)/iu;
const TEMPORARY_PATTERN =
  /\b(?:temporary|temp|for now|today only|one-off|debug only|wip|todo|this run|current branch)\b|(?:临时|暂时|一次性|仅调试|本次|这轮)/iu;
const NOISE_PATTERN =
  /\b(?:console\.log|debug log|printf?\(|print\(|typo|format only|snapshot update|ran tests?|npm install|pnpm install|yarn install|bump version)\b|(?:打印日志|调试日志|修个 typo|只改格式|跑了测试)/iu;
const ACTION_LOG_ONLY_PATTERN =
  /^\s*(?:[-*]\s*)?(?:fixed|updated|renamed|added|removed|changed|touched|ran|修复了|更新了|改了|新增了|删除了)/iu;
const COMMIT_SUBJECT_ONLY_PATTERN =
  /^(?:subject:\s*)?(?:feat|fix|refactor|chore|docs|test|build|ci|perf)(?:\(.+?\))?:/iu;
const GENERIC_TITLE_PATTERN = /^(?:summary|notes|update|fixes|changes|修复记录|总结|说明)$/iu;
const FILE_PATH_PATTERN = /(?:^|[\s`"'(])((?:[A-Za-z0-9._-]+[\\/])+[A-Za-z0-9._*-]+(?:\.[A-Za-z0-9._-]+)?)/gu;
const SENTENCE_SPLIT_PATTERN = /(?<=[.!?。！？；;])\s+/u;

const TYPE_PRIORITY: Record<MemoryType, number> = {
  gotcha: 6,
  decision: 5,
  convention: 4,
  pattern: 3,
  goal: 2,
  working: 1,
};

const AREA_RULES: Array<{ area: MemoryArea; pattern: RegExp }> = [
  { area: "auth", pattern: /\b(?:auth|token|session|login|oauth|permission)\b|(?:认证|登录态|权限|令牌|会话)/iu },
  {
    area: "api",
    pattern: /\b(?:api|route|request|response|http|graphql|rpc|endpoint|controller)\b|(?:接口|路由|请求|响应)/iu,
  },
  {
    area: "db",
    pattern: /\b(?:db|database|sql|query|migration|transaction|schema|ledger|orm)\b|(?:数据库|事务|迁移|表结构|账本)/iu,
  },
  {
    area: "infra",
    pattern:
      /\b(?:infra|build|deploy|ci|release|config|hook|docker|env|cli)\b|(?:基础设施|构建|发布|配置|钩子|命令行)/iu,
  },
  { area: "ui", pattern: /\b(?:ui|component|page|css|frontend|view|layout)\b|(?:界面|组件|页面|前端|布局)/iu },
  {
    area: "testing",
    pattern: /\b(?:test|spec|fixture|mock|assert|snapshot|integration)\b|(?:测试|夹具|断言|集成测试|mock)/iu,
  },
];

const DOMAIN_TAG_RULES: Array<{ tag: string; pattern: RegExp }> = [
  { tag: "extract", pattern: /\bextract(?:or|ion)?\b|(?:抽取|提取)/iu },
  { tag: "memory", pattern: /\bmemory|repo brain\b|(?:记忆|记忆库)/iu },
  { tag: "git", pattern: /\bgit|commit|diff stat\b|(?:提交|变更文件)/iu },
  { tag: "review", pattern: /\breview|candidate\b|(?:评审|候选)/iu },
  { tag: "transaction", pattern: /\btransaction|rollback|ledger\b|(?:事务|回滚|账本)/iu },
  { tag: "auth", pattern: /\bauth|token|session|login\b|(?:认证|登录态|令牌|会话)/iu },
  { tag: "api", pattern: /\bapi|route|request|response\b|(?:接口|路由|请求|响应)/iu },
  { tag: "testing", pattern: /\btest|fixture|mock|spec\b|(?:测试|夹具|mock)/iu },
  { tag: "config", pattern: /\bconfig|yaml|env|flag\b|(?:配置|开关)/iu },
  { tag: "migration", pattern: /\bmigration|legacy|rollout\b|(?:迁移|旧路径|灰度)/iu },
];

const TAG_STOP_WORDS = new Set([
  "src",
  "test",
  "tests",
  "lib",
  "dist",
  "docs",
  "packages",
  "package",
  "node",
  "modules",
  "index",
  "main",
  "readme",
  "file",
  "files",
  "folder",
  "summary",
  "session",
  "project",
  "repo",
  "code",
  "using",
  "use",
  "keep",
  "with",
  "from",
  "into",
  "that",
  "this",
  "should",
  "must",
  "always",
  "avoid",
  "because",
]);

const TITLE_FILLER_PREFIXES = [
  /^we (?:should|must|need to|now)\s+/iu,
  /^it(?:'s| is) important to\s+/iu,
  /^always\s+/iu,
  /^please\s+/iu,
  /^建议\s*/u,
  /^需要\s*/u,
  /^必须\s*/u,
  /^应该\s*/u,
];

export async function extractMemories(
  conversationText: string,
  config: BrainConfig,
  projectRoot: string = process.cwd(),
): Promise<Memory[]> {
  const trimmed = conversationText.trim();
  if (!trimmed) {
    return [];
  }

  const prompt = buildExtractionPrompt(trimmed, config);
  const extractorCommand = process.env.BRAIN_EXTRACTOR_COMMAND?.trim();

  if (!extractorCommand) {
    return heuristicExtract(trimmed, config);
  }

  try {
    const rawOutput = await runExtractorCommand(extractorCommand, prompt);
    const parsed = safeParsePayload(rawOutput);
    if (!parsed.ok) {
      await appendErrorLog(projectRoot, `Extractor output invalid: ${parsed.error}`);
      return heuristicExtract(trimmed, config);
    }

    return parsed.payload.memories;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendErrorLog(projectRoot, `Extractor command failed: ${message}`);
    return heuristicExtract(trimmed, config);
  }
}

export function buildExtractionPrompt(conversationText: string, config: BrainConfig): string {
  const detectedLanguage = detectMemoryLanguage(conversationText, config.language);
  return [
    EXTRACTION_PROMPT,
    "",
    `Preferred output language: ${detectedLanguage}`,
    "",
    "Content to analyze:",
    conversationText,
  ].join("\n");
}

async function runExtractorCommand(command: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // The extractor command receives the full prompt on stdin and must return strict JSON on stdout.
    const child = spawn(command, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Extractor exited with code ${code}`));
        return;
      }

      resolve(stdout);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function safeParsePayload(raw: string): { ok: true; payload: ExtractedMemoriesPayload } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw) as { memories?: unknown };
    if (!Array.isArray(parsed.memories)) {
      return { ok: false, error: "JSON payload must include a memories array." };
    }

    const memories = parsed.memories
      .map((entry) => normalizeMemory(entry))
      .filter((memory): memory is Memory => memory !== null);

    if (memories.length !== parsed.memories.length) {
      return {
        ok: false,
        error: "One or more memory entries were missing required fields or used unsupported values.",
      };
    }

    return { ok: true, payload: { memories } };
  } catch {
    return { ok: false, error: buildJsonParseErrorMessage(raw) };
  }
}

function normalizeMemory(value: unknown): Memory | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const type = asNonEmptyString(candidate.type);
  const title = asNonEmptyString(candidate.title);
  const summary = asNonEmptyString(candidate.summary);
  const detail = asNonEmptyString(candidate.detail);
  const importance = asNonEmptyString(candidate.importance);

  if (
    !type ||
    !title ||
    !summary ||
    !detail ||
    !importance ||
    !MEMORY_TYPES.includes(type as MemoryType) ||
    !IMPORTANCE_LEVELS.includes(importance as Memory["importance"])
  ) {
    return null;
  }

  const now = new Date().toISOString();
  const createdAt = toIsoDateOnly(now);

  const memory: Memory = {
    type: type as MemoryType,
    title,
    summary,
    detail,
    tags: Array.isArray(candidate.tags) ? candidate.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
    importance: importance as Memory["importance"],
    date: now,
    score: getInitialExtractedMemoryScore(type as MemoryType, importance as Memory["importance"]),
    hit_count: 0,
    last_used: null,
    created_at: createdAt,
    created: asOptionalIsoDateOnly(candidate.created) ?? createdAt,
    updated: asOptionalIsoDateOnly(candidate.updated) ?? createdAt,
    stale: false,
    status: "active",
    files: Array.isArray(candidate.files) ? candidate.files.map((file) => String(file).trim()).filter(Boolean) : [],
  };

  const source = normalizeSource(candidate.source);
  if (source) {
    memory.source = source;
  }

  const area = asNonEmptyString(candidate.area);
  if (area) {
    memory.area = area as NonNullable<Memory["area"]>;
  }

  const expires = asOptionalIsoDateOnly(candidate.expires);
  if (expires) {
    memory.expires = expires;
  }

  const status = asNonEmptyString(candidate.status);
  if (status) {
    memory.status = status as NonNullable<Memory["status"]>;
  }

  return memory;
}

function heuristicExtract(conversationText: string, config: BrainConfig): Memory[] {
  return runLocalExtractionPipeline(conversationText, config);
}

function runLocalExtractionPipeline(conversationText: string, config: BrainConfig): Memory[] {
  const preprocessed = preprocessExtractionInput(conversationText);
  const fragments = segmentIntoFragments(preprocessed);
  const drafts = fragments
    .map((fragment) => identifyCandidate(fragment))
    .filter((candidate): candidate is LocalCandidateDraft => candidate !== null);
  const preferredLanguage = detectMemoryLanguage(conversationText, config.language);
  const completed = drafts.map((candidate) => completeCandidate(candidate, preferredLanguage, preprocessed.source));
  const deduped = dedupeCandidates(completed);
  const reviewed = reviewCandidatesBeforeWrite(deduped);

  return reviewed
    .sort((left, right) => left.fragment.order - right.fragment.order)
    .map((candidate) => candidate.memory);
}

function preprocessExtractionInput(conversationText: string): PreprocessedExtractionInput {
  const normalizedText = normalizeConversationText(conversationText);
  const source = detectSource(normalizedText);
  const sections = splitIntoSections(normalizedText);
  const commitFiles = extractCommitFiles(sections);
  const discoveredFiles = normalizeFilePaths([...commitFiles, ...extractPathsFromText(normalizedText)]);

  return {
    text: normalizedText,
    source,
    sections,
    commitFiles,
    discoveredFiles,
  };
}

function segmentIntoFragments(input: PreprocessedExtractionInput): ExtractionFragment[] {
  const fragments: ExtractionFragment[] = [];
  const seen = new Set<string>();
  let order = 0;

  const pushFragment = (
    text: string,
    contextText: string,
    section: string,
    relatedFiles: string[],
    structureSignals: string[],
  ): void => {
    const cleanedText = cleanupFragmentText(text);
    const cleanedContext = cleanupFragmentText(contextText);
    if (!cleanedText || !cleanedContext || shouldSkipFragment(cleanedText, section)) {
      return;
    }

    const key = normalizeForKey(`${section}:${cleanedText}`);
    if (!key || seen.has(key)) {
      return;
    }

    seen.add(key);
    fragments.push({
      order,
      text: cleanedText,
      contextText: cleanedContext,
      section,
      source: input.source,
      relatedFiles: normalizeFilePaths([...relatedFiles, ...extractPathsFromText(cleanedContext)]),
      structureSignals,
    });
    order += 1;
  };

  for (const section of input.sections) {
    if (section.kind === "changed-files" || section.kind === "diff-stat") {
      continue;
    }

    const blocks = section.content
      .split(/\n{2,}/u)
      .map((block) => block.trim())
      .filter(Boolean);
    const sectionFiles = normalizeFilePaths([
      ...input.commitFiles,
      ...input.discoveredFiles,
      ...extractPathsFromText(section.content),
    ]);
    const consumedBlocks = new Set<number>();

    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      if (consumedBlocks.has(blockIndex)) {
        continue;
      }

      const block = blocks[blockIndex];
      if (!block) {
        continue;
      }
      const nextBlock = blocks[blockIndex + 1];
      const hasExplicitPrefix = /^(?:[-*]\s*)?(decision|gotcha|convention|pattern|working|goal)\s*[:\-]/iu.test(block);
      const shouldMergeWithNext =
        hasExplicitPrefix &&
        Boolean(nextBlock) &&
        !/^(?:[-*]\s*)?(decision|gotcha|convention|pattern|working|goal)\s*[:\-]/iu.test(nextBlock ?? "") &&
        !nextBlock?.split(/\n/u).some((line) => isBulletLine(line.trim()));
      const contextBlock = shouldMergeWithNext && nextBlock ? `${block}\n\n${nextBlock}` : block;

      pushFragment(block, contextBlock, section.name, sectionFiles, [`section:${section.kind}`, "block"]);
      if (shouldMergeWithNext) {
        consumedBlocks.add(blockIndex + 1);
      }

      const lines = block
        .split(/\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
      const bullets = lines.filter((line) => isBulletLine(line));
      if (bullets.length > 0) {
        const bulletHeader = lines.find((line) => !isBulletLine(line));
        for (const bullet of bullets) {
          const bulletText = stripBulletMarker(bullet);
          const bulletContext = bulletHeader ? `${bulletHeader}\n${bulletText}` : bulletText;
          pushFragment(bulletText, bulletContext, section.name, sectionFiles, [`section:${section.kind}`, "bullet"]);
        }
      }

      const sentences = block
        .split(SENTENCE_SPLIT_PATTERN)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length >= 28);
      if (sentences.length > 1) {
        for (let index = 0; index < sentences.length; index += 1) {
          const first = sentences[index];
          const second = sentences[index + 1];
          if (!first) {
            continue;
          }

          const windowText = second ? `${first} ${second}` : first;
          pushFragment(windowText, windowText, section.name, sectionFiles, [
            `section:${section.kind}`,
            "sentence-window",
          ]);
        }
      }
    }
  }

  return fragments;
}

function identifyCandidate(fragment: ExtractionFragment): LocalCandidateDraft | null {
  const typeScores = createEmptyTypeScoreMap();
  const extractionEvidence: ExtractionEvidence[] = [];
  const text = fragment.text;
  const normalized = normalizeForKey(text);

  const prefixMatch = text.match(/^(?:[-*]\s*)?(decision|gotcha|convention|pattern|working|goal)\s*[:\-]\s*(.+)$/iu);
  if (prefixMatch?.[1]) {
    const prefixedType = prefixMatch[1].toLowerCase() as MemoryType;
    addEvidence(typeScores, extractionEvidence, prefixedType, 5.5, "prefix", `explicit ${prefixedType} prefix`);
  }

  for (const type of MEMORY_TYPES) {
    for (const rule of TYPE_SIGNAL_RULES[type]) {
      if (rule.pattern.test(text)) {
        addEvidence(typeScores, extractionEvidence, type, rule.weight, rule.kind ?? "keyword", rule.detail);
      }
    }
  }

  if (CAUSE_PATTERN.test(text)) {
    extractionEvidence.push({ kind: "cause", detail: "cause or rationale signal", weight: 1.1 });
    typeScores.decision += 0.9;
    typeScores.pattern += 0.8;
    typeScores.gotcha += 0.6;
    typeScores.goal += 0.3;
  }

  if (RISK_PATTERN.test(text)) {
    extractionEvidence.push({ kind: "risk", detail: "risk signal", weight: 1.2 });
    typeScores.gotcha += 1.4;
    typeScores.decision += 0.4;
  }

  if (LIMIT_PATTERN.test(text)) {
    extractionEvidence.push({ kind: "limit", detail: "constraint signal", weight: 1.0 });
    typeScores.gotcha += 0.8;
    typeScores.convention += 0.8;
    typeScores.decision += 0.4;
  }

  if (
    (/\b(?:goal|target|migration|roadmap|objective)\b/iu.test(text) || /(?:目标|迁移|规划|里程碑)/u.test(text)) &&
    (/\b(?:end state|long term|eventually|remove the legacy path|after rollout)\b/iu.test(text) ||
      /(?:终态|长期|最终|去掉旧路径|完成发布后)/u.test(text))
  ) {
    extractionEvidence.push({ kind: "keyword", detail: "goal + end-state combination", weight: 1.6 });
    typeScores.goal += 1.8;
  }

  if (fragment.relatedFiles.length > 0) {
    extractionEvidence.push({
      kind: "path",
      detail: `path signal: ${fragment.relatedFiles.slice(0, 3).join(", ")}`,
      weight: 1.0,
    });
    typeScores.decision += 0.7;
    typeScores.gotcha += 0.7;
    typeScores.convention += 0.8;
    typeScores.pattern += 0.8;
  }

  if (fragment.source === "git-commit") {
    extractionEvidence.push({ kind: "commit", detail: "git commit context", weight: 0.8 });
    typeScores.decision += 0.4;
    typeScores.pattern += 0.5;
    typeScores.gotcha += 0.3;
  }

  for (const structureSignal of fragment.structureSignals) {
    extractionEvidence.push({ kind: "structure", detail: structureSignal, weight: 0.4 });
    if (structureSignal === "bullet") {
      typeScores.gotcha += 0.2;
      typeScores.convention += 0.2;
      typeScores.pattern += 0.2;
    }
  }

  if (NOISE_PATTERN.test(text)) {
    extractionEvidence.push({ kind: "noise", detail: "debug or procedural noise", weight: -2.0 });
  }

  const bestType = chooseBestType(typeScores);
  const bestScore = typeScores[bestType];
  const hasStrongSignal = extractionEvidence.some((entry) => entry.weight >= 1 && entry.kind !== "noise");

  if (!normalized || (!hasStrongSignal && bestScore < 2.4)) {
    return null;
  }

  return {
    fragment,
    chosenType: bestType,
    typeScores,
    extractionEvidence,
  };
}

function normalizeConversationText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[•●▪◦]/gu, "-")
    .replace(/\t/g, "  ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function detectSource(value: string): MemorySource {
  if (/^Source:\s*git-commit\b/imu.test(value) || /^commit [a-f0-9]{7,40}$/imu.test(value)) {
    return "git-commit";
  }

  return "session";
}

function splitIntoSections(value: string): ExtractionSection[] {
  const lines = value.split(/\n/u);
  const sections: ExtractionSection[] = [];
  let currentName = "summary";
  let currentKind: ExtractionSection["kind"] = "prose";
  let currentLines: string[] = [];

  const pushCurrent = (): void => {
    const content = currentLines.join("\n").trim();
    if (!content) {
      currentLines = [];
      return;
    }

    sections.push({
      name: currentName,
      content,
      kind: currentKind,
    });
    currentLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const headingMatch = line.match(/^##\s+(.+)$/u);
    if (headingMatch?.[1]) {
      pushCurrent();
      currentName = headingMatch[1].trim().toLowerCase();
      currentKind = classifySectionKind(currentName);
      continue;
    }

    currentLines.push(line);
  }

  pushCurrent();
  if (sections.length === 0) {
    sections.push({
      name: "summary",
      content: value.trim(),
      kind: "prose",
    });
  }

  return sections;
}

function classifySectionKind(name: string): ExtractionSection["kind"] {
  if (name.includes("changed files")) {
    return "changed-files";
  }

  if (name.includes("diff stat")) {
    return "diff-stat";
  }

  if (name.includes("metadata")) {
    return "metadata";
  }

  return "prose";
}

function extractCommitFiles(sections: ExtractionSection[]): string[] {
  const files: string[] = [];

  for (const section of sections) {
    if (section.kind !== "changed-files" && section.kind !== "diff-stat") {
      continue;
    }

    const lines = section.content
      .split(/\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      const statusMatch = line.match(/^(?:[A-Z?]{1,2})\s+(.+)$/u);
      if (statusMatch?.[1]) {
        const rawPath = statusMatch[1].split("\t").at(-1) ?? statusMatch[1];
        files.push(rawPath);
        continue;
      }

      const statMatch = line.match(/^(.+?)\s+\|\s+\d+/u);
      if (statMatch?.[1]) {
        files.push(statMatch[1]);
      }
    }
  }

  return normalizeFilePaths(files);
}

function cleanupFragmentText(value: string): string {
  return value
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function shouldSkipFragment(value: string, section: string): boolean {
  const cleaned = value.trim();
  if (!cleaned) {
    return true;
  }

  if (/^(?:source|revision|author|date):/iu.test(cleaned) && cleaned.split(/\n/u).length === 1) {
    return true;
  }

  if (section.includes("changed files") || section.includes("diff stat")) {
    return true;
  }

  if (/^[A-Z?]{1,2}\s+[\w./\\-]+$/u.test(cleaned)) {
    return true;
  }

  return false;
}

function isBulletLine(value: string): boolean {
  return /^(?:[-*]|\d+\.)\s+/u.test(value);
}

function stripBulletMarker(value: string): string {
  return value.replace(/^(?:[-*]|\d+\.)\s+/u, "").trim();
}

function createEmptyTypeScoreMap(): Record<MemoryType, number> {
  return {
    decision: 0,
    gotcha: 0,
    convention: 0,
    pattern: 0,
    working: 0,
    goal: 0,
  };
}

function addEvidence(
  typeScores: Record<MemoryType, number>,
  evidence: ExtractionEvidence[],
  type: MemoryType,
  weight: number,
  kind: EvidenceKind,
  detail: string,
): void {
  typeScores[type] += weight;
  evidence.push({ kind, detail: `${type}: ${detail}`, weight });
}

function chooseBestType(typeScores: Record<MemoryType, number>): MemoryType {
  return MEMORY_TYPES.reduce((best, current) => {
    const currentScore = typeScores[current];
    const bestScore = typeScores[best];

    if (currentScore > bestScore) {
      return current;
    }

    if (currentScore === bestScore && TYPE_PRIORITY[current] > TYPE_PRIORITY[best]) {
      return current;
    }

    return best;
  }, "decision" satisfies MemoryType);
}

function completeCandidate(
  candidate: LocalCandidateDraft,
  language: string,
  source: MemorySource,
): ScoredLocalCandidate {
  const now = new Date().toISOString();
  const files = deriveFiles(candidate.fragment);
  const title = deriveTitle(candidate.fragment.text, candidate.fragment.contextText, candidate.chosenType, language);
  const summary = deriveSummary(candidate.fragment.contextText, candidate.fragment.text, language);
  const area = deriveArea(candidate.fragment.contextText, files);
  const tags = deriveTags(candidate.fragment.contextText, files, candidate.chosenType, area);
  const importance = deriveImportance(candidate.fragment.contextText, candidate.chosenType, files);
  const pathScope = derivePathScope(files);
  const memory: Memory = {
    type: candidate.chosenType,
    title,
    summary,
    detail: buildDetail(candidate.chosenType, candidate.fragment.contextText, files, language),
    tags,
    importance,
    date: now,
    score: getInitialExtractedMemoryScore(candidate.chosenType, importance),
    hit_count: 0,
    last_used: null,
    created_at: toIsoDateOnly(now),
    created: toIsoDateOnly(now),
    updated: toIsoDateOnly(now),
    stale: false,
    source,
    status: "active",
    files,
    path_scope: pathScope,
    area,
  };

  const { qualityScore, rejectReason } = scoreCandidateQuality(candidate, memory);
  return {
    ...candidate,
    memory,
    qualityScore,
    ...(rejectReason ? { rejectReason } : {}),
  };
}

function dedupeCandidates(candidates: ScoredLocalCandidate[]): ScoredLocalCandidate[] {
  const byKey = new Map<string, ScoredLocalCandidate>();

  for (const candidate of candidates) {
    const keys = buildDedupeKeys(candidate);
    let matchedKey: string | null = null;
    for (const key of keys) {
      if (byKey.has(key)) {
        matchedKey = key;
        break;
      }
    }

    if (!matchedKey) {
      const nearDuplicate = Array.from(new Set(byKey.values())).find((existing) =>
        isNearDuplicateCandidate(existing, candidate),
      );
      if (nearDuplicate) {
        matchedKey = buildDedupeKeys(nearDuplicate)[0] ?? null;
      }
    }

    if (!matchedKey) {
      for (const key of keys) {
        byKey.set(key, candidate);
      }
      continue;
    }

    const existing = byKey.get(matchedKey);
    if (!existing) {
      continue;
    }

    const preferred = choosePreferredCandidate(existing, candidate);
    const duplicate = preferred === existing ? candidate : existing;
    duplicate.rejectReason = duplicate.rejectReason ?? "duplicate_candidate";
    for (const key of [...buildDedupeKeys(existing), ...buildDedupeKeys(candidate)]) {
      byKey.set(key, preferred);
    }
  }

  return Array.from(new Set(byKey.values()));
}

function reviewCandidatesBeforeWrite(candidates: ScoredLocalCandidate[]): ScoredLocalCandidate[] {
  return candidates.filter((candidate) => {
    if (candidate.rejectReason) {
      return false;
    }

    if (GENERIC_TITLE_PATTERN.test(candidate.memory.title)) {
      candidate.rejectReason = "low_information_density";
      return false;
    }

    if (
      candidate.memory.type !== "working" &&
      TEMPORARY_PATTERN.test(`${candidate.memory.title}\n${candidate.memory.summary}`) &&
      candidate.qualityScore < 70
    ) {
      candidate.rejectReason = "temporary_debug_noise";
      return false;
    }

    return candidate.qualityScore >= 48;
  });
}

function deriveFiles(fragment: ExtractionFragment): string[] {
  return normalizeFilePaths(fragment.relatedFiles).slice(0, 5);
}

function derivePathScope(files: string[]): string[] {
  const scopes = files.map((file) => {
    const normalized = file.replace(/\\/g, "/");
    const slashIndex = normalized.lastIndexOf("/");
    if (slashIndex <= 0) {
      return normalized;
    }

    return `${normalized.slice(0, slashIndex)}/**`;
  });

  return Array.from(new Set(scopes)).slice(0, 5);
}

function deriveTitle(text: string, contextText: string, type: MemoryType, language: string): string {
  const explicit = text.match(/^(?:[-*]\s*)?(decision|gotcha|convention|pattern|working|goal)\s*[:\-]\s*(.+)$/iu)?.[2];
  const base = explicit || pickBestSentence(contextText) || pickBestSentence(text) || text;
  const withoutLabels = base
    .replace(/^subject:\s*/iu, "")
    .replace(/^body:\s*/iu, "")
    .replace(/^fix(?:es)? summary:\s*/iu, "")
    .trim();
  const withoutCause =
    withoutLabels
      .split(/\b(?:because|so that|to avoid|to prevent|otherwise)\b|(?:因为|以便|为了|避免|否则)/iu)[0]
      ?.trim() ?? withoutLabels;
  let title = withoutCause.replace(/[;；,.，。]+$/u, "").trim();

  for (const pattern of TITLE_FILLER_PREFIXES) {
    title = title.replace(pattern, "").trim();
  }

  if (COMMIT_SUBJECT_ONLY_PATTERN.test(title)) {
    const fallback = contextText
      .split(/\n/u)
      .map((line) => line.trim())
      .find((line) => line && !COMMIT_SUBJECT_ONLY_PATTERN.test(line) && !/^subject:/iu.test(line));
    if (fallback) {
      title = fallback.trim();
    }
  }

  if (title.length > 88) {
    title = title
      .slice(0, 88)
      .replace(/\s+\S*$/u, "")
      .trim();
  }

  if (!title) {
    title = defaultTitleForType(type, language);
  }

  return title;
}

function deriveSummary(contextText: string, text: string, language: string): string {
  const chosen = pickBestSentence(contextText) || pickBestSentence(text) || text;
  const summary = chosen
    .replace(/^subject:\s*/iu, "")
    .replace(/^body:\s*/iu, "")
    .trim();

  if (summary.length <= 140) {
    return summary;
  }

  const shortened = summary
    .slice(0, 140)
    .replace(/\s+\S*$/u, "")
    .trim();
  return (
    shortened || (language.startsWith("zh") ? "提取出一条可复用的仓库记忆。" : "Extracted one reusable repo memory.")
  );
}

function pickBestSentence(value: string): string {
  const candidates = value
    .split(/\n/u)
    .flatMap((line) => line.split(SENTENCE_SPLIT_PATTERN))
    .map((line) => stripBulletMarker(line.trim()))
    .filter(Boolean)
    .filter((line) => !/^(?:source|revision|author|date):/iu.test(line))
    .filter((line) => !/^body:$/iu.test(line))
    .filter((line) => !/^changed files$/iu.test(line))
    .filter((line) => !/^diff stat$/iu.test(line))
    .filter((line) => line.length >= 18);

  const ranked = candidates
    .map((line) => ({
      line,
      score: rankSentence(line),
    }))
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.line ?? "";
}

function rankSentence(value: string): number {
  let score = Math.min(18, Math.floor(value.length / 10));

  if (CAUSE_PATTERN.test(value)) {
    score += 6;
  }
  if (RISK_PATTERN.test(value)) {
    score += 6;
  }
  if (LIMIT_PATTERN.test(value)) {
    score += 4;
  }
  if (FILE_PATH_PATTERN.test(value)) {
    score += 4;
  }
  if (COMMIT_SUBJECT_ONLY_PATTERN.test(value)) {
    score -= 10;
  }
  if (NOISE_PATTERN.test(value)) {
    score -= 12;
  }

  return score;
}

function buildDetail(type: MemoryType, contextText: string, files: string[], language: string): string {
  const heading = language.startsWith("zh") ? `## ${typeToChineseHeading(type)}` : `## ${type.toUpperCase()}`;
  const lines = [heading, "", contextText.trim()];

  if (files.length > 0 && !files.every((file) => contextText.includes(file))) {
    lines.push("", `${language.startsWith("zh") ? "作用范围文件" : "Scope files"}: ${files.join(", ")}`);
  }

  return lines.join("\n");
}

function deriveTags(contextText: string, files: string[], type: MemoryType, area: MemoryArea): string[] {
  const tags: string[] = [type, area];

  for (const rule of DOMAIN_TAG_RULES) {
    if (rule.pattern.test(contextText)) {
      tags.push(rule.tag);
    }
  }

  for (const file of files) {
    const segments = file
      .replace(/\\/g, "/")
      .split("/")
      .flatMap((segment) => segment.split(/[._-]/u))
      .map((segment) => segment.trim().toLowerCase())
      .filter((segment) => segment.length >= 3 && !TAG_STOP_WORDS.has(segment));
    tags.push(...segments.slice(0, 2));
  }

  const tokenMatches = contextText.match(/[A-Za-z][A-Za-z0-9_-]{2,}/gu) ?? [];
  for (const token of tokenMatches) {
    const normalized = token.toLowerCase();
    if (!TAG_STOP_WORDS.has(normalized)) {
      tags.push(normalized);
    }
  }

  return Array.from(new Set(tags)).slice(0, 6);
}

function deriveArea(contextText: string, files: string[]): MemoryArea {
  const scores = new Map<MemoryArea, number>([
    ["auth", 0],
    ["api", 0],
    ["db", 0],
    ["infra", 0],
    ["ui", 0],
    ["testing", 0],
    ["general", 0.1],
  ]);
  const combined = `${contextText}\n${files.join("\n")}`;

  for (const rule of AREA_RULES) {
    if (rule.pattern.test(combined)) {
      scores.set(rule.area, (scores.get(rule.area) ?? 0) + 1.5);
    }
  }

  for (const file of files) {
    const normalized = file.toLowerCase();
    if (normalized.includes("/test") || normalized.includes(".test.") || normalized.includes("fixture")) {
      scores.set("testing", (scores.get("testing") ?? 0) + 2);
    }
    if (normalized.includes("/auth") || normalized.includes("token") || normalized.includes("session")) {
      scores.set("auth", (scores.get("auth") ?? 0) + 2);
    }
    if (normalized.includes("/api") || normalized.includes("/route") || normalized.includes("controller")) {
      scores.set("api", (scores.get("api") ?? 0) + 2);
    }
    if (normalized.includes("/db") || normalized.includes("migration") || normalized.includes("schema")) {
      scores.set("db", (scores.get("db") ?? 0) + 2);
    }
    if (normalized.includes("/ui") || normalized.includes("/components") || normalized.includes("/pages")) {
      scores.set("ui", (scores.get("ui") ?? 0) + 2);
    }
    if (normalized.includes("config") || normalized.includes("hook") || normalized.includes("cli")) {
      scores.set("infra", (scores.get("infra") ?? 0) + 1.6);
    }
  }

  return Array.from(scores.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? "general";
}

function deriveImportance(contextText: string, type: MemoryType, files: string[]): Importance {
  const combined = `${contextText}\n${files.join("\n")}`;
  const strongRisk =
    /\b(?:critical|core|never|must|must not|data loss|security|rollback|unsafe|cannot)\b|(?:关键|核心|必须|绝不能|数据丢失|回滚|安全)/iu.test(
      combined,
    );
  const mediumSignal =
    /\b(?:prefer|should|recommended|consistency|shared|standardize|migration|goal)\b|(?:建议|应该|统一|规范|迁移|目标)/iu.test(
      combined,
    );

  if (type === "gotcha" && (strongRisk || RISK_PATTERN.test(combined))) {
    return "high";
  }

  if (type === "decision" && strongRisk) {
    return "high";
  }

  if (type === "goal" && /\b(?:migration|remove legacy|end state)\b|(?:迁移|去掉旧路径|终态)/iu.test(combined)) {
    return "medium";
  }

  if (mediumSignal || files.length > 0 || type === "convention" || type === "pattern") {
    return "medium";
  }

  return "low";
}

function scoreCandidateQuality(
  candidate: LocalCandidateDraft,
  memory: Memory,
): { qualityScore: number; rejectReason?: RejectReason } {
  const combined = `${memory.title}\n${memory.summary}\n${memory.detail}`;
  const tokens = normalizeForKey(combined).split(" ").filter(Boolean);
  const maxTypeScore = candidate.typeScores[candidate.chosenType];
  let score = 18 + Math.round(maxTypeScore * 8);

  if (memory.summary.length >= 40) {
    score += 8;
  }
  if (memory.detail.length >= 90) {
    score += 8;
  }
  if (memory.files && memory.files.length > 0) {
    score += 10;
  }
  if (candidate.extractionEvidence.some((entry) => entry.kind === "cause")) {
    score += 10;
  }
  if (candidate.extractionEvidence.some((entry) => entry.kind === "risk")) {
    score += 12;
  }
  if (candidate.extractionEvidence.some((entry) => entry.kind === "limit")) {
    score += 8;
  }
  if (candidate.fragment.source === "git-commit") {
    score += 4;
  }
  if (tokens.length >= 12) {
    score += 6;
  }

  if (NOISE_PATTERN.test(combined)) {
    score -= 30;
  }
  if (TEMPORARY_PATTERN.test(combined) && candidate.chosenType !== "working" && candidate.chosenType !== "goal") {
    score -= 18;
  }
  if (ACTION_LOG_ONLY_PATTERN.test(memory.summary) && !CAUSE_PATTERN.test(combined) && !RISK_PATTERN.test(combined)) {
    score -= 24;
  }
  if (tokens.length < 8 || memory.summary.length < 24) {
    score -= 22;
  }
  if (maxTypeScore < 2.5) {
    score -= 18;
  }

  score = clamp(score, 0, 100);

  if (NOISE_PATTERN.test(combined) || (TEMPORARY_PATTERN.test(combined) && candidate.chosenType !== "working")) {
    return { qualityScore: score, rejectReason: "temporary_debug_noise" };
  }

  if (ACTION_LOG_ONLY_PATTERN.test(memory.summary) && !CAUSE_PATTERN.test(combined) && !RISK_PATTERN.test(combined)) {
    return { qualityScore: score, rejectReason: "action_log_without_reusable_learning" };
  }

  if (maxTypeScore < 2.5) {
    return { qualityScore: score, rejectReason: "weak_type_signal" };
  }

  if (tokens.length < 8 || memory.summary.length < 24) {
    return { qualityScore: score, rejectReason: "low_information_density" };
  }

  return { qualityScore: score };
}

function buildDedupeKeys(candidate: ScoredLocalCandidate): string[] {
  const normalizedTitle = normalizeForKey(candidate.memory.title);
  const normalizedSummary = normalizeForKey(candidate.memory.summary).split(" ").slice(0, 10).join("-");
  const filesKey = (candidate.memory.files ?? []).join("|");

  return [
    `${candidate.memory.type}:${normalizedTitle}`,
    `${candidate.memory.type}:${normalizedSummary}`,
    `${candidate.memory.type}:${normalizedTitle}:${filesKey}`,
  ].filter(Boolean);
}

function choosePreferredCandidate(left: ScoredLocalCandidate, right: ScoredLocalCandidate): ScoredLocalCandidate {
  const leftHasPrefix = left.extractionEvidence.some((entry) => entry.kind === "prefix");
  const rightHasPrefix = right.extractionEvidence.some((entry) => entry.kind === "prefix");

  if (left.memory.type !== right.memory.type && leftHasPrefix !== rightHasPrefix) {
    return leftHasPrefix ? left : right;
  }

  if ((right.qualityScore ?? 0) !== (left.qualityScore ?? 0)) {
    return right.qualityScore > left.qualityScore ? right : left;
  }

  if (right.memory.files?.length !== left.memory.files?.length) {
    return (right.memory.files?.length ?? 0) > (left.memory.files?.length ?? 0) ? right : left;
  }

  return right.fragment.order < left.fragment.order ? right : left;
}

function isNearDuplicateCandidate(left: ScoredLocalCandidate, right: ScoredLocalCandidate): boolean {
  const leftTitle = normalizeForKey(left.memory.title);
  const rightTitle = normalizeForKey(right.memory.title);
  const leftSummary = normalizeForKey(left.memory.summary);
  const rightSummary = normalizeForKey(right.memory.summary);
  const sharedFile = (left.memory.files ?? []).some((file) => right.memory.files?.includes(file));
  const eitherHasExplicitPrefix =
    left.extractionEvidence.some((entry) => entry.kind === "prefix") ||
    right.extractionEvidence.some((entry) => entry.kind === "prefix");
  const titleOverlap =
    leftTitle === rightTitle ||
    leftTitle.includes(rightTitle) ||
    rightTitle.includes(leftTitle) ||
    getTokenOverlap(leftTitle, rightTitle) >= 0.6;
  const summaryOverlap =
    leftSummary === rightSummary ||
    leftSummary.includes(rightSummary) ||
    rightSummary.includes(leftSummary) ||
    getTokenOverlap(leftSummary, rightSummary) >= 0.55;

  if (left.memory.type !== right.memory.type) {
    return eitherHasExplicitPrefix && titleOverlap && (summaryOverlap || sharedFile);
  }

  return titleOverlap || (sharedFile && summaryOverlap);
}

function getTokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  const union = new Set([...leftTokens, ...rightTokens]);
  if (union.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  return intersection / union.size;
}

function normalizeFilePaths(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .map((value) => value.replace(/^["'`(]+|[)"'`,.:;]+$/gu, ""))
        .map((value) => value.replace(/\\/g, "/"))
        .map((value) => value.replace(/^a\//u, "").replace(/^b\//u, ""))
        .filter((value) => value.includes("/"))
        .filter((value) => !value.startsWith("http://") && !value.startsWith("https://"))
        .filter((value) => /[A-Za-z0-9]/u.test(value))
        .filter((value) => !/^\d+(?:\/\d+)+$/u.test(value)),
    ),
  ).slice(0, 8);
}

function extractPathsFromText(value: string): string[] {
  const paths: string[] = [];
  for (const match of value.matchAll(FILE_PATH_PATTERN)) {
    const candidate = match[1];
    if (candidate) {
      paths.push(candidate);
    }
  }

  return normalizeFilePaths(paths);
}

function normalizeSource(value: unknown): Memory["source"] | null {
  if (typeof value !== "string") {
    return "session";
  }

  if (value === "session" || value === "git-commit" || value === "manual" || value === "pr") {
    return value;
  }

  return "session";
}

function getInitialExtractedMemoryScore(type: MemoryType, importance: Memory["importance"]): number {
  if (type === "gotcha") {
    if (importance === "high") {
      return 75;
    }

    if (importance === "medium") {
      return 60;
    }
  }

  if (type === "decision") {
    return 65;
  }

  if (type === "convention") {
    return 55;
  }

  if (type === "working") {
    return 45;
  }

  if (type === "goal") {
    return 58;
  }

  return 50;
}

function defaultTitleForType(type: MemoryType, language: string = "en"): string {
  if (language.startsWith("zh")) {
    switch (type) {
      case "decision":
        return "记录一条实现决策";
      case "gotcha":
        return "记录一条关键陷阱";
      case "convention":
        return "记录一条项目约定";
      case "pattern":
        return "记录一条可复用模式";
      case "working":
        return "跟踪当前工作上下文";
      case "goal":
        return "跟踪一个长期目标";
    }
  }

  switch (type) {
    case "decision":
      return "Capture an implementation decision";
    case "gotcha":
      return "Capture an important gotcha";
    case "convention":
      return "Capture a project convention";
    case "pattern":
      return "Capture a reusable pattern";
    case "working":
      return "Track working context";
    case "goal":
      return "Track a durable goal";
  }
}

function toIsoDateOnly(value: string): string {
  return value.slice(0, 10);
}

function typeToChineseHeading(type: MemoryType): string {
  switch (type) {
    case "decision":
      return "决策";
    case "gotcha":
      return "陷阱";
    case "convention":
      return "约定";
    case "pattern":
      return "模式";
    case "working":
      return "工作上下文";
    case "goal":
      return "目标";
  }
}

function detectMemoryLanguage(value: string, fallback: string = "en"): string {
  const cjkMatches = value.match(/[\u4e00-\u9fff]/gu) ?? [];
  const latinMatches = value.match(/[A-Za-z]/g) ?? [];
  if (cjkMatches.length === 0 && latinMatches.length === 0) {
    return fallback;
  }

  // Bias toward Chinese when the input clearly contains meaningful Chinese text,
  // even if there are many ASCII chars from file paths or code identifiers.
  if (cjkMatches.length >= 4 && cjkMatches.length * 20 >= latinMatches.length) {
    return "zh-CN";
  }

  return "en";
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asOptionalIsoDateOnly(value: unknown): string | undefined {
  const raw = asNonEmptyString(value);
  if (!raw) {
    return undefined;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    return undefined;
  }

  return new Date(parsed).toISOString().slice(0, 10);
}

function buildJsonParseErrorMessage(raw: string): string {
  const preview = raw.replace(/\s+/g, " ").trim().slice(0, 200);
  return preview ? `stdout was not valid JSON. Preview: ${preview}` : "stdout was empty or not valid JSON.";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeForKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
