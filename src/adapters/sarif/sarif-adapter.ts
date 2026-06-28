import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import type { AdapterFetchResult, BaseAdapter, ConnectionTestResult } from '../base-adapter.js';
import { OMTError, ErrorCodes } from '../../core/errors.js';
import { SarifLogSchema } from './sarif-schema.js';
import { mapSarifRunToFindings } from './sarif-result-mapper.js';
import { toAdapterError } from '../adapter-errors.js';

const MAX_SARIF_BYTES = 50 * 1024 * 1024;

/** Configuration for reading SARIF findings from a local file. */
export type SarifAdapterOptions = {
  filePath: string;
  projectRoot?: string;
};

/** Parse SARIF 2.1.0 files and normalize scanner results into oh-my-triage findings. */
export class SarifAdapter implements BaseAdapter {
  readonly sourceType = 'sarif';
  readonly displayName = 'SARIF';

  private readonly filePath: string;
  private readonly projectRoot?: string;

  constructor(options: SarifAdapterOptions) {
    this.filePath = options.filePath;
    this.projectRoot = options.projectRoot;
  }

  /** Verify that the SARIF file exists, is within size limits, and validates as SARIF 2.1.0. */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const sarif = await this.readSarifFile();
      const resultCount = sarif.runs.reduce((count, run) => count + (run.results?.length ?? 0), 0);
      return {
        valid: true,
        reason: `Validated SARIF 2.1.0 with ${sarif.runs.length} run(s) and ${resultCount} result(s).`,
      };
    } catch (error: unknown) {
      const adapterError = toAdapterError(error, {
        code: ErrorCodes.SARIF_PARSE_ERROR,
        message: 'Unable to validate SARIF file.',
        nextSteps: [
          'Confirm the file is valid JSON in SARIF 2.1.0 format.',
          'Regenerate the report from CodeQL, Semgrep, Trivy, or another SARIF-compatible scanner.',
        ],
      });
      return {
        valid: false,
        reason: adapterError.message,
        suggestion: adapterError.nextSteps.join(' '),
      };
    }
  }

  /** Read and normalize SARIF findings with cursor pagination over normalized results. */
  async fetchFindings(options: { cursor?: string; limit?: number } = {}): Promise<AdapterFetchResult> {
    try {
      const sarif = await this.readSarifFile();
      const findings = sarif.runs.flatMap((run) => mapSarifRunToFindings(run, { projectRoot: this.projectRoot }));
      const start = parseCursor(options.cursor);
      const limit = Math.max(1, options.limit ?? (findings.length || 100));
      const page = findings.slice(start, start + limit).map((finding) => ({ ...finding }));
      const next = start + limit;
      return {
        findings: page,
        total: findings.length,
        has_more: next < findings.length,
        next_cursor: next < findings.length ? String(next) : undefined,
      };
    } catch (error: unknown) {
      throw toAdapterError(error, {
        code: ErrorCodes.SARIF_PARSE_ERROR,
        message: 'Unable to fetch findings from SARIF file.',
        nextSteps: [
          'Validate the SARIF file with the connection test.',
          'Check that the file has not been truncated or replaced during sync.',
        ],
      });
    }
  }

  private async readSarifFile() {
    const stats = await this.statFile();
    if (stats.size > MAX_SARIF_BYTES) {
      throw new OMTError({
        code: ErrorCodes.SARIF_FILE_TOO_LARGE,
        message: `SARIF file is ${(stats.size / 1024 / 1024).toFixed(1)}MB, exceeding the 50MB limit.`,
        nextSteps: [
          'Export a smaller SARIF report or split the scanner output by project/module.',
          'Use scanner filtering to omit closed or informational findings before importing.',
        ],
        retryable: false,
        details: { max_bytes: MAX_SARIF_BYTES, actual_bytes: stats.size },
      });
    }

    const content = await readFile(this.filePath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error: unknown) {
      throw new OMTError({
        code: ErrorCodes.SARIF_PARSE_ERROR,
        message: `SARIF file contains malformed JSON: ${error instanceof Error ? error.message : String(error)}`,
        nextSteps: [
          'Regenerate the SARIF file from the scanner.',
          'Check for partial writes, trailing commas, or non-JSON log output mixed into the file.',
        ],
        retryable: false,
      });
    }

    const validation = SarifLogSchema.safeParse(parsed);
    if (!validation.success) {
      const hasVersionIssue = validation.error.issues.some((issue) => issue.path.join('.') === 'version');
      throw new OMTError({
        code: hasVersionIssue ? ErrorCodes.SARIF_INVALID_VERSION : ErrorCodes.SARIF_PARSE_ERROR,
        message: `SARIF validation failed: ${validation.error.issues
          .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
          .slice(0, 5)
          .join('; ')}`,
        nextSteps: [
          'Ensure the report declares SARIF version 2.1.0.',
          'Regenerate the report with a SARIF 2.1.0 compatible scanner/export option.',
        ],
        retryable: false,
      });
    }

    return validation.data;
  }

  private async statFile() {
    try {
      return await stat(this.filePath);
    } catch (error: unknown) {
      throw new OMTError({
        code: ErrorCodes.SARIF_FILE_NOT_FOUND,
        message: `SARIF file was not found or is not readable: ${error instanceof Error ? error.message : String(error)}`,
        nextSteps: [
          'Check that the configured SARIF path exists.',
          'Verify the current user has read permission for the file.',
        ],
        retryable: false,
      });
    }
  }
}

/** Parse adapter pagination cursors into zero-based offsets. */
export function parseCursor(cursor?: string): number {
  if (!cursor) {
    return 0;
  }
  const parsed = z.coerce.number().int().min(0).safeParse(cursor);
  if (!parsed.success) {
    throw new OMTError({
      code: ErrorCodes.ADAPTER_FETCH_FAILED,
      message: `Invalid SARIF cursor '${cursor}'.`,
      nextSteps: ['Use the next_cursor returned by the previous fetchFindings call.'],
      retryable: false,
    });
  }
  return parsed.data;
}
