export interface LocomoQuestionInput {
  sample_id: string;
  question_id: string;
  question: string;
  answer: string;
  category: string;
}

export interface LocomoAdapterRecord extends LocomoQuestionInput {
  prediction: string;
  em: number;
  f1: number;
}

export interface Mem0LocomoAdapterOptions {
  baseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function tokenF1(prediction: string, answer: string): number {
  const predTokens = normalize(prediction).split(" ").filter(Boolean);
  const goldTokens = normalize(answer).split(" ").filter(Boolean);
  if (predTokens.length === 0 || goldTokens.length === 0) return 0;

  const bag = new Map<string, number>();
  for (const token of goldTokens) {
    bag.set(token, (bag.get(token) || 0) + 1);
  }

  let overlap = 0;
  for (const token of predTokens) {
    const count = bag.get(token) || 0;
    if (count > 0) {
      overlap += 1;
      bag.set(token, count - 1);
    }
  }
  if (overlap === 0) return 0;
  const precision = overlap / predTokens.length;
  const recall = overlap / goldTokens.length;
  return (2 * precision * recall) / (precision + recall);
}

function scoreRecord(base: Omit<LocomoAdapterRecord, "em" | "f1">): LocomoAdapterRecord {
  const em = normalize(base.prediction) === normalize(base.answer) ? 1 : 0;
  const f1 = tokenF1(base.prediction, base.answer);
  return { ...base, em, f1 };
}

export class Mem0LocomoAdapter {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: Mem0LocomoAdapterOptions) {
    this.fetchImpl = options.fetchImpl || fetch;
  }

  async answerQuestion(input: LocomoQuestionInput): Promise<LocomoAdapterRecord> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.options.token) {
      headers.authorization = `Bearer ${this.options.token}`;
    }

    const response = await this.fetchImpl(`${this.options.baseUrl.replace(/\/$/, "")}/v1/locomo/answer`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        question: input.question,
        sample_id: input.sample_id,
        category: input.category,
      }),
    });

    if (!response.ok) {
      throw new Error(`mem0 adapter request failed: HTTP ${response.status}`);
    }

    const payload = (await response.json()) as { prediction?: string };
    const prediction = String(payload.prediction || "");
    return scoreRecord({ ...input, prediction });
  }
}
