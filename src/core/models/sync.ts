import { z } from 'zod'

export const SyncStatus = z.enum(['running', 'success', 'partial', 'failed'])
export type SyncStatus = z.infer<typeof SyncStatus>

export const SyncLogSchema = z.object({
  id: z.string(),
  source: z.string(),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
  status: SyncStatus,
  findings_found: z.number().default(0),
  findings_new: z.number().default(0),
  findings_updated: z.number().default(0),
  error_message: z.string().optional(),
})

export type SyncLog = z.infer<typeof SyncLogSchema>
