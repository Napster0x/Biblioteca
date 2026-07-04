#!/usr/bin/env node

import { createSyncDevEnvironment, requireDevHarness } from './sync-dev-env.mjs';
import { aggregateSyncStateStatus, captureAndroidState, captureDesktopState } from './sync-dev-state.mjs';

async function main() {
  requireDevHarness(process.env, 'dev sync state capture');
  const env = createSyncDevEnvironment();
  const semanticDeleteTarget = process.env.BIBLIOTECA_DEV_STATE_SEMANTIC_DELETE_TARGET
    ? JSON.parse(process.env.BIBLIOTECA_DEV_STATE_SEMANTIC_DELETE_TARGET)
    : undefined;
  const desktop = await captureDesktopState({ dataRoot: env.desktop.dataRoot });
  const android = await captureAndroidState({
    packageName: env.android.packageName,
    serverUrl: env.android.serverUrl,
    bookHash: process.env.BIBLIOTECA_DEV_STATE_BOOK_HASH,
    semanticDeleteTarget,
  });
  const status = aggregateSyncStateStatus(desktop, android);

  console.log(
    JSON.stringify(
      {
        ok: status === 'pass',
        status,
        environment: env,
        desktop,
        android,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
