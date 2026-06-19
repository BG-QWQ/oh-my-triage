import { z } from 'zod';

/** SARIF message payload accepted by oh-my-triage while preserving extension fields. */
export type SarifMessage = {
  text?: string;
  markdown?: string;
  id?: string;
  arguments?: string[];
  [key: string]: unknown;
};

/** SARIF artifact location accepted by oh-my-triage while preserving extension fields. */
export type SarifArtifactLocation = {
  uri?: string;
  uriBaseId?: string;
  index?: number;
  [key: string]: unknown;
};

/** SARIF source region accepted by oh-my-triage while preserving snippet details. */
export type SarifRegion = {
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
  snippet?: {
    text?: string;
    rendered?: SarifMessage;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

/** SARIF physical location accepted by oh-my-triage. */
export type SarifPhysicalLocation = {
  artifactLocation?: SarifArtifactLocation;
  region?: SarifRegion;
  [key: string]: unknown;
};

/** SARIF location accepted by oh-my-triage. */
export type SarifLocation = {
  id?: number;
  physicalLocation?: SarifPhysicalLocation;
  message?: SarifMessage;
  [key: string]: unknown;
};

/** SARIF default rule configuration accepted by oh-my-triage. */
export type SarifRuleConfiguration = {
  enabled?: boolean;
  level?: 'none' | 'note' | 'warning' | 'error';
  rank?: number;
  parameters?: Record<string, unknown>;
  [key: string]: unknown;
};

/** SARIF reporting descriptor used to enrich normalized findings. */
export type SarifRule = {
  id: string;
  name?: string;
  shortDescription?: SarifMessage;
  fullDescription?: SarifMessage;
  help?: SarifMessage;
  helpUri?: string;
  defaultConfiguration?: SarifRuleConfiguration;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
};

/** SARIF tool component accepted by oh-my-triage. */
export type SarifToolComponent = {
  name: string;
  fullName?: string;
  version?: string;
  semanticVersion?: string;
  informationUri?: string;
  rules?: SarifRule[];
  [key: string]: unknown;
};

/** SARIF result with validated locations, message, and fingerprint fields. */
export type SarifResult = {
  ruleId?: string;
  ruleIndex?: number;
  kind?: string;
  level?: 'none' | 'note' | 'warning' | 'error';
  message: SarifMessage;
  locations?: SarifLocation[];
  partialFingerprints?: Record<string, string>;
  fingerprints?: Record<string, string>;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
};

/** SARIF run with validated tool metadata and optional result list. */
export type SarifRun = {
  tool: {
    driver: SarifToolComponent;
    extensions?: SarifToolComponent[];
    [key: string]: unknown;
  };
  results?: SarifResult[];
  automationDetails?: {
    id?: string;
    [key: string]: unknown;
  };
  originalUriBaseIds?: Record<string, unknown>;
  [key: string]: unknown;
};

/** SARIF 2.1.0 log accepted by the oh-my-triage SARIF adapter. */
export type SarifLog = {
  version: '2.1.0';
  $schema?: string;
  runs: SarifRun[];
  [key: string]: unknown;
};

const sarifMessageSchema: z.ZodType<SarifMessage> = z
  .object({
    text: z.string().optional(),
    markdown: z.string().optional(),
    id: z.string().optional(),
    arguments: z.array(z.string()).optional(),
  })
  .passthrough();

const sarifArtifactLocationSchema: z.ZodType<SarifArtifactLocation> = z
  .object({
    uri: z.string().optional(),
    uriBaseId: z.string().optional(),
    index: z.number().int().optional(),
  })
  .passthrough();

const sarifRegionSchema: z.ZodType<SarifRegion> = z
  .object({
    startLine: z.number().int().min(1).optional(),
    startColumn: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional(),
    endColumn: z.number().int().min(1).optional(),
    snippet: z
      .object({
        text: z.string().optional(),
        rendered: sarifMessageSchema.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const sarifPhysicalLocationSchema: z.ZodType<SarifPhysicalLocation> = z
  .object({
    artifactLocation: sarifArtifactLocationSchema.optional(),
    region: sarifRegionSchema.optional(),
  })
  .passthrough();

const sarifLocationSchema: z.ZodType<SarifLocation> = z
  .object({
    id: z.number().int().optional(),
    physicalLocation: sarifPhysicalLocationSchema.optional(),
    message: sarifMessageSchema.optional(),
  })
  .passthrough();

const sarifRuleConfigurationSchema: z.ZodType<SarifRuleConfiguration> = z
  .object({
    enabled: z.boolean().optional(),
    level: z.enum(['none', 'note', 'warning', 'error']).optional(),
    rank: z.number().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const sarifReportingDescriptorSchema: z.ZodType<SarifRule> = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    shortDescription: sarifMessageSchema.optional(),
    fullDescription: sarifMessageSchema.optional(),
    help: sarifMessageSchema.optional(),
    helpUri: z.string().url().optional(),
    defaultConfiguration: sarifRuleConfigurationSchema.optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const sarifToolComponentSchema: z.ZodType<SarifToolComponent> = z
  .object({
    name: z.string(),
    fullName: z.string().optional(),
    version: z.string().optional(),
    semanticVersion: z.string().optional(),
    informationUri: z.string().url().optional(),
    rules: z.array(sarifReportingDescriptorSchema).optional(),
  })
  .passthrough();

const sarifToolSchema: z.ZodType<SarifRun['tool']> = z
  .object({
    driver: sarifToolComponentSchema,
    extensions: z.array(sarifToolComponentSchema).optional(),
  })
  .passthrough();

const sarifResultSchema: z.ZodType<SarifResult> = z
  .object({
    ruleId: z.string().optional(),
    ruleIndex: z.number().int().optional(),
    kind: z.string().optional(),
    level: z.enum(['none', 'note', 'warning', 'error']).optional(),
    message: sarifMessageSchema,
    locations: z.array(sarifLocationSchema).optional(),
    partialFingerprints: z.record(z.string(), z.string()).optional(),
    fingerprints: z.record(z.string(), z.string()).optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const sarifRunSchema: z.ZodType<SarifRun> = z
  .object({
    tool: sarifToolSchema,
    results: z.array(sarifResultSchema).optional(),
    automationDetails: z
      .object({
        id: z.string().optional(),
      })
      .passthrough()
      .optional(),
    originalUriBaseIds: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/** Validate a SARIF 2.1.0 log while preserving scanner-specific extension fields. */
export const SarifLogSchema: z.ZodType<SarifLog, z.ZodTypeDef, Omit<SarifLog, 'runs'> & { runs?: SarifRun[] }> = z
  .object({
    version: z.literal('2.1.0'),
    $schema: z.string().optional(),
    runs: z.array(sarifRunSchema).default([]),
  })
  .passthrough();
