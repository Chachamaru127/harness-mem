function normalizeProjectValue(project: string): string {
  return project.trim().replace(/\/+$/, "").replace(/\\/g, "/");
}

function splitPathSegments(project: string): string[] {
  return normalizeProjectValue(project).split("/").filter(Boolean);
}

function isPathLikeProject(project: string): boolean {
  const normalized = normalizeProjectValue(project);
  if (!normalized) {
    return false;
  }
  return normalized.includes("/") || /^[A-Za-z]:/.test(normalized);
}

export function getBaseProjectDisplayName(project: string): string {
  const normalized = normalizeProjectValue(project);
  if (!normalized) {
    return project;
  }

  if (!isPathLikeProject(normalized)) {
    return normalized;
  }

  const segments = splitPathSegments(normalized);
  if (segments.length === 0) {
    return normalized;
  }

  return segments[segments.length - 1] || normalized;
}

function getPathTail(project: string, depth: number): string {
  const segments = splitPathSegments(project);
  if (segments.length === 0) {
    return normalizeProjectValue(project);
  }
  return segments.slice(-Math.max(1, depth)).join("/");
}

export function buildProjectDisplayNameMap(projects: string[]): Map<string, string> {
  const baseNames = new Map<string, string>();
  const baseCount = new Map<string, number>();

  for (const project of projects) {
    const base = getBaseProjectDisplayName(project);
    baseNames.set(project, base);
    baseCount.set(base, (baseCount.get(base) || 0) + 1);
  }

  const displayNames = new Map<string, string>();
  for (const project of projects) {
    const base = baseNames.get(project) || project;
    if ((baseCount.get(base) || 0) <= 1) {
      displayNames.set(project, base);
      continue;
    }

    if (!isPathLikeProject(project)) {
      displayNames.set(project, project);
      continue;
    }

    displayNames.set(project, getPathTail(project, 2));
  }

  const labelCount = new Map<string, number>();
  for (const label of displayNames.values()) {
    labelCount.set(label, (labelCount.get(label) || 0) + 1);
  }

  for (const [project, label] of displayNames.entries()) {
    if ((labelCount.get(label) || 0) > 1) {
      displayNames.set(project, normalizeProjectValue(project));
    }
  }

  return displayNames;
}

export function getProjectDisplayName(project: string, map?: Map<string, string>): string {
  if (map?.has(project)) {
    return map.get(project) || project;
  }
  return getBaseProjectDisplayName(project);
}
