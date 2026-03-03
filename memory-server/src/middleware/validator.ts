export interface ValidationConfig {
  /** コンテンツ最大文字数 */
  maxContentLength: number;
  /** タイトル最大文字数 */
  maxTitleLength: number;
  /** タグ最大数 */
  maxTags: number;
  /** タグ最大文字数 */
  maxTagLength: number;
  /** プロジェクト名の最大文字数 */
  maxProjectLength: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const DEFAULT_CONFIG: ValidationConfig = {
  maxContentLength: 100_000,
  maxTitleLength: 500,
  maxTags: 50,
  maxTagLength: 100,
  maxProjectLength: 200,
};

/** tableAlias ホワイトリスト */
const ALLOWED_TABLE_ALIASES = new Set([
  "mem_observations",
  "mem_sessions",
  "mem_events",
  "mem_facts",
  "mem_entities",
  "mem_links",
]);

export class RequestValidator {
  private config: ValidationConfig;

  constructor(config: Partial<ValidationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** /v1/events/record のバリデーション */
  validateRecordEvent(body: unknown): ValidationResult {
    const errors: string[] = [];

    if (typeof body !== "object" || body === null) {
      return { valid: false, errors: ["body must be a JSON object"] };
    }

    const obj = body as Record<string, unknown>;
    const event = obj.event;

    if (typeof event !== "object" || event === null) {
      return { valid: false, errors: ["event is required and must be an object"] };
    }

    const evt = event as Record<string, unknown>;

    // content / payload のサイズチェック
    const payload = evt.payload;
    if (typeof payload === "object" && payload !== null) {
      const content = (payload as Record<string, unknown>).content;
      if (typeof content === "string" && content.length > this.config.maxContentLength) {
        errors.push(`payload.content exceeds max length of ${this.config.maxContentLength}`);
      }
    }

    // project
    if (typeof evt.project === "string" && evt.project.length > this.config.maxProjectLength) {
      errors.push(`event.project exceeds max length of ${this.config.maxProjectLength}`);
    }

    // tags
    if (Array.isArray(evt.tags)) {
      if (evt.tags.length > this.config.maxTags) {
        errors.push(`event.tags exceeds max count of ${this.config.maxTags}`);
      }
      for (const tag of evt.tags) {
        if (typeof tag === "string" && tag.length > this.config.maxTagLength) {
          errors.push(`event.tags contains a tag exceeding max length of ${this.config.maxTagLength}`);
          break;
        }
      }
    }

    // privacy_tags
    if (Array.isArray(evt.privacy_tags)) {
      if (evt.privacy_tags.length > this.config.maxTags) {
        errors.push(`event.privacy_tags exceeds max count of ${this.config.maxTags}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /** /v1/search のバリデーション */
  validateSearch(body: unknown): ValidationResult {
    const errors: string[] = [];

    if (typeof body !== "object" || body === null) {
      return { valid: false, errors: ["body must be a JSON object"] };
    }

    const obj = body as Record<string, unknown>;

    // query
    if (typeof obj.query !== "string" || obj.query.trim() === "") {
      errors.push("query is required and must be a non-empty string");
    } else if (obj.query.length > this.config.maxContentLength) {
      errors.push(`query exceeds max length of ${this.config.maxContentLength}`);
    }

    // project
    if (typeof obj.project === "string" && obj.project.length > this.config.maxProjectLength) {
      errors.push(`project exceeds max length of ${this.config.maxProjectLength}`);
    }

    return { valid: errors.length === 0, errors };
  }

  /** /v1/checkpoints/record のバリデーション */
  validateCheckpoint(body: unknown): ValidationResult {
    const errors: string[] = [];

    if (typeof body !== "object" || body === null) {
      return { valid: false, errors: ["body must be a JSON object"] };
    }

    const obj = body as Record<string, unknown>;

    // title
    if (typeof obj.title === "string" && obj.title.length > this.config.maxTitleLength) {
      errors.push(`title exceeds max length of ${this.config.maxTitleLength}`);
    }

    // content
    if (typeof obj.content === "string" && obj.content.length > this.config.maxContentLength) {
      errors.push(`content exceeds max length of ${this.config.maxContentLength}`);
    }

    // project
    if (typeof obj.project === "string" && obj.project.length > this.config.maxProjectLength) {
      errors.push(`project exceeds max length of ${this.config.maxProjectLength}`);
    }

    // tags
    if (Array.isArray(obj.tags)) {
      if (obj.tags.length > this.config.maxTags) {
        errors.push(`tags exceeds max count of ${this.config.maxTags}`);
      }
      for (const tag of obj.tags) {
        if (typeof tag === "string" && tag.length > this.config.maxTagLength) {
          errors.push(`tags contains a tag exceeding max length of ${this.config.maxTagLength}`);
          break;
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /** tableAlias ホワイトリスト検証 */
  validateTableAlias(alias: string): boolean {
    return ALLOWED_TABLE_ALIASES.has(alias);
  }
}

/** デフォルト設定のバリデーターインスタンスを返す */
export function createDefaultValidator(): RequestValidator {
  return new RequestValidator();
}
