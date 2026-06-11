import { z } from 'zod';

/** Sync log entry for scanner ingestion operations */
export const SyncLog = z.object({
  id: z.string(),
  source: z.string().describe('Source type or ID'),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
  status: z.enum(['running', 'success', 'partial', 'failed']),
  findings_found: z.number().int().min(0),
  findings_new: z.number().int().min(0),
  findings_updated: z.number().int().min(0),
  findings_stale_marked: z.number().int().min(0).optional(),
  stale_isolation_applied: z.boolean().optional(),
  error_message: z.string().optional(),
});

export type SyncLog = z.infer<typeof SyncLog>;
