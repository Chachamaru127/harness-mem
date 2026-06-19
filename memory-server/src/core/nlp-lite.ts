/**
 * nlp-lite.ts  (§F-1 / S78-C02b)
 *
 * Zero-dependency, heuristic-only NLP discriminators that classify:
 *   - entity tokens  → "person" | "technology" | "action" | "other"
 *   - relation pairs → "is_a"   | "uses"       | "fixes"  | "generic"
 *
 * Design constraints (set by §F-1 DoD):
 *   - No new heavy deps. No tokenizer libs. Pure regex + token tables.
 *   - Heuristic must give meaningful precision/recall lift over the §78-C02
 *     baseline (which had no notion of type/kind at all — everything was
 *     implicitly "other" / "co-occurs").
 *   - Discriminators must be deterministic and side-effect free so they can
 *     be unit-tested with table-driven cases.
 *
 * Each rule has a short Why-comment so reviewers (and future me) understand
 * which classes of false positive the rule is trying to dodge.
 */

export type EntityType = "person" | "technology" | "action" | "other";
export type RelationKind = "is_a" | "uses" | "fixes" | "generic";

// ---------------------------------------------------------------------------
// Entity type discriminator
// ---------------------------------------------------------------------------

/**
 * Known-tech vocabulary. Lowercased.
 *
 * Why a whitelist: a regex that matches "any CamelCase" would over-claim
 * "technology" for ordinary proper nouns (e.g. "BobSmith"). A short list of
 * unambiguous tech tokens keeps precision high; CamelCase-with-tech-root
 * (e.g. "ReactRouter") is handled by `TECH_ROOT_PREFIXES`.
 */
const TECH_TOKENS = new Set<string>([
  "typescript", "javascript", "python", "go", "golang", "rust", "ruby",
  "java", "kotlin", "swift", "c++", "csharp", "c#", "scala", "elixir",
  "react", "vue", "svelte", "angular", "nextjs", "next.js", "nuxt",
  "node", "nodejs", "node.js", "deno", "bun", "express", "fastify",
  "postgres", "postgresql", "mysql", "mariadb", "sqlite", "redis",
  "mongodb", "cassandra", "elasticsearch", "kafka", "rabbitmq",
  "docker", "kubernetes", "k8s", "terraform", "ansible", "helm",
  "aws", "gcp", "azure", "vercel", "cloudflare", "fly.io", "heroku",
  "github", "gitlab", "bitbucket", "jenkins", "circleci",
  "graphql", "rest", "grpc", "websocket", "webrtc", "oauth", "jwt",
  "tensorflow", "pytorch", "numpy", "pandas", "scikit-learn", "sklearn",
  "claude", "anthropic", "openai", "gpt", "llama", "mistral", "gemini",
  "mcp", "sqlite3", "tailwind", "tailwindcss", "shadcn",
]);

/** Tech-root prefix matches (case-insensitive) e.g. "ReactRouter" → tech. */
const TECH_ROOT_PREFIXES = [
  "react", "vue", "svelte", "angular", "next", "nuxt", "node",
  "express", "fastify", "postgres", "mysql", "redis", "docker",
  "kube", "k8s",
];

/**
 * File-extension regex covering source/config files most likely to
 * encode "technology" intent.  Why broad: a token like "deploy.sh"
 * is already obviously code-adjacent.
 */
const TECH_FILE_EXT_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|swift|cs|cpp|c|h|hpp|sh|sql|yaml|yml|toml)$/i;

/** Version-like suffix or pure version literal (v1, 1.2.3, etc). */
const VERSION_RE = /(?:^|[\s-])(v\d+(?:\.\d+){0,2}|\d+\.\d+(?:\.\d+)?)\b/;

/**
 * Honorifics — Latin + Japanese.
 *
 * Why minimal JA set: §F-1 says "JA support is a plus but not required".
 * Including just さん/氏/様/先生 lets common Japanese-language obs hit
 * "person" without dragging in a tokenizer.
 */
