import { z } from 'zod';

/** Summary statistics for a report */
export const ReportSummary = z.object({
  total: z.number().int().min(0),
  critical: z.number().int().min(0),
  high: z.number().int().min(0),
  medium: z.number().int().min(0),
  low: z.number().int().min(0),
  info: z.number().int().min(0),
});

export type ReportSummary = z.infer<typeof ReportSummary>;

/** Generated report metadata */
export const Report = z.object({
  id: z.string(),
  format: z.enum(['markdown', 'html', 'json', 'sarif']),
  scope: z.enum(['all', 'filtered', 'by_severity']),
  language: z.string().default('en'),
  summary: ReportSummary,
  top_priorities: z.array(z.string()).describe('Finding IDs'),
  content: z.string().optional().describe('Generated report content'),
  generated_at: z.string().datetime(),
  file_path: z.string().optional(),
});

export type Report = z.infer<typeof Report>;
