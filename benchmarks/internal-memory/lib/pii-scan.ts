const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const API_KEY_RE = /\b(?:sk|rk|pk)-[A-Za-z0-9]{8,}\b|\bxox[baprs]-[A-Za-z0-9-]{8,}\b/i;
const ABS_PATH_RE = /\/Users\/[A-Za-z0-9._-]+/;

export function scanTextForPii(text: string): string[] {
  const leaks: string[] = [];
  if (EMAIL_RE.test(text)) leaks.push("email");
  if (API_KEY_RE.test(text)) leaks.push("api_key");
  if (ABS_PATH_RE.test(text)) leaks.push("absolute_path");
  return leaks;
}

export function scanJsonlForPii(source: string): string[] {
  const leaks: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim()) continue;
    for (const kind of scanTextForPii(line)) {
      if (!leaks.includes(kind)) leaks.push(kind);
    }
  }
  return leaks;
}
