export interface LocomoMetricSnapshot {
  overall: {
    em: number;
    f1: number;
    count: number;
  };
}

export interface DriftReport {
  previous: LocomoMetricSnapshot["overall"];
  current: LocomoMetricSnapshot["overall"];
  delta: {
    em: number;
    f1: number;
  };
  status: {
    em: "improved" | "regressed" | "stable";
    f1: "improved" | "regressed" | "stable";
  };
}

function classify(delta: number, epsilon = 1e-9): "improved" | "regressed" | "stable" {
  if (delta > epsilon) return "improved";
  if (delta < -epsilon) return "regressed";
  return "stable";
}

export function buildLocomoDriftReport(previous: LocomoMetricSnapshot, current: LocomoMetricSnapshot): DriftReport {
  const deltaEm = current.overall.em - previous.overall.em;
  const deltaF1 = current.overall.f1 - previous.overall.f1;
  return {
    previous: previous.overall,
    current: current.overall,
    delta: {
      em: deltaEm,
      f1: deltaF1,
    },
    status: {
      em: classify(deltaEm),
      f1: classify(deltaF1),
    },
  };
}
