import { z } from 'zod';

/** Fix pattern template for common rule types */
export const FixPattern = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  code_template: z.string().describe('Code template with placeholders'),
  applicable_languages: z.array(z.string()),
  prerequisites: z.array(z.string()).describe('Required libraries or environment'),
  breaking_risk: z.enum(['none', 'low', 'medium', 'high']),
});

export type FixPattern = z.infer<typeof FixPattern>;

/** Scanner rule definition with fix guidance */
export const Rule = z.object({
  id: z.string().describe('Composite ID: {tool}:{rule_id}'),
  tool: z.string(),
  rule_id: z.string(),
  name: z.string(),
  description: z.string(),
  severity: z.string().describe('Scanner-native severity').optional(),
  cwe_id: z.string().regex(/^CWE-\d+$/).optional(),
  owasp_category: z.string().optional(),
  fix_patterns: z.array(FixPattern).optional(),
  references: z.array(z.string().url()).optional(),
});

export type Rule = z.infer<typeof Rule>;