const HONORIFIC_RE = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sir|Madam)\.?\s+[A-Z][a-zA-Z'-]+/;
const JA_HONORIFIC_RE = /[一-鿿゠-ヿ぀-ゟA-Za-z]+(?:さん|氏|様|先生)/;

/**
 * Common given-name shape: a single Capitalized word of 3-15 letters,
 * standing on its own.  Used as a *weak* signal: must also NOT match the
 * tech whitelist or end with a code-y file extension.
 */
const NAME_TOKEN_RE = /^[A-Z][a-z]{2,14}$/;

/**
 * Action verbs that show up at the START of an observation or after
 * "to/will/should/can".  Why imperative-only: catching "running" as a
 * general gerund pulls in too many adjectives ("a running test"); we
 * stick to a short verb list with high commit-message recall.
 */
const ACTION_VERBS = new Set<string>([
  "fix", "fixes", "fixed", "fixing",
  "add", "adds", "added", "adding",
  "remove", "removes", "removed", "removing",
  "update", "updates", "updated", "updating",
  "refactor", "refactors", "refactored", "refactoring",
  "deploy", "deploys", "deployed", "deploying",
  "test", "tests", "tested", "testing",
  "merge", "merges", "merged", "merging",
  "revert", "reverts", "reverted", "reverting",
  "rename", "renames", "renamed", "renaming",
  "implement", "implements", "implemented", "implementing",
  "resolve", "resolves", "resolved", "resolving",
  "patch", "patches", "patched", "patching",
  "ship", "ships", "shipped", "shipping",
  "release", "releases", "released", "releasing",
  "rollback", "rollbacks", "rolled-back",
]);

/** Code-class suffixes that disqualify a Capitalized token from "person". */
const CODE_SUFFIX_RE =
  /(?:Error|Exception|Service|Manager|Controller|Handler|Component|Module|Config|Schema|Builder|Factory|Provider|Registry|Store|Container|Strategy|Adapter|Wrapper|Helper|Util|Utils|Repository|Client|Server|Request|Response|Event|Listener|Worker|Job|Task|Queue|Pool|Cache|Lock|Mutex|Condition)$/;

/**
 * Classify a single entity *label* (original form) into a coarse type.
 *
 * @param label   entity label as extracted by the regex extractor
 * @param context optional surrounding text — used to disambiguate (e.g.
 *                "I worked with Alice on it" → Alice as person)
 */
export function classifyEntityType(
  label: string,
  context: string = "",
): EntityType {
  if (!label) return "other";
  const lc = label.toLowerCase();

  // 1) tech: explicit whitelist hits first (highest precision)
  if (TECH_TOKENS.has(lc)) return "technology";

  // 2) tech: source-file extensions  (e.g. "worker.ts", "deploy.sh")
  if (TECH_FILE_EXT_RE.test(label)) return "technology";

  // 3) tech: known-root prefix in a CamelCase compound (e.g. "ReactRouter")
  if (/^[A-Z][a-zA-Z0-9]+$/.test(label)) {
    for (const prefix of TECH_ROOT_PREFIXES) {
      if (lc.startsWith(prefix) && lc !== prefix) return "technology";
    }
  }

  // 4) tech: version-like literal ("v3", "1.2.3")
  if (VERSION_RE.test(label)) return "technology";

  // 5) action: imperative verb token. We accept a leading capital too —
  //    "Fixed bug" is a common commit-message opener.
  if (ACTION_VERBS.has(lc)) return "action";

  // 6) person: honorific in context. We check `context` (not `label`)
  //    because the honorific usually sits *before* the entity label.
  if (context) {
    const honorificHit =
      HONORIFIC_RE.test(context) || JA_HONORIFIC_RE.test(context);
    if (honorificHit) {
      // Only attribute to *this* label if it looks name-shaped — otherwise
      // we'd tag "Docker" as a person because "Dr. Smith" appears nearby.
      if (NAME_TOKEN_RE.test(label) && !CODE_SUFFIX_RE.test(label)) {
        return "person";
      }
    }
  }

  // 7) person: bare name-shape token AND not a tech token AND no digits.
  //    Why so strict: this is the weakest signal — single Capitalized words
  //    are also class names, error names, etc.  We require the absence of
  //    digits and reject any obvious code-class suffix.
  if (NAME_TOKEN_RE.test(label) && !/\d/.test(label)) {
    if (CODE_SUFFIX_RE.test(label)) return "other";
    return "person";
  }

  return "other";
}

// ---------------------------------------------------------------------------
// Relation kind discriminator
// ---------------------------------------------------------------------------

/**
 * Patterns are matched against the FULL observation text. We then check
 * that both endpoint labels actually appear on the matched side of the
 * pattern — this stops us from over-claiming "X uses Y" when only one of
 * the two entities is present in the matched phrase.
 */
const IS_A_PATTERNS: RegExp[] = [
  // "X is a/an Y" / "X is the Y"
  /\b[\w.-]+\s+is\s+(?:an?|the)\s+[\w.-]+/i,
  // "X: Y" (definition form, both sides word-like)
  /\b[\w.-]+:\s+[\w.-]+\b/,
  // JA: "X は Y" (loose, no particle disambiguation)
  /[\w.-]+\s*は\s*[\w.-]+/,
];

const USES_PATTERNS: RegExp[] = [
  /\b[\w.-]+\s+(?:uses?|using|used)\s+[\w.-]+/i,
  /\b[\w.-]+\s+depends?\s+on\s+[\w.-]+/i,
  /\b[\w.-]+\s+requires?\s+[\w.-]+/i,
  /\b[\w.-]+\s+imports?\s+[\w.-]+/i,
  /\b[\w.-]+\s+calls?\s+[\w.-]+/i,
];

const FIXES_PATTERNS: RegExp[] = [
  /\b[\w.-]+\s+(?:fixes?|fixed|fixing)\s+[\w.-]+/i,
  /\b[\w.-]+\s+(?:resolves?|resolved)\s+[\w.-]+/i,
  /\b[\w.-]+\s+(?:patches?|patched)\s+[\w.-]+/i,
  /\b[\w.-]+\s+(?:repairs?|repaired)\s+[\w.-]+/i,
  // Conventional-commit prefix: "fix(scope): subject" — relates fix to subject
  /\bfix(?:\([\w.-]+\))?:\s*[\w.-]+/i,
];

/**
 * Test whether `src` and `dst` (lowercased labels) both appear within the
 * span matched by one of the patterns, in left-to-right order.
 */
function matchOrdered(
  text: string,
  patterns: RegExp[],
  src: string,
  dst: string,
): boolean {
  const lcText = text.toLowerCase();
  const lcSrc = src.toLowerCase();
  const lcDst = dst.toLowerCase();

  for (const pat of patterns) {
    // Use a global clone so we can scan multiple matches.
    const re = new RegExp(pat.source, pat.flags.includes("g") ? pat.flags : pat.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(lcText)) !== null) {
      const slice = m[0];
      const srcIdx = slice.indexOf(lcSrc);
      const dstIdx = slice.indexOf(lcDst);
      if (srcIdx >= 0 && dstIdx > srcIdx) return true;
      if (m.index === re.lastIndex) re.lastIndex++; // guard zero-width
    }
  }
  return false;
}

/**
 * Classify an unordered (src,dst) entity pair into one of the four
 * relation kinds, given the original observation text they co-occurred in.
 *
 * Priority order: `fixes` > `uses` > `is_a` > `generic`.
 * Why this order: "fix" is the most specific signal and overlaps
 * semantically with "uses" ("X's fix uses Y" should count as fixes).
 */
export function classifyRelationKind(
  src: string,
  dst: string,
  text: string,
): RelationKind {
  if (!text) return "generic";

  if (matchOrdered(text, FIXES_PATTERNS, src, dst)) return "fixes";
  if (matchOrdered(text, USES_PATTERNS, src, dst)) return "uses";
  if (matchOrdered(text, IS_A_PATTERNS, src, dst)) return "is_a";

  // Symmetric attempt: maybe the pair appears in the reverse order
  if (matchOrdered(text, FIXES_PATTERNS, dst, src)) return "fixes";
  if (matchOrdered(text, USES_PATTERNS, dst, src)) return "uses";
  if (matchOrdered(text, IS_A_PATTERNS, dst, src)) return "is_a";

  return "generic";
}
