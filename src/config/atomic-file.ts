import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';

/** Maximum number of timestamped backup files to retain for any target. */
const MAX_BACKUP_FILES = 5;

/** Options controlling atomic file writes and backup behavior. */
export type AtomicWriteOptions = {
  /** When true and the target file already exists, copy it to a timestamped backup before replacing. */
  backup?: boolean;
};

/** Information about a restored backup. */
export type RestoredBackup = {
  /** Path of the backup file that was restored. */
  backupPath: string;
  /** Raw content read from the backup before restoration. */
  content: string;
};

/** Generate a hidden temporary file path in the same directory as the target.
 *
 * Keeping the temp file in the same directory ensures `rename` is atomic
 * and cannot fail with EXDEV.
 */
function tempFilePath(targetPath: string): string {
  const dir = dirname(targetPath);
  const base = basename(targetPath);
  const nonce = randomBytes(4).toString('hex');
  return join(dir, `.${base}.${process.pid}.${Date.now()}.${nonce}.tmp`);
}

/** Build a timestamped backup path for a target file. */
function backupPath(targetPath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${targetPath}.bak-${timestamp}`;
}

/** Return the filename prefix used to identify backups of targetPath. */
function backupPrefix(targetPath: string): string {
  return `${basename(targetPath)}.bak-`;
}

/** List matching backup paths for targetPath, newest first.
 *
 * Backup names include a lexicographically sortable ISO timestamp, so a
 * simple sort + reverse yields the correct age order without parsing dates.
 */
async function listBackupPaths(targetPath: string): Promise<string[]> {
  const dir = dirname(targetPath);
  const prefix = backupPrefix(targetPath);

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error: unknown) {
    if (isEnoent(error)) {
      return [];
    }
    throw error;
  }

  return entries
    .filter((name) => name.startsWith(prefix))
    .sort((left, right) => right.localeCompare(left))
    .map((name) => join(dir, name));
}

/** Remove oldest backups so no more than MAX_BACKUP_FILES remain. */
async function rotateBackups(targetPath: string): Promise<void> {
  const backups = await listBackupPaths(targetPath);
  const toRemove = backups.slice(MAX_BACKUP_FILES);

  for (const path of toRemove) {
    await rm(path, { force: true });
  }
}

/** Write content to targetPath atomically using a same-directory temp file and rename.
 *
 * The target is never in a partially-written state: readers either see the old
 * file or the new file, never a truncated file. When backup is enabled, the
 * newly written content is copied to a timestamped backup after the rename
 * succeeds so the most recent valid version is preserved against future
 * corruption.
 */
export async function writeFileAtomically(
  targetPath: string,
  content: string,
  options: AtomicWriteOptions = {}
): Promise<void> {
  const dir = dirname(targetPath);
  await mkdir(dir, { recursive: true });

  const tempPath = tempFilePath(targetPath);
  try {
    await writeFile(tempPath, content, 'utf-8');
    await atomicRename(tempPath, targetPath);
  } catch (error: unknown) {
    await removeTempFile(tempPath);
    throw error;
  }

  if (options.backup && content.trim()) {
    const destination = backupPath(targetPath);
    await copyFile(targetPath, destination);
    await rotateBackups(targetPath);
  }
}

/** Create a timestamped backup of targetPath if it exists and is non-empty. */
export async function createBackup(targetPath: string): Promise<string | undefined> {
  try {
    const content = await readFile(targetPath, 'utf-8');
    if (!content.trim()) {
      return undefined;
    }
    const destination = backupPath(targetPath);
    await copyFile(targetPath, destination);
    await rotateBackups(targetPath);
    return destination;
  } catch (error: unknown) {
    if (isEnoent(error)) {
      return undefined;
    }
    throw error;
  }
}

/** Rename source to destination, retrying on transient Windows lock errors. */
async function atomicRename(source: string, destination: string): Promise<void> {
  const maxAttempts = 5;
  const baseDelayMs = 10;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error: unknown) {
      if (isTransientRenameError(error) && attempt < maxAttempts) {
        await sleep(baseDelayMs * attempt);
        continue;
      }
      throw error;
    }
  }
}

/** Remove a leftover temp file, ignoring ENOENT. */
async function removeTempFile(tempPath: string): Promise<void> {
  try {
    await rm(tempPath, { force: true });
  } catch {
    // Ignore cleanup failures so the original error can propagate.
  }
}

/** Wait for the given number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Return true when an error is a transient rename failure on Windows. */
function isTransientRenameError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'EACCES')
  );
}

/** Return true when an error represents a missing file. */
function isEnoent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** Find the newest backup file matching targetPath's backup prefix. */
export async function findNewestBackup(targetPath: string): Promise<string | undefined> {
  const backups = await listBackupPaths(targetPath);
  return backups[0];
}

/** Read and validate the newest backup file.
 *
 * A backup is valid only when it is non-empty and parseable as JSON.
 * Returns undefined when no valid backup exists.
 */
export async function readValidBackup(targetPath: string): Promise<RestoredBackup | undefined> {
  const backupPath = await findNewestBackup(targetPath);
  if (!backupPath) {
    return undefined;
  }

  try {
    const content = await readFile(backupPath, 'utf-8');
    if (!content.trim()) {
      return undefined;
    }
    JSON.parse(content);
    return { backupPath, content };
  } catch {
    return undefined;
  }
}
