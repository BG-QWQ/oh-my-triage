import { z } from 'zod';

/** Validate one Semgrep finding while preserving scanner-specific fields. */
export const SemgrepFindingSchema = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    severity: z.string().optional(),
    path: z.string().optional(),
    message: z.string().optional(),
    ruleId: z.string().optional(),
    status: z.string().optional(),
    triage_state: z.string().optional(),
    created_at: z.string().optional(),
    triaged_at: z.string().optional(),
    rule: z
      .object({
        id: z.string().optional(),
        name: z.string().optional(),
        message: z.string().optional(),
        cweNames: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    location: z
      .object({
        path: z.string().optional(),
        line: z.number().int().min(1).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/** Validate Semgrep nested SAST findings payloads. */
const SemgrepNestedFindingsSchema = z
  .object({
    findings: z.array(SemgrepFindingSchema),
  })
  .passthrough();

/** Validate Semgrep list findings responses with nested and flat shapes. */
export const SemgrepFindingsResponseSchema = z
  .object({
    sastFindings: SemgrepNestedFindingsSchema.optional(),
    findings: z.array(SemgrepFindingSchema).optional(),
  })
  .passthrough();

/** Validate Semgrep deployment entries while preserving extension fields. */
export const SemgrepDeploymentSchema = z
  .object({
    slug: z.string(),
    name: z.string().optional(),
  })
  .passthrough();

/** Validate Semgrep deployment listing responses. */
export const SemgrepDeploymentListSchema = z
  .object({
    deployments: z.array(SemgrepDeploymentSchema),
  })
  .passthrough();

/** Semgrep finding accepted by the Semgrep adapter. */
export type SemgrepFinding = z.infer<typeof SemgrepFindingSchema>;

/** Semgrep deployment accepted by the Semgrep adapter. */
export type SemgrepDeployment = z.infer<typeof SemgrepDeploymentSchema>;

/** Semgrep list findings response accepted by the Semgrep adapter. */
export type SemgrepFindingsResponse = z.infer<typeof SemgrepFindingsResponseSchema>;

/** Semgrep deployment listing response accepted by the Semgrep adapter. */
export type SemgrepDeploymentList = z.infer<typeof SemgrepDeploymentListSchema>;
