export interface LocomoEvaluationInput {
  prediction: string;
  answer: string;
  category: string;
}

export interface LocomoMetricSummary {
  count: number;
  em: number;
  f1: number;
}

export interface LocomoEvaluationResult {
  overall: LocomoMetricSummary;
  by_category: Record<string, LocomoMetricSummary>;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(" ") : [];
}

function exactMatch(prediction: string, answer: string): number {
  return normalizeText(prediction) === normalizeText(answer) ? 1 : 0;
}

function f1Score(prediction: string, answer: string): number {
  const predTokens = tokenize(prediction);
  const goldTokens = tokenize(answer);
  if (predTokens.length === 0 || goldTokens.length === 0) {
    return 0;
  }

  const remaining = new Map<string, number>();
  for (const token of goldTokens) {
    remaining.set(token, (remaining.get(token) || 0) + 1);
  }

  let overlap = 0;
  for (const token of predTokens) {
    const count = remaining.get(token) || 0;
    if (count > 0) {
      overlap += 1;
      remaining.set(token, count - 1);
    }
  }

  if (overlap === 0) {
    return 0;
  }
  const precision = overlap / predTokens.length;
  const recall = overlap / goldTokens.length;
  return (2 * precision * recall) / (precision + recall);
}

function summarize(scores: Array<{ em: number; f1: number }>): LocomoMetricSummary {
  const count = scores.length;
  if (count === 0) {
    return { count: 0, em: 0, f1: 0 };
  }
  const em = scores.reduce((sum, score) => sum + score.em, 0) / count;
  const f1 = scores.reduce((sum, score) => sum + score.f1, 0) / count;
  return { count, em, f1 };
}

export function evaluateLocomoQa(items: LocomoEvaluationInput[]): LocomoEvaluationResult {
  const overallScores: Array<{ em: number; f1: number }> = [];
  const categoryScores = new Map<string, Array<{ em: number; f1: number }>>();

  for (const item of items) {
    if (!normalizeText(item.answer)) {
      continue;
    }
    const em = exactMatch(item.prediction, item.answer);
    const f1 = f1Score(item.prediction, item.answer);
    overallScores.push({ em, f1 });

    const category = item.category.trim() || "uncategorized";
    if (!categoryScores.has(category)) {
      categoryScores.set(category, []);
    }
    categoryScores.get(category)!.push({ em, f1 });
  }

  const byCategory: Record<string, LocomoMetricSummary> = {};
  for (const [category, scores] of categoryScores.entries()) {
    byCategory[category] = summarize(scores);
  }

  return {
    overall: summarize(overallScores),
    by_category: byCategory,
  };
}
