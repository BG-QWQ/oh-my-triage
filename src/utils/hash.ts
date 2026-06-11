import { createHash } from 'node:crypto';

/** Generate SHA256 hash of input */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Generate a stable fingerprint for a finding */
export function generateFingerprint(params: {
  tool: string;
  ruleId: string;
  filePath: string;
  startLine: number;
  message: string;
}): string {
  const data = JSON.stringify({
    t: params.tool,
    r: params.ruleId,
    f: params.filePath,
    l: params.startLine,
    m: params.message.slice(0, 200),
  });
  return sha256(data);
}

/** Generate a location-based fingerprint */
export function generateLocationFingerprint(params: {
  filePath: string;
  startLine: number;
  endLine?: number;
  contextHash?: string;
}): string {
  const data = JSON.stringify({
    f: params.filePath,
    s: params.startLine,
    e: params.endLine,
    c: params.contextHash,
  });
  return sha256(data);
}

/** Generate a semantic fingerprint based on CWE and file */
export function generateSemanticFingerprint(params: {
  cweId?: string;
  filePath: string;
  contextHash?: string;
}): string {
  const data = JSON.stringify({
    c: params.cweId ?? 'unknown',
    f: params.filePath,
    h: params.contextHash,
  });
  return sha256(data);
}
