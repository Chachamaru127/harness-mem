/**
 * analytics.ts
 *
 * Analytics ロジックを担う AnalyticsService。
 * mem_events / mem_observations / mem_observation_entities を集計して
 * ダッシュボード向けの統計データを返す。
 */

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

export interface UsageParams {
  period?: "day" | "week" | "month";
  from?: string;
  to?: string;
  project?: string;
  /** TEAM-005: member ロール適用 — アクセス制御用ユーザーID */
  user_id?: string;
  /** TEAM-005: member ロール適用 — アクセス制御用チームID */
  team_id?: string;
}

export interface UsageStatRow {
  date: string;
  event_count: number;
  search_count: number;
  observation_count: number;
}

export interface UsageStats {
  rows: UsageStatRow[];
  period: string;
  from: string | null;
  to: string | null;
}

export interface EntityParams {
  limit?: number;
  project?: string;
  entity_type?: string;
  /** TEAM-005: member ロール適用 — アクセス制御用ユーザーID */
  user_id?: string;
  /** TEAM-005: member ロール適用 — アクセス制御用チームID */
  team_id?: string;
}

export interface EntityStats {
  name: string;
  entity_type: string;
  occurrence_count: number;
  observation_count: number;
}

export interface TimelineParams {
  from?: string;
  to?: string;
  project?: string;
  /** TEAM-005: member ロール適用 — アクセス制御用ユーザーID */
  user_id?: string;
  /** TEAM-005: member ロール適用 — アクセス制御用チームID */
  team_id?: string;
}

export interface HourBucket {
  hour: number;
  event_count: number;
  observation_count: number;
}

export interface TimelineStats {
  buckets: HourBucket[];
  from: string | null;
  to: string | null;
}

export interface OverviewParams {
  project?: string;
  /** TEAM-005: member ロール適用 — アクセス制御用ユーザーID */
  user_id?: string;
  /** TEAM-005: member ロール適用 — アクセス制御用チームID */
  team_id?: string;
}

export interface MemoryTypeDistribution {
  memory_type: string;
  count: number;
}

export interface ObservationTypeDistribution {
  observation_type: string;
  count: number;
}

export interface RecentActivityItem {
  date: string;
  observation_count: number;
}

export interface OverviewStats {
  total_observations: number;
  total_sessions: number;
  total_entities: number;
  memory_type_distribution: MemoryTypeDistribution[];
  observation_type_distribution: ObservationTypeDistribution[];
  recent_activity: RecentActivityItem[];
}

// ---------------------------------------------------------------------------
// AnalyticsDeps
// ---------------------------------------------------------------------------

export interface AnalyticsDeps {
  db: { query: (sql: string, params?: unknown[]) => { all: () => unknown[] } };
}

// ---------------------------------------------------------------------------
// AnalyticsService
// ---------------------------------------------------------------------------

export class AnalyticsService {
  constructor(private deps: AnalyticsDeps) {}

  // -------------------------------------------------------------------------
  // getUsageStats
  // -------------------------------------------------------------------------
  // TEAM-005: テナント分離ヘルパー — 条件配列にテナントフィルタを追加
  private appendTenantConditions(conditions: string[], bindArgs: unknown[], params: { user_id?: string; team_id?: string }): void {
    if (params.user_id) {
      if (params.team_id) {
        conditions.push("(user_id = ? OR team_id = ?)");
        bindArgs.push(params.user_id, params.team_id);
      } else {
        conditions.push("user_id = ?");
        bindArgs.push(params.user_id);
      }
    }
  }

