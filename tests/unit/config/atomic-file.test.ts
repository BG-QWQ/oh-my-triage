import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackup, findNewestBackup, writeFileAtomically } from '@/config/atomic-file.js';

describe('atomic file backups', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'omt-atomic-file-'));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(tempDir, { force: true, recursive: true });
  });

  function configPath(name = 'oh-my-triage.config.json'): string {
    return join(tempDir, name);
  }

  function listBackups(targetPath: string): string[] {
    const dir = dirname(targetPath);
    const prefix = `${basename(targetPath)}.bak-`;

    return readdirSync(dir)
      .filter((name) => name.startsWith(prefix))
      .sort()
      .map((name) => join(dir, name));
  }

  function backupPathFor(targetPath: string, timestamp: string): string {
    return `${targetPath}.bak-${new Date(timestamp).toISOString().replace(/[:.]/g, '-')}`;
  }

  function seedBackup(targetPath: string, timestamp: string, content: string): string {
    const backup = backupPathFor(targetPath, timestamp);
    writeFileSync(backup, content, 'utf-8');
    return backup;
  }

  it('writeFileAtomically retains only the five newest timestamped backups', async () => {
    const targetPath = configPath();

    for (let index = 0; index < 8; index += 1) {
      vi.setSystemTime(new Date(`2025-01-01T00:00:0${index}.000Z`));
      await writeFileAtomically(targetPath, `content-${index}`, { backup: true });
    }

    const backups = listBackups(targetPath);
    expect(backups).toHaveLength(5);

    const expectedBackups = [3, 4, 5, 6, 7].map((index) =>
      backupPathFor(targetPath, `2025-01-01T00:00:0${index}.000Z`)
    );
    expect(backups).toEqual(expectedBackups);

    const newestBackup = await findNewestBackup(targetPath);
    expect(newestBackup).toBe(expectedBackups[4]);
    expect(newestBackup).not.toBeUndefined();
    if (newestBackup === undefined) {
      throw new Error('Expected newest backup to be defined');
    }
    expect(readFileSync(newestBackup, 'utf-8')).toBe('content-7');
  });

  it('createBackup keeps existing backups when fewer than five exist', async () => {
    const targetPath = configPath();
    writeFileSync(targetPath, 'current-content', 'utf-8');

    const seededBackups = [
      seedBackup(targetPath, '2025-01-01T00:00:00.000Z', 'backup-0'),
      seedBackup(targetPath, '2025-01-01T00:00:01.000Z', 'backup-1'),
      seedBackup(targetPath, '2025-01-01T00:00:02.000Z', 'backup-2'),
    ];

    vi.setSystemTime(new Date('2025-01-01T00:00:10.000Z'));

    const createdBackup = await createBackup(targetPath);

    const backups = listBackups(targetPath);
    expect(backups).toHaveLength(4);
    expect(backups.slice(0, 3)).toEqual(seededBackups);
    expect(readFileSync(seededBackups[0], 'utf-8')).toBe('backup-0');
    expect(readFileSync(seededBackups[1], 'utf-8')).toBe('backup-1');
    expect(readFileSync(seededBackups[2], 'utf-8')).toBe('backup-2');
    expect(createdBackup).toBe(backupPathFor(targetPath, '2025-01-01T00:00:10.000Z'));
  });

  it('backup rotation leaves similar non-matching files untouched', async () => {
    const targetPath = configPath();
    const otherPath = configPath('other.config.json');
    writeFileSync(targetPath, 'current-content', 'utf-8');

    const ignoredFiles = [
      join(tempDir, `${basename(targetPath)}.backup-2025-01-01T00-00-00-000Z`),
      join(tempDir, `${basename(targetPath)}.bak`),
      join(tempDir, `${basename(targetPath)}.bakish-2025-01-01T00-00-00-000Z`),
      backupPathFor(otherPath, '2025-01-01T00:00:00.000Z'),
    ];

    for (const filePath of ignoredFiles) {
      writeFileSync(filePath, 'ignore-me', 'utf-8');
    }

    for (let index = 0; index < 7; index += 1) {
      vi.setSystemTime(new Date(`2025-01-01T00:01:0${index}.000Z`));
      await writeFileAtomically(targetPath, `rotated-${index}`, { backup: true });
    }

    const backups = listBackups(targetPath);
    expect(backups).toHaveLength(5);

    for (const filePath of ignoredFiles) {
      expect(readFileSync(filePath, 'utf-8')).toBe('ignore-me');
    }

    expect(backups.every((filePath) => filePath.startsWith(`${targetPath}.bak-`))).toBe(true);
  });
});
