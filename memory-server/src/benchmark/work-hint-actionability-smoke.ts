export type WorkHintTier = "green" | "yellow" | "red";

export interface WorkHintFixture {
  workId: string;
  title: string;
  hintDelivered: boolean;
  artifactText: string;
  wantConsume: boolean;
}

export interface WorkHintActionabilitySmokeResult {
  work_hint_delivered_rate: number;
  work_hint_consumed_rate: number;
  fixture_size: number;
  consumed_count: number;
  tier: WorkHintTier;
  thresholds: {
    yellow_min: 0.3;
    green_min: 0.6;
  };
}

export const DEFAULT_WORK_HINT_FIXTURE: readonly WorkHintFixture[] = [
  {
    workId: "S125-009",
    title: "Next query API",
    hintDelivered: true,
    artifactText: "Claimed S125-009 and used the next query API result.",
    wantConsume: true,
  },
  {
    workId: "S125-010",
    title: "Claim lifecycle",
    hintDelivered: true,
    artifactText: "Continuing S125-010 claim lifecycle.",
    wantConsume: true,
  },
  {
    workId: "S125-011",
    title: "Handoff provenance",
    hintDelivered: true,
    artifactText: "Handoff provenance work is now verified.",
    wantConsume: true,
  },
  {
    workId: "S125-012",
    title: "MCP tool exposure",
    hintDelivered: true,
    artifactText: "Next tool exposure landed.",
    wantConsume: false,
  },
  {
    workId: "S125-013",
    title: "Hook hint observability",
    hintDelivered: true,
    artifactText: "S125-013 hook hint observability is in progress.",
    wantConsume: true,
  },
  {
    workId: "S125-014",
    title: "UI explainability",
    hintDelivered: true,
    artifactText: "Reviewed UI but did not start it yet.",
    wantConsume: false,
  },
  {
    workId: "S125-015",
    title: "Release gate",
    hintDelivered: true,
    artifactText: "Queued S125-015 release gate after hooks.",
    wantConsume: true,
  },
  {
    workId: "S125-016",
    title: "Follow-up fixture",
    hintDelivered: true,
    artifactText: "Unrelated cleanup only.",
    wantConsume: false,
  },
  {
    workId: "S125-017",
    title: "Privacy regression",
    hintDelivered: true,
    artifactText: "Handled privacy regression for S125-017.",
    wantConsume: true,
  },
  {
    workId: "S125-018",
    title: "Project isolation",
    hintDelivered: true,
    artifactText: "No action taken.",
    wantConsume: false,
  },
];

export function decideWorkHintTier(workHintConsumedRate: number): WorkHintTier {
  if (workHintConsumedRate < 0.3) return "red";
  if (workHintConsumedRate < 0.6) return "yellow";
  return "green";
}

export function runWorkHintActionabilitySmoke(
  fixture: readonly WorkHintFixture[] = DEFAULT_WORK_HINT_FIXTURE,
): WorkHintActionabilitySmokeResult {
  const delivered = fixture.filter((item) => item.hintDelivered);
  const consumedCount = delivered.filter((item) => item.wantConsume && hintWasConsumed(item)).length;
  const fixtureSize = fixture.length;
  const deliveredRate = fixtureSize === 0 ? 0 : delivered.length / fixtureSize;
  const consumedRate = delivered.length === 0 ? 0 : consumedCount / delivered.length;

  return {
    work_hint_delivered_rate: round4(deliveredRate),
    work_hint_consumed_rate: round4(consumedRate),
    fixture_size: fixtureSize,
    consumed_count: consumedCount,
    tier: decideWorkHintTier(consumedRate),
    thresholds: {
      yellow_min: 0.3,
      green_min: 0.6,
    },
  };
}

function hintWasConsumed(item: WorkHintFixture): boolean {
  const artifact = item.artifactText.toLowerCase();
  return artifact.includes(item.workId.toLowerCase()) || artifact.includes(item.title.toLowerCase());
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

if (import.meta.main) {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(runWorkHintActionabilitySmoke(), null, 2));
}
