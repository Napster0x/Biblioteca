export type ReplicaTimestamps = Record<string, string>;

export function parseReplicaTimestamps(raw: unknown): ReplicaTimestamps {
  if (typeof raw !== 'string') return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const timestamps: ReplicaTimestamps = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') timestamps[key] = value;
    }
    return timestamps;
  } catch {
    return {};
  }
}

export function serializeReplicaTimestamps(value?: ReplicaTimestamps): string | null {
  if (!value || Object.keys(value).length === 0) return null;
  return JSON.stringify(value);
}
