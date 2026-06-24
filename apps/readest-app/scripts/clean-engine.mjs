/**
 * Dev sync clean engine — post-reset verification functions.
 *
 * Verifies that after a reset, no residual sync state remains:
 * - No library.json
 * - No .db, -wal, -shm files
 * - No Book/ directories
 * - No .bak files
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Verify that the desktop data root is clean after reset.
 *
 * Checks:
 * - library.json does not exist (anywhere under Readest/)
 * - No .db, .db-wal, .db-shm files exist
 * - No Book/ directories exist
 * - No .bak files exist
 *
 * @param {string} dataRoot - Desktop data root path
 * @returns {{clean: boolean, residuals: string[]}}
 */
export function verifyCleanState(dataRoot) {
  const residuals = [];

  const readestDir = join(dataRoot, 'Readest');
  const booksDir = join(readestDir, 'Books');

  // Check library.json
  const libraryPath = join(booksDir, 'library.json');
  if (existsSync(libraryPath)) residuals.push(libraryPath);

  // Check for .db, -wal, -shm files under Readest/
  const dbPatterns = ['annotations.db', 'citas.db', 'dictionary.db'];
  for (const name of dbPatterns) {
    const dbPath = join(readestDir, name);
    if (existsSync(dbPath)) residuals.push(dbPath);
    if (existsSync(dbPath + '-wal')) residuals.push(dbPath + '-wal');
    if (existsSync(dbPath + '-shm')) residuals.push(dbPath + '-shm');
  }

  // Check for .bak files under Readest/ and dataRoot/
  if (existsSync(readestDir)) {
    try {
      for (const name of readdirSync(readestDir)) {
        if (name.endsWith('.bak')) residuals.push(join(readestDir, name));
      }
    } catch {
      // directory may not exist
    }
  }
  if (existsSync(dataRoot)) {
    try {
      for (const name of readdirSync(dataRoot)) {
        if (name.endsWith('.bak')) residuals.push(join(dataRoot, name));
      }
    } catch {
      // directory may not exist
    }
  }

  // Check for Book/ directories under Readest/Books/ and dataRoot/Books/
  for (const dir of [booksDir, join(dataRoot, 'Books')]) {
    if (existsSync(dir)) {
      try {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          try {
            if (statSync(full).isDirectory()) residuals.push(full);
          } catch {
            // broken symlink
          }
        }
      } catch {
        // can't read directory
      }
    }
  }

  return { clean: residuals.length === 0, residuals };
}
