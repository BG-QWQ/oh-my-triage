import { z } from 'zod';

const SocketAlertLocationSchema = z
  .object({
    repository: z
      .object({
        fullName: z.string().optional(),
      })
      .passthrough()
      .optional(),
    branch: z
      .object({
        name: z.string().optional(),
      })
      .passthrough()
      .optional(),
    artifact: z
      .object({
        name: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const SocketAlertVulnerabilitySchema = z
  .object({
    cveId: z.string().nullable().optional().transform((value) => value ?? undefined),
    cweIds: z.array(z.string()).nullable().optional().transform((value) => value ?? undefined),
  })
  .passthrough();

/** Validate a Socket.dev organization entry inside the organizations map. */
export const SocketOrganizationEntrySchema = z
  .object({
    id: z.string(),
    name: z.string().nullable().optional(),
    slug: z.string().optional(),
  })
  .passthrough();

/** Validate the Socket.dev organizations response.
 *
 * The live API returns organizations as a map keyed by organization slug,
 * not as an array. Each value contains the organization id and optional name.
 */
export const SocketOrganizationsResponseSchema = z
  .object({
    organizations: z.record(SocketOrganizationEntrySchema),
  })
  .passthrough();

/** Validate and normalize a Socket.dev alert object returned by the alerts API.
 *
 * Socket's live alerts endpoint currently uses camelCase fields and nested
 * location metadata, while older fixtures and stored raw data used snake_case
 * top-level fields. Normalize both shapes into the adapter's internal field
 * names so ingestion does not depend on one wire-format revision.
 */
export const SocketAlertSchema = z
  .object({
    id: z.string().optional(),
    key: z.string().optional(),
    severity: z.string().optional(),
    type: z.string().optional(),
    title: z.string().nullable().optional().transform((value) => value ?? undefined),
    description: z.string().nullable().optional().transform((value) => value ?? undefined),
    artifact_name: z.string().optional(),
    repo_full_name: z.string().optional(),
    branch: z.string().optional(),
    organization: z.string().optional(),
    state: z.string().optional(),
    status: z.string().optional(),
    cve_id: z.string().nullable().optional().transform((value) => value ?? undefined),
    cveId: z.string().nullable().optional().transform((value) => value ?? undefined),
    cwe_id: z.string().nullable().optional().transform((value) => value ?? undefined),
    cweIds: z.array(z.string()).nullable().optional().transform((value) => value ?? undefined),
    created_at: z.string().optional(),
    createdAt: z.string().optional(),
    updated_at: z.string().optional(),
    updatedAt: z.string().optional(),
    locations: z.array(SocketAlertLocationSchema).nullable().optional(),
    vulnerability: SocketAlertVulnerabilitySchema.nullable().optional(),
  })
  .passthrough()
  .superRefine((alert, context) => {
    if (!alert.id && !alert.key) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['id'], message: 'id or key is required' });
    }
    if (!alert.created_at && !alert.createdAt && !alert.updated_at && !alert.updatedAt) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['created_at'], message: 'created_at or createdAt is required' });
    }
  })
  .transform((alert) => {
    const location = alert.locations?.[0];
    const id = alert.id ?? alert.key;
    const createdAt = alert.created_at ?? alert.createdAt ?? alert.updated_at ?? alert.updatedAt;
    const updatedAt = alert.updated_at ?? alert.updatedAt ?? createdAt;
    if (!id || !createdAt) {
      throw new Error('Socket.dev alert failed required field normalization.');
    }

    return {
      ...alert,
      id,
      artifact_name: alert.artifact_name ?? location?.artifact?.name,
      repo_full_name: alert.repo_full_name ?? location?.repository?.fullName,
      branch: alert.branch ?? location?.branch?.name,
      organization: alert.organization ?? location?.repository?.fullName?.split('/')[0],
      state: alert.state ?? alert.status,
      cve_id: alert.cve_id ?? alert.cveId ?? alert.vulnerability?.cveId,
      cwe_id: alert.cwe_id ?? alert.cweIds?.[0] ?? alert.vulnerability?.cweIds?.[0],
      created_at: createdAt,
      updated_at: updatedAt,
    };
  });

/** Validate the Socket.dev alerts response.
 *
 * The live /alerts endpoint returns items, endCursor, and meta, but does not
 * include a totalCount field. Keep it optional so mocks and future API changes
 * do not break ingestion.
 */
export const SocketAlertsResponseSchema = z
  .object({
    items: z.array(SocketAlertSchema),
    endCursor: z.string().nullable(),
    totalCount: z.number().int().optional(),
  })
  .passthrough();

/** Organization entry value inside the Socket.dev organizations map. */
export type SocketOrganizationEntry = z.infer<typeof SocketOrganizationEntrySchema>;

/** Alert returned by the Socket.dev alerts API. */
export type SocketAlert = z.infer<typeof SocketAlertSchema>;

/** Organizations page returned by the Socket.dev organizations API. */
export type SocketOrganizationsResponse = z.infer<typeof SocketOrganizationsResponseSchema>;

/** Alerts page returned by the Socket.dev alerts API. */
export type SocketAlertsResponse = z.infer<typeof SocketAlertsResponseSchema>;