  async getUsageStats(params: UsageParams): Promise<UsageStats> {
    const { period = "day", from, to, project } = params;

    // period に応じた strftime フォーマット
    const fmt = period === "month" ? "%Y-%m" : period === "week" ? "%Y-%W" : "%Y-%m-%d";

    const conditions: string[] = [];
    const bindArgs: unknown[] = [];

    if (from) {
      conditions.push("created_at >= ?");
      bindArgs.push(from);
    }
    if (to) {
      conditions.push("created_at <= ?");
      bindArgs.push(to);
    }
    if (project) {
      conditions.push("project = ?");
      bindArgs.push(project);
    }
    // TEAM-005: テナント分離
    this.appendTenantConditions(conditions, bindArgs, params);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // イベント数
    const eventRows = this.deps.db
      .query(
        `SELECT strftime('${fmt}', created_at) AS date, COUNT(*) AS cnt
         FROM mem_events
         ${whereClause}
         GROUP BY date
         ORDER BY date`,
        bindArgs
      )
      .all() as Array<{ date: string; cnt: number }>;

    // 観察数
    const obsRows = this.deps.db
      .query(
        `SELECT strftime('${fmt}', created_at) AS date, COUNT(*) AS cnt
         FROM mem_observations
         ${whereClause}
         GROUP BY date
         ORDER BY date`,
        bindArgs
      )
      .all() as Array<{ date: string; cnt: number }>;

    // search イベント（event_type = 'search'）
    const searchConditions = [...conditions, "event_type = 'search'"];
    const searchArgs = [...bindArgs, ...[]]; // event_type は固定なので bindArgs をそのまま使う
    // search 条件の WHERE
    const searchWhere =
      searchConditions.length > 0 ? `WHERE ${searchConditions.join(" AND ")}` : "";
    const searchRows = this.deps.db
      .query(
        `SELECT strftime('${fmt}', created_at) AS date, COUNT(*) AS cnt
         FROM mem_events
         ${searchWhere}
         GROUP BY date
         ORDER BY date`,
        searchArgs
      )
      .all() as Array<{ date: string; cnt: number }>;

    // マージ
    const eventMap = new Map<string, number>();
    for (const r of eventRows) eventMap.set(r.date, r.cnt);

    const obsMap = new Map<string, number>();
    for (const r of obsRows) obsMap.set(r.date, r.cnt);

    const searchMap = new Map<string, number>();
    for (const r of searchRows) searchMap.set(r.date, r.cnt);

    const allDates = new Set<string>([
      ...eventMap.keys(),
      ...obsMap.keys(),
      ...searchMap.keys(),
    ]);

    const rows: UsageStatRow[] = Array.from(allDates)
      .sort()
      .map((date) => ({
        date,
        event_count: eventMap.get(date) ?? 0,
        search_count: searchMap.get(date) ?? 0,
        observation_count: obsMap.get(date) ?? 0,
      }));

    return {
      rows,
      period,
      from: from ?? null,
      to: to ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // getEntityDistribution
  // -------------------------------------------------------------------------
  async getEntityDistribution(params: EntityParams): Promise<EntityStats[]> {
    const { limit = 50, project, entity_type } = params;

    const conditions: string[] = [];
    const bindArgs: unknown[] = [];

    if (project) {
      conditions.push("o.project = ?");
      bindArgs.push(project);
    }
    if (entity_type) {
      conditions.push("e.entity_type = ?");
      bindArgs.push(entity_type);
    }
    // TEAM-005: テナント分離 (alias "o" で mem_observations を参照)
    if (params.user_id) {
      if (params.team_id) {
        conditions.push("(o.user_id = ? OR o.team_id = ?)");
        bindArgs.push(params.user_id, params.team_id);
      } else {
        conditions.push("o.user_id = ?");
        bindArgs.push(params.user_id);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = this.deps.db
      .query(
        `SELECT e.name,
                e.entity_type,
                COUNT(oe.observation_id) AS occurrence_count,
                COUNT(DISTINCT oe.observation_id) AS observation_count
         FROM mem_entities e
         JOIN mem_observation_entities oe ON oe.entity_id = e.id
         JOIN mem_observations o ON o.id = oe.observation_id
         ${whereClause}
         GROUP BY e.id, e.name, e.entity_type
         ORDER BY occurrence_count DESC
         LIMIT ?`,
        [...bindArgs, limit]
      )
      .all() as Array<{
      name: string;
      entity_type: string;
      occurrence_count: number;
      observation_count: number;
    }>;

    return rows.map((r) => ({
      name: r.name,
      entity_type: r.entity_type,
      occurrence_count: r.occurrence_count,
      observation_count: r.observation_count,
    }));
  }

  // -------------------------------------------------------------------------
  // getTimelineStats
  // -------------------------------------------------------------------------
  async getTimelineStats(params: TimelineParams): Promise<TimelineStats> {
    const { from, to, project } = params;

    const conditions: string[] = [];
    const bindArgs: unknown[] = [];

    if (from) {
      conditions.push("created_at >= ?");
      bindArgs.push(from);
    }
    if (to) {
      conditions.push("created_at <= ?");
      bindArgs.push(to);
    }
    if (project) {
      conditions.push("project = ?");
      bindArgs.push(project);
    }
    // TEAM-005: テナント分離
    this.appendTenantConditions(conditions, bindArgs, params);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const eventRows = this.deps.db
      .query(
        `SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hour, COUNT(*) AS cnt
         FROM mem_events
         ${whereClause}
         GROUP BY hour
         ORDER BY hour`,
        bindArgs
      )
      .all() as Array<{ hour: number; cnt: number }>;

    const obsRows = this.deps.db
      .query(
        `SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hour, COUNT(*) AS cnt
         FROM mem_observations
         ${whereClause}
         GROUP BY hour
         ORDER BY hour`,
        bindArgs
      )
      .all() as Array<{ hour: number; cnt: number }>;

    const eventHourMap = new Map<number, number>();
    for (const r of eventRows) eventHourMap.set(r.hour, r.cnt);

    const obsHourMap = new Map<number, number>();
    for (const r of obsRows) obsHourMap.set(r.hour, r.cnt);

    const allHours = new Set<number>([...eventHourMap.keys(), ...obsHourMap.keys()]);

    const buckets: HourBucket[] = Array.from(allHours)
      .sort((a, b) => a - b)
      .map((hour) => ({
        hour,
        event_count: eventHourMap.get(hour) ?? 0,
        observation_count: obsHourMap.get(hour) ?? 0,
      }));

    return {
      buckets,
      from: from ?? null,
      to: to ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // getOverview
  // -------------------------------------------------------------------------
  async getOverview(params: OverviewParams): Promise<OverviewStats> {
    const { project } = params;

    // TEAM-005: テナント分離 — project + tenant の条件を構築
    const conditions: string[] = [];
    const conditionArgs: unknown[] = [];
    if (project) {
      conditions.push("project = ?");
      conditionArgs.push(project);
    }
    this.appendTenantConditions(conditions, conditionArgs, params);
    const projectCondition = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const projectArgs: unknown[] = [...conditionArgs];

    // total_observations
    const obsCountRow = this.deps.db
      .query(`SELECT COUNT(*) AS cnt FROM mem_observations ${projectCondition}`, projectArgs)
      .all() as Array<{ cnt: number }>;
    const total_observations = obsCountRow[0]?.cnt ?? 0;

    // total_sessions
    const sessCountRow = this.deps.db
      .query(`SELECT COUNT(*) AS cnt FROM mem_sessions ${projectCondition}`, projectArgs)
      .all() as Array<{ cnt: number }>;
    const total_sessions = sessCountRow[0]?.cnt ?? 0;

    // total_entities（プロジェクトフィルタまたはテナントフィルタがある場合は JOIN が必要）
    let total_entities: number;
    if (project || params.user_id) {
      const entityConditions: string[] = [];
      const entityArgs: unknown[] = [];
      if (project) { entityConditions.push("o.project = ?"); entityArgs.push(project); }
      if (params.user_id) {
        if (params.team_id) { entityConditions.push("(o.user_id = ? OR o.team_id = ?)"); entityArgs.push(params.user_id, params.team_id); }
        else { entityConditions.push("o.user_id = ?"); entityArgs.push(params.user_id); }
      }
      const entityWhere = entityConditions.length > 0 ? `WHERE ${entityConditions.join(" AND ")}` : "";
      const entityCountRow = this.deps.db
        .query(
          `SELECT COUNT(DISTINCT e.id) AS cnt
           FROM mem_entities e
           JOIN mem_observation_entities oe ON oe.entity_id = e.id
           JOIN mem_observations o ON o.id = oe.observation_id
           ${entityWhere}`,
          entityArgs
        )
        .all() as Array<{ cnt: number }>;
      total_entities = entityCountRow[0]?.cnt ?? 0;
    } else {
      const entityCountRow = this.deps.db
        .query(`SELECT COUNT(*) AS cnt FROM mem_entities`, [])
        .all() as Array<{ cnt: number }>;
      total_entities = entityCountRow[0]?.cnt ?? 0;
    }

    // memory_type_distribution
    const memTypeRows = this.deps.db
      .query(
        `SELECT memory_type, COUNT(*) AS cnt FROM mem_observations ${projectCondition} GROUP BY memory_type ORDER BY cnt DESC`,
        projectArgs
      )
      .all() as Array<{ memory_type: string; cnt: number }>;
    const memory_type_distribution: MemoryTypeDistribution[] = memTypeRows.map((r) => ({
      memory_type: r.memory_type,
      count: r.cnt,
    }));

    // observation_type_distribution
    const obsTypeRows = this.deps.db
      .query(
        `SELECT observation_type, COUNT(*) AS cnt FROM mem_observations ${projectCondition} GROUP BY observation_type ORDER BY cnt DESC`,
        projectArgs
      )
      .all() as Array<{ observation_type: string; cnt: number }>;
    const observation_type_distribution: ObservationTypeDistribution[] = obsTypeRows.map(
      (r) => ({
        observation_type: r.observation_type,
        count: r.cnt,
      })
    );

    // recent_activity (直近7日)
    // TEAM-005: テナント分離 — projectCondition と同じ条件を再利用
    const recentConditions = [...conditions];
    const recentArgs: unknown[] = [...conditionArgs];
    const recentWhere = recentConditions.length > 0 ? `WHERE ${recentConditions.join(" AND ")}` : "";

    const recentRows = this.deps.db
      .query(
        `SELECT strftime('%Y-%m-%d', created_at) AS date, COUNT(*) AS cnt
         FROM mem_observations
         ${recentWhere}
         GROUP BY date
         ORDER BY date DESC
         LIMIT 7`,
        recentArgs
      )
      .all() as Array<{ date: string; cnt: number }>;
    const recent_activity: RecentActivityItem[] = recentRows.map((r) => ({
      date: r.date,
      observation_count: r.cnt,
    }));

    return {
      total_observations,
      total_sessions,
      total_entities,
      memory_type_distribution,
      observation_type_distribution,
      recent_activity,
    };
  }
}
