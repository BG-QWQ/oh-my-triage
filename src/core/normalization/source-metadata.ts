import type { SourceType } from '../models/common.js';

/** Metadata and display info for scanner sources */
export const SOURCE_METADATA: Record<SourceType, { displayName: string; supportsWeb: boolean }> = {
  sarif: { displayName: 'SARIF File', supportsWeb: false },
  github: { displayName: 'GitHub Code Scanning', supportsWeb: true },
  sonarcloud: { displayName: 'SonarCloud', supportsWeb: true },
  socket: { displayName: 'Socket.dev', supportsWeb: true },
  snyk: { displayName: 'Snyk', supportsWeb: true },
  semgrep: { displayName: 'Semgrep', supportsWeb: true },
  trivy: { displayName: 'Trivy', supportsWeb: false },
  sbom: { displayName: 'SBOM', supportsWeb: false },
};

/** Get human-readable display name for a source type */
export function getSourceDisplayName(source: SourceType): string {
  return SOURCE_METADATA[source]?.displayName ?? source;
}

/** Check if a source supports web-based setup wizard */
export function sourceSupportsWebSetup(source: SourceType): boolean {
  return SOURCE_METADATA[source]?.supportsWeb ?? false;
}
