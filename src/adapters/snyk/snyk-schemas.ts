import { z } from 'zod';

/** Validate a Snyk organization returned by the REST API. */
export const SnykOrganizationSchema = z
  .object({
    id: z.string(),
    attributes: z
      .object({
        name: z.string().optional(),
        slug: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

/** Validate a Snyk severity entry within an issue. */
export const SnykSeveritySchema = z
  .object({
    level: z.string().optional(),
    score: z.number().optional(),
    source: z.string().optional(),
  })
  .passthrough();

/** Validate a Snyk issue package relationship. */
export const SnykPackageDataSchema = z
  .object({
    id: z.string().optional(),
  })
  .passthrough();

/** Validate Snyk issue relationships returned by the REST API. */
export const SnykIssueRelationshipsSchema = z
  .object({
    package: z
      .object({
        data: SnykPackageDataSchema.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/** Validate a Snyk issue returned by the REST API. */
export const SnykIssueSchema = z
  .object({
    id: z.string(),
    type: z.string().optional(),
    attributes: z
      .object({
        key: z.string().optional(),
        title: z.string().optional(),
        type: z.string().optional(),
        status: z.string().optional(),
        created_at: z.string().optional(),
        updated_at: z.string().optional(),
        severities: z.array(SnykSeveritySchema).optional(),
      })
      .passthrough(),
    relationships: SnykIssueRelationshipsSchema.optional(),
  })
  .passthrough();

/** Validate the links object used for cursor pagination. */
export const SnykLinksSchema = z
  .object({
    next: z.string().optional(),
  })
  .passthrough();

/** Validate the Snyk organizations response. */
export const SnykOrganizationsResponseSchema = z
  .object({
    data: z.array(SnykOrganizationSchema),
    links: SnykLinksSchema.optional(),
  })
  .passthrough();

/** Validate the Snyk issues response. */
export const SnykIssuesResponseSchema = z
  .object({
    data: z.array(SnykIssueSchema),
    links: SnykLinksSchema.optional(),
  })
  .passthrough();

/** Validate a Snyk project target relationship used to map projects to repositories. */
export const SnykProjectTargetSchema = z
  .object({
    id: z.string().optional(),
    attributes: z
      .object({
        url: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

/** Validate a Snyk project returned by the REST API. */
export const SnykProjectSchema = z
  .object({
    id: z.string(),
    attributes: z
      .object({
        name: z.string().optional(),
      })
      .passthrough(),
    relationships: z
      .object({
        target: z
          .object({
            data: SnykProjectTargetSchema.optional(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

/** Validate the Snyk projects response. */
export const SnykProjectsResponseSchema = z
  .object({
    data: z.array(SnykProjectSchema),
    links: SnykLinksSchema.optional(),
  })
  .passthrough();

/** Snyk organization accepted by the Snyk client. */
export type SnykOrganization = z.infer<typeof SnykOrganizationSchema>;

/** Snyk issue accepted by the Snyk client. */
export type SnykIssue = z.infer<typeof SnykIssueSchema>;

/** Snyk project accepted by the Snyk client. */
export type SnykProject = z.infer<typeof SnykProjectSchema>;

/** Snyk organizations response accepted by the Snyk client. */
export type SnykOrganizationsResponse = z.infer<typeof SnykOrganizationsResponseSchema>;

/** Snyk issues response accepted by the Snyk client. */
export type SnykIssuesResponse = z.infer<typeof SnykIssuesResponseSchema>;

/** Snyk projects response accepted by the Snyk client. */
export type SnykProjectsResponse = z.infer<typeof SnykProjectsResponseSchema>;
