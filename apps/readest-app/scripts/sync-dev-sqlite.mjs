/**
 * Execute a sqlite3 CLI command with -json flag for deterministic output.
 * Provides a stable closure over dbPath so callers don't repeat the path.
 */
function sqliteQuery(dbPath, execFileSync, sql) {
  return execFileSync('sqlite3', [dbPath, '-json', sql], { encoding: 'utf8', stdio: 'pipe' });
}

function escapeSqlValue(value) {
  return String(value).replace(/'/g, "''");
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${escapeSqlValue(value)}'`;
}

function assertRowExists({ dbPath, execFileSync, table, idColumn, rowId }) {
  const raw = sqliteQuery(
    dbPath,
    execFileSync,
    `SELECT count(*) AS c FROM "${table}" WHERE "${idColumn}" = '${escapeSqlValue(rowId)}'`,
  );
  const rows = JSON.parse(raw);
  if ((rows[0]?.c ?? 0) === 0) {
    throw new Error(`Row not found: ${table}.${rowId}`);
  }
}

/**
 * Capture metadata for a single table: columns, row count, HLC range, tombstone count.
 * Uses PRAGMA table_info at runtime (schema discovery, not hardcoded).
 */
function captureTable({ dbPath, tableName, execFileSync }) {
  try {
    const countRows = JSON.parse(sqliteQuery(dbPath, execFileSync, `SELECT count(*) AS c FROM "${tableName}"`));
    const rowCount = countRows[0]?.c ?? 0;

    const infoRows = JSON.parse(sqliteQuery(dbPath, execFileSync, `PRAGMA table_info("${tableName}")`));
    const columns = infoRows.map((r) => r.name);

    let hlcMin;
    let hlcMax;
    if (columns.includes('replica_timestamps')) {
      try {
        const hlcRows = JSON.parse(
          sqliteQuery(
            dbPath,
            execFileSync,
            `SELECT MIN(replica_timestamps) AS hlcMin, MAX(replica_timestamps) AS hlcMax FROM "${tableName}" WHERE replica_timestamps IS NOT NULL AND replica_timestamps != ''`,
          ),
        );
        hlcMin = hlcRows[0]?.hlcMin || undefined;
        hlcMax = hlcRows[0]?.hlcMax || undefined;
      } catch {
        // HLC extraction is best-effort — malformed JSON in replica_timestamps is non-fatal
      }
    }

    let deletedCount;
    if (columns.includes('deleted_at')) {
      try {
        const delRows = JSON.parse(
          sqliteQuery(
            dbPath,
            execFileSync,
            `SELECT count(*) AS c FROM "${tableName}" WHERE deleted_at IS NOT NULL AND deleted_at != ''`,
          ),
        );
        deletedCount = delRows[0]?.c ?? 0;
      } catch {
        // Best-effort
      }
    }

    return { name: tableName, rowCount, columns, hlcMin, hlcMax, deletedCount };
  } catch (error) {
    return {
      name: tableName,
      rowCount: 0,
      columns: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Capture all tables from a SQLite database.
 * Returns {available, tables, error?} — available: false when DB missing or sqlite3 unavailable.
 */
function captureDb({ dbPath, execFileSync }) {
  try {
    const masterRows = JSON.parse(
      sqliteQuery(dbPath, execFileSync, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"),
    );
    const tableNames = masterRows.map((r) => r.name);
    const tables = tableNames.map((name) => captureTable({ dbPath, tableName: name, execFileSync }));
    return { available: true, tables };
  } catch (error) {
    return {
      available: false,
      tables: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function captureDictionaryDb({ dbPath, execFileSync }) {
  return captureDb({ dbPath, execFileSync });
}

export function captureAnnotationsDb({ dbPath, execFileSync }) {
  return captureDb({ dbPath, execFileSync });
}

export function captureQuotesDb({ dbPath, execFileSync }) {
  return captureDb({ dbPath, execFileSync });
}

export function captureReplicasTable({ dbPath, execFileSync }) {
  return captureDb({ dbPath, execFileSync });
}

/**
 * Compare two sets of table metadata and return schema differences.
 * Only reports tables where column lists differ.
 */
/**
 * Update specific columns in a row and bump its HLC replica_timestamps.
 */
export function updateRow({ dbPath, execFileSync, table, rowId, idColumn = 'id', updates, timestamp, hlcTimestamp }) {
  if (!updates || Object.keys(updates).length === 0) {
    return { ok: false, error: 'no updates provided' };
  }

  const now = timestamp ?? hlcTimestamp ?? Date.now();
  const setClauses = [];

  // Add user-provided updates
  for (const [col, val] of Object.entries(updates)) {
    setClauses.push(`"${col}" = ${sqlLiteral(val)}`);
  }

  // Bump updated_at
  setClauses.push(`updated_at = ${sqlLiteral(now)}`);

  // Bump replica_timestamps for EACH updated field, so the field envelope HLC
  // advances and Android field-level merge accepts the new value.
  // Example: editing definition -> sets $.definition = T${now}
  const fieldNames = Object.keys(updates);
  setClauses.push(
    `replica_timestamps = CASE WHEN replica_timestamps IS NOT NULL AND replica_timestamps != '' THEN json_set(replica_timestamps, ${fieldNames.map(f => `'$.${f}'`).join(', ')}, ${fieldNames.map(f => sqlLiteral(`T${now}`)).join(', ')}) ELSE json(${sqlLiteral(JSON.stringify(Object.fromEntries(fieldNames.map(f => [f, `T${now}`]))))}) END`,
  );

  const sql = `UPDATE "${table}" SET ${setClauses.join(', ')} WHERE "${idColumn}" = '${escapeSqlValue(rowId)}'`;

  try {
    assertRowExists({ dbPath, execFileSync, table, idColumn, rowId });
    execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf8', stdio: 'pipe' });
    return { ok: true, table, rowId };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Row not found:')) {
      throw error;
    }
    return {
      ok: false,
      table,
      rowId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Mark a row as deleted (tombstone) by setting deleted_at and bumping HLC.
 */
export function softDeleteRow({ dbPath, execFileSync, table, rowId, idColumn = 'id', timestamp, hlcTimestamp }) {
  const now = timestamp ?? hlcTimestamp ?? Date.now();

  const sql = `
UPDATE "${table}"
SET deleted_at = ${sqlLiteral(now)},
    updated_at = ${sqlLiteral(now)},
    replica_timestamps = CASE
      WHEN replica_timestamps IS NOT NULL AND replica_timestamps != ''
      THEN json_set(replica_timestamps, '$.deleted', ${sqlLiteral(`T${now}`)})
      ELSE json(${sqlLiteral(JSON.stringify({ deleted: `T${now}` }))})
    END
WHERE "${idColumn}" = ${sqlLiteral(rowId)}
  `.trim();

  try {
    assertRowExists({ dbPath, execFileSync, table, idColumn, rowId });
    execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf8', stdio: 'pipe' });
    return { ok: true, table, rowId, deleted: true };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Row not found:')) {
      throw error;
    }
    return {
      ok: false,
      table,
      rowId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check for duplicate rows by specific column criteria.
 * Returns rows grouped by the given columns with count > 1.
 */
export function findDuplicates({ dbPath, execFileSync, table, groupColumns = ['book_hash'] }) {
  const cols = groupColumns.map((c) => `"${c}"`).join(', ');
  const sql = `SELECT ${cols}, count(*) AS c FROM "${table}" GROUP BY ${cols} HAVING c > 1`;

  try {
    const raw = execFileSync('sqlite3', [dbPath, '-json', sql], { encoding: 'utf8', stdio: 'pipe' });
    const rows = JSON.parse(raw);
    return {
      ok: true,
      table,
      duplicates: rows.map((r) => ({ ...r, c: Number(r.c) })),
      count: rows.length,
    };
  } catch (error) {
    return {
      ok: false,
      table,
      count: 0,
      duplicates: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check if an update is stale — i.e. the target row has a deleted_at timestamp
 * newer than or equal to the proposed update timestamp.
 *
 * Returns { stale: true, deletedAt } when the row is deleted with a newer timestamp.
 * Returns { stale: false } when the row can accept the update.
 */
export function isStaleUpdate({ dbPath, execFileSync, table, rowId, idColumn = 'id', updateTimestamp }) {
  try {
    const raw = execFileSync('sqlite3', [dbPath, '-json', `SELECT deleted_at FROM "${table}" WHERE "${idColumn}" = '${String(rowId).replace(/'/g, "''")}'`], { encoding: 'utf8', stdio: 'pipe' });
    const rows = JSON.parse(raw);
    if (!rows || rows.length === 0) {
      // Row doesn't exist — update is not stale, it targets a non-existent row
      return { stale: false, existing: false };
    }
    const deletedAt = rows[0].deleted_at;
    if (deletedAt === null || deletedAt === undefined || deletedAt === '') {
      return { stale: false, existing: true };
    }
    const dts = Number(deletedAt);
    if (Number.isNaN(dts)) {
      // Non-numeric deleted_at — can't compare, assume not stale
      return { stale: false, existing: true };
    }
    const uts = Number(updateTimestamp);
    if (Number.isNaN(uts)) {
      // Can't compare — assume not stale
      return { stale: false, existing: true };
    }
    // Stale if updateTimestamp is <= deletedAt
    return { stale: uts <= dts, deletedAt: dts };
  } catch (error) {
    return {
      stale: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function compareSchemas(desktopTables, androidTables) {
  const allNames = new Set();
  for (const t of desktopTables) allNames.add(t.name);
  for (const t of androidTables) allNames.add(t.name);

  const diffs = [];
  for (const name of allNames) {
    const dt = desktopTables.find((t) => t.name === name);
    const at = androidTables.find((t) => t.name === name);
    const desktopCols = (dt?.columns ?? []).slice().sort();
    const androidCols = (at?.columns ?? []).slice().sort();

    if (JSON.stringify(desktopCols) !== JSON.stringify(androidCols)) {
      diffs.push({
        table: name,
        desktopColumns: dt?.columns ?? [],
        androidColumns: at?.columns ?? [],
      });
    }
  }

  return diffs;
}
