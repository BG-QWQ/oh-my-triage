import { generateFingerprint, generateLocationFingerprint, generateSemanticFingerprint, sha256 } from '../../utils/hash.js';
import type { Finding } from '../models/finding.js';

/** Generate all fingerprint layers for a finding */
export function generateFindingFingerprints(finding: Finding): {
  exact: string;
  location: string;
  semantic: string;
  near: string;
} {
  const exact = generateFingerprint({
    tool: finding.source.tool,
    ruleId: finding.source.rule_id,
    filePath: finding.location.file_path,
    startLine: finding.location.start_line,
    message: finding.message,
  });

    const location = generateLocationFingerprint({
    filePath: finding.location.file_path,
    startLine: finding.location.start_line,
    endLine: finding.location.end_line,
    contextHash: finding.location.code_snippet ? sha256(finding.location.code_snippet) : undefined,
  });

  const semantic = generateSemanticFingerprint({
    cweId: finding.cwe_id,
    filePath: finding.location.file_path,
    contextHash: finding.location.code_snippet ? sha256(finding.location.code_snippet) : undefined,
  });

  // Near-match: same CWE + normalized snippet
  const normalizedSnippet = finding.location.code_snippet
    ?.replace(/\s+/g, ' ')
    .slice(0, 100);
  const near = generateSemanticFingerprint({
    cweId: finding.cwe_id,
    filePath: finding.location.file_path,
    contextHash: normalizedSnippet,
  });

  return { exact, location, semantic, near };
}

/** Default fingerprint to use for deduplication */
export function getDefaultFingerprint(finding: Finding): string {
  return generateFindingFingerprints(finding).exact;
}
