import { normalizePath } from '../../utils/path-normalizer.js';
import type { FindingSource } from '../models/finding.js';

/** Map scanner-native fields to canonical Finding fields */
export function mapFields(params: {
  tool: string;
  ruleId: string;
  ruleName?: string;
  ruleDescription?: string;
  ruleHelpUrl?: string;
  originalId: string;
  originalUrl?: string;
  message: string;
  filePath: string;
  startLine: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
  cweId?: string;
  owaspCategory?: string;
  projectRoot?: string;
}): {
  source: FindingSource;
  title: string;
  location: {
    file_path: string;
    start_line: number;
    start_column?: number;
    end_line?: number;
    end_column?: number;
  };
} {
  const normalizedPath = normalizePath(params.filePath, params.projectRoot);

  const title = params.ruleName ?? params.message.slice(0, 100);

  return {
    source: {
      tool: params.tool,
      rule_id: params.ruleId,
      rule_name: params.ruleName,
      rule_description: params.ruleDescription,
      rule_help_url: params.ruleHelpUrl,
      original_id: params.originalId,
      original_url: params.originalUrl,
    },
    title,
    location: {
      file_path: normalizedPath,
      start_line: params.startLine,
      start_column: params.startColumn,
      end_line: params.endLine,
      end_column: params.endColumn,
    },
  };
}
