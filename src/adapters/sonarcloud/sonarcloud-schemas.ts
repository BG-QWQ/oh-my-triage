import { z } from 'zod';

/** Validate SonarCloud token validation responses. */
export const SonarCloudAuthValidationSchema = z
  .object({
    valid: z.boolean(),
  })
  .passthrough();

/** Validate SonarCloud project search response components. */
export const SonarCloudProjectSchema = z
  .object({
    key: z.string(),
    name: z.string(),
    qualifier: z.string().optional(),
    visibility: z.string().optional(),
    lastAnalysisDate: z.string().optional(),
  })
  .passthrough();

/** Validate SonarCloud project search responses. */
export const SonarCloudProjectSearchSchema = z
  .object({
    paging: z
      .object({
        pageIndex: z.number().int(),
        pageSize: z.number().int(),
        total: z.number().int(),
      })
      .passthrough(),
    components: z.array(SonarCloudProjectSchema),
  })
  .passthrough();

/** Validate SonarCloud issue text ranges. */
export const SonarCloudTextRangeSchema = z
  .object({
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1).optional(),
    startOffset: z.number().int().min(0).optional(),
    endOffset: z.number().int().min(0).optional(),
  })
  .passthrough();

/** Validate SonarCloud issue objects returned by /api/issues/search. */
export const SonarCloudIssueSchema = z
  .object({
    key: z.string(),
    rule: z.string(),
    severity: z.enum(['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO']).or(z.string()),
    component: z.string(),
    project: z.string(),
    line: z.number().int().min(1).optional(),
    hash: z.string().optional(),
    textRange: SonarCloudTextRangeSchema.optional(),
    flows: z.array(z.unknown()).optional(),
    status: z.string(),
    resolution: z.string().optional(),
    message: z.string(),
    effort: z.string().optional(),
    debt: z.string().optional(),
    author: z.string().optional(),
    tags: z.array(z.string()).optional(),
    type: z.string().optional(),
    scope: z.string().optional(),
    quickFixAvailable: z.boolean().optional(),
    creationDate: z.string(),
    updateDate: z.string(),
  })
  .passthrough();

/** Validate SonarCloud issue search responses. */
export const SonarCloudIssueSearchSchema = z
  .object({
    total: z.number().int(),
    p: z.number().int().optional(),
    ps: z.number().int().optional(),
    paging: z
      .object({
        pageIndex: z.number().int(),
        pageSize: z.number().int(),
        total: z.number().int(),
      })
      .passthrough()
      .optional(),
    issues: z.array(SonarCloudIssueSchema),
  })
  .passthrough();

/** SonarCloud project accepted by the SonarCloud adapter. */
export type SonarCloudProject = z.infer<typeof SonarCloudProjectSchema>;

/** SonarCloud issue accepted by the SonarCloud adapter. */
export type SonarCloudIssue = z.infer<typeof SonarCloudIssueSchema>;

/** SonarCloud issue search page accepted by the SonarCloud adapter. */
export type SonarCloudIssueSearch = z.infer<typeof SonarCloudIssueSearchSchema>;
