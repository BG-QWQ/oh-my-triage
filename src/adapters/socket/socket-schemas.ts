import { z } from 'zod';

/** Validate a Socket.dev organization returned by the organizations API. */
export const SocketOrganizationSchema = z
  .object({
    slug: z.string(),
    name: z.string().optional(),
  })
  .passthrough();

/** Validate the Socket.dev organizations response. */
export const SocketOrganizationsResponseSchema = z
  .object({
    organizations: z.array(SocketOrganizationSchema),
    endCursor: z.string().nullable().optional(),
  })
  .passthrough();

/** Validate a Socket.dev alert object returned by the alerts API. */
export const SocketAlertSchema = z
  .object({
    id: z.string(),
    severity: z.string().optional(),
    type: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    artifact_name: z.string().optional(),
    repo_full_name: z.string().optional(),
    branch: z.string().optional(),
    organization: z.string().optional(),
    state: z.string().optional(),
    cve_id: z.string().optional(),
    cwe_id: z.string().optional(),
    created_at: z.string(),
    updated_at: z.string().optional(),
  })
  .passthrough();

/** Validate the Socket.dev alerts response. */
export const SocketAlertsResponseSchema = z
  .object({
    items: z.array(SocketAlertSchema),
    endCursor: z.string().nullable(),
    totalCount: z.number().int(),
  })
  .passthrough();

/** Organization returned by the Socket.dev organizations API. */
export type SocketOrganization = z.infer<typeof SocketOrganizationSchema>;

/** Alert returned by the Socket.dev alerts API. */
export type SocketAlert = z.infer<typeof SocketAlertSchema>;

/** Organizations page returned by the Socket.dev organizations API. */
export type SocketOrganizationsResponse = z.infer<typeof SocketOrganizationsResponseSchema>;

/** Alerts page returned by the Socket.dev alerts API. */
export type SocketAlertsResponse = z.infer<typeof SocketAlertsResponseSchema>;
