/**
 * SqliteTeamRepository
 *
 * ITeamRepository の SQLite 実装。
 * bun:sqlite の Database を直接使用し、同期 API を Promise でラップする。
 */

import type { Database } from "bun:sqlite";
import type {
  ITeamRepository,
  TeamRow,
  TeamMemberRow,
  CreateTeamInput,
  UpdateTeamInput,
} from "./ITeamRepository.js";

export class SqliteTeamRepository implements ITeamRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateTeamInput): Promise<TeamRow> {
    this.db
      .query(`
        INSERT INTO mem_teams(team_id, name, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        input.team_id,
        input.name,
        input.description ?? null,
        input.created_at,
        input.updated_at,
      );

    const row = this.db
      .query<TeamRow, [string]>(`
        SELECT team_id, name, description, created_at, updated_at
        FROM mem_teams
        WHERE team_id = ?
      `)
      .get(input.team_id);

    if (!row) {
      throw new Error(`Failed to create team: ${input.team_id}`);
    }
    return row;
  }

  async findById(teamId: string): Promise<TeamRow | null> {
    const row = this.db
      .query<TeamRow, [string]>(`
        SELECT team_id, name, description, created_at, updated_at
        FROM mem_teams
        WHERE team_id = ?
      `)
      .get(teamId);
    return row ?? null;
  }

  async findAll(): Promise<TeamRow[]> {
    return this.db
      .query<TeamRow, []>(`
        SELECT team_id, name, description, created_at, updated_at
        FROM mem_teams
        ORDER BY created_at ASC
      `)
      .all();
  }

  async update(teamId: string, input: UpdateTeamInput): Promise<TeamRow | null> {
    const existing = await this.findById(teamId);
    if (!existing) return null;

    const setClauses: string[] = ["updated_at = ?"];
    const params: unknown[] = [input.updated_at];

    if (input.name !== undefined) {
      setClauses.push("name = ?");
      params.push(input.name);
    }

    if ("description" in input) {
      setClauses.push("description = ?");
      params.push(input.description ?? null);
    }

    params.push(teamId);

    this.db
      .query(`UPDATE mem_teams SET ${setClauses.join(", ")} WHERE team_id = ?`)
      .run(...params);

    return this.findById(teamId);
  }

  async delete(teamId: string): Promise<boolean> {
    const result = this.db
      .query<unknown, [string]>(`DELETE FROM mem_teams WHERE team_id = ?`)
      .run(teamId);
    return (result.changes ?? 0) > 0;
  }

  async addMember(teamId: string, userId: string, role: string): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .query(`
        INSERT OR IGNORE INTO mem_team_members(team_id, user_id, role, joined_at)
        VALUES (?, ?, ?, ?)
      `)
      .run(teamId, userId, role, now);
  }

  async removeMember(teamId: string, userId: string): Promise<boolean> {
    const result = this.db
      .query<unknown, [string, string]>(`
        DELETE FROM mem_team_members WHERE team_id = ? AND user_id = ?
      `)
      .run(teamId, userId);
    return (result.changes ?? 0) > 0;
  }

  async getMembers(teamId: string): Promise<TeamMemberRow[]> {
    return this.db
      .query<TeamMemberRow, [string]>(`
        SELECT team_id, user_id, role, joined_at
        FROM mem_team_members
        WHERE team_id = ?
        ORDER BY joined_at ASC
      `)
      .all(teamId);
  }

  async updateMemberRole(teamId: string, userId: string, role: string): Promise<boolean> {
    const result = this.db
      .query<unknown, [string, string, string]>(`
        UPDATE mem_team_members SET role = ? WHERE team_id = ? AND user_id = ?
      `)
      .run(role, teamId, userId);
    return (result.changes ?? 0) > 0;
  }
}
