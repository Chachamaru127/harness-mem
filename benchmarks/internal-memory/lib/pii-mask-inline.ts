/** TypeScript PII mask (regex-only, mirrors Python fallback). No mapping persistence. */

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}\b/g;
const API_KEY_RE = /\b(?:sk|rk|pk)-[A-Za-z0-9]{8,}\b|\bxox[baprs]-[A-Za-z0-9-]{8,}\b/gi;
const ABS_PATH_RE = /\/Users\/[A-Za-z0-9._\-\[\]]+(?:\/[A-Za-z0-9._\-\[\]]+)*/g;
const SECRET_RE = /\b(?:api[-_ ]?key|token|secret|password|bearer)\s*[:=]\s*[^\s,;]+/gi;
const HEX_SECRET_RE = /\b[0-9a-f]{32,}\b/gi;
const JA_NAME_RE = /(?:[一-龯ぁ-んァ-ン]{2,4})(?:さん|様|氏|くん|ちゃん)/g;

export class TsMaskCounters {
  person = 0;
  email = 0;
  phone = 0;
  apiKey = 0;
  path = 0;
  secret = 0;

  next(kind: string): string {
    if (kind === "PERSON") return `[PERSON_${++this.person}]`;
    if (kind === "EMAIL") return `[EMAIL_${++this.email}]`;
    if (kind === "PHONE") return `[PHONE_${++this.phone}]`;
    if (kind === "API_KEY") return `[API_KEY_${++this.apiKey}]`;
    if (kind === "PATH") return `[PATH_${++this.path}]`;
    return `[SECRET_${++this.secret}]`;
  }
}

export function maskTextInline(text: string, counters = new TsMaskCounters()): string {
  const entityMap = new Map<string, string>();
  const token = (kind: string, value: string): string => {
    const key = `${kind}:${value.toLowerCase()}`;
    if (!entityMap.has(key)) entityMap.set(key, counters.next(kind));
    return entityMap.get(key)!;
  };

  let out = text;
  out = out.replace(ABS_PATH_RE, (m) => token("PATH", m));
  out = out.replace(API_KEY_RE, (m) => token("API_KEY", m));
  out = out.replace(SECRET_RE, (m) => token("SECRET", m));
  out = out.replace(HEX_SECRET_RE, (m) => token("SECRET", m));
  out = out.replace(EMAIL_RE, (m) => token("EMAIL", m));
  out = out.replace(PHONE_RE, (m) => token("PHONE", m));
  out = out.replace(JA_NAME_RE, (m) => token("PERSON", m));
  return out;
}
