export interface TtlCacheResult<T> {
  value: T;
  cache_hit: boolean;
  age_ms: number;
  ttl_ms: number;
}

interface TtlEntry<T> {
  value: T;
  created_at_ms: number;
}

export class TtlCache<T> {
  private entry: TtlEntry<T> | null = null;

  constructor(private readonly ttlMs: number) {}

  getOrCreate(factory: () => T): TtlCacheResult<T> {
    const now = Date.now();
    const ttl = Number.isFinite(this.ttlMs) ? Math.max(0, Math.trunc(this.ttlMs)) : 0;

    if (this.entry) {
      const ageMs = Math.max(0, now - this.entry.created_at_ms);
      if (ageMs <= ttl) {
        return {
          value: this.entry.value,
          cache_hit: true,
          age_ms: ageMs,
          ttl_ms: ttl,
        };
      }
    }

    const value = factory();
    this.entry = {
      value,
      created_at_ms: now,
    };

    return {
      value,
      cache_hit: false,
      age_ms: 0,
      ttl_ms: ttl,
    };
  }

  clear(): void {
    this.entry = null;
  }
}
