/**
 * V5-005: Connector Registry
 *
 * SyncConnector のライフサイクル管理と一括同期を担う。
 */

import type { SyncConnector, SyncChangeset, SyncResult } from "./types";

export class ConnectorRegistry {
  private connectors = new Map<string, SyncConnector>();

  register(connector: SyncConnector): void {
    this.connectors.set(connector.name, connector);
  }

  unregister(name: string): boolean {
    return this.connectors.delete(name);
  }

  get(name: string): SyncConnector | undefined {
    return this.connectors.get(name);
  }

  list(): SyncConnector[] {
    return Array.from(this.connectors.values());
  }

  /** 全コネクタを順次 pull して変更を収集する */
  async pullAll(): Promise<{ connector: string; changesets: SyncChangeset[] }[]> {
    const results: { connector: string; changesets: SyncChangeset[] }[] = [];

    for (const connector of this.connectors.values()) {
      try {
        const changesets = await connector.pull();
        results.push({ connector: connector.name, changesets });
      } catch (err) {
        results.push({ connector: connector.name, changesets: [] });
        console.error(`[ConnectorRegistry] pull failed for ${connector.name}: ${String(err)}`);
      }
    }

    return results;
  }

  /** 全コネクタに対して同期を実行する（pull のみ） */
  async syncAll(): Promise<SyncResult[]> {
    const results: SyncResult[] = [];

    for (const connector of this.connectors.values()) {
      const result: SyncResult = {
        connector: connector.name,
        pulled: 0,
        pushed: 0,
        errors: [],
      };

      try {
        const changesets = await connector.pull();
        result.pulled = changesets.length;
      } catch (err) {
        result.errors.push(`pull failed: ${String(err)}`);
      }

      results.push(result);
    }

    return results;
  }

  /** 指定コネクタを同期する（pull + push） */
  async syncConnector(name: string, changes: SyncChangeset[] = []): Promise<SyncResult> {
    const connector = this.connectors.get(name);
    if (!connector) {
      return {
        connector: name,
        pulled: 0,
        pushed: 0,
        errors: [`Connector '${name}' not found`],
      };
    }

    const result: SyncResult = {
      connector: name,
      pulled: 0,
      pushed: 0,
      errors: [],
    };

    try {
      const pulled = await connector.pull();
      result.pulled = pulled.length;
    } catch (err) {
      result.errors.push(`pull failed: ${String(err)}`);
    }

    if (changes.length > 0) {
      try {
        const pushResult = await connector.push(changes);
        result.pushed = pushResult.synced;
        result.errors.push(...pushResult.errors);
      } catch (err) {
        result.errors.push(`push failed: ${String(err)}`);
      }
    }

    return result;
  }
}
