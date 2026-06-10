import type { Finding } from '../models/finding.js';
import { generateFindingFingerprints } from './fingerprint.js';

export interface DuplicateGroup {
  group_id: string;
  representative: Finding;
  duplicates: Finding[];
  match_level: 'exact' | 'location' | 'semantic' | 'near';
  confidence: number;
}

/** Preview duplicate groups without modifying the database */
export function previewDuplicates(findings: Finding[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const grouped = new Set<string>();

  // Layer 1: Exact matches (same tool, rule, file, line, message)
  const exactMap = new Map<string, Finding[]>();
  for (const finding of findings) {
    const fps = generateFindingFingerprints(finding);
    const list = exactMap.get(fps.exact) ?? [];
    list.push(finding);
    exactMap.set(fps.exact, list);
  }

  for (const [fingerprint, matches] of exactMap.entries()) {
    if (matches.length > 1) {
      const representative = selectRepresentative(matches);
      const duplicateIds = matches.filter((f) => f.id !== representative.id);
      groups.push({
        group_id: `dup-exact-${fingerprint.slice(0, 12)}`,
        representative,
        duplicates: duplicateIds,
        match_level: 'exact',
        confidence: 0.99,
      });
      for (const f of matches) {
        grouped.add(f.id);
      }
    }
  }

  // Layer 2: Location matches (same file, line, context)
  const locationMap = new Map<string, Finding[]>();
  for (const finding of findings) {
    if (grouped.has(finding.id)) continue;
    const fps = generateFindingFingerprints(finding);
    const list = locationMap.get(fps.location) ?? [];
    list.push(finding);
    locationMap.set(fps.location, list);
  }

  for (const [fingerprint, matches] of locationMap.entries()) {
    if (matches.length > 1) {
      const representative = selectRepresentative(matches);
      const duplicateIds = matches.filter((f) => f.id !== representative.id);
      groups.push({
        group_id: `dup-loc-${fingerprint.slice(0, 12)}`,
        representative,
        duplicates: duplicateIds,
        match_level: 'location',
        confidence: 0.9,
      });
      for (const f of matches) {
        grouped.add(f.id);
      }
    }
  }

  // Layer 3: Semantic matches (same CWE, file, similar context)
  const semanticMap = new Map<string, Finding[]>();
  for (const finding of findings) {
    if (grouped.has(finding.id)) continue;
    const fps = generateFindingFingerprints(finding);
    const list = semanticMap.get(fps.semantic) ?? [];
    list.push(finding);
    semanticMap.set(fps.semantic, list);
  }

  for (const [fingerprint, matches] of semanticMap.entries()) {
    if (matches.length > 1) {
      const representative = selectRepresentative(matches);
      const duplicateIds = matches.filter((f) => f.id !== representative.id);
      groups.push({
        group_id: `dup-sem-${fingerprint.slice(0, 12)}`,
        representative,
        duplicates: duplicateIds,
        match_level: 'semantic',
        confidence: 0.75,
      });
      for (const f of matches) {
        grouped.add(f.id);
      }
    }
  }

  return groups;
}

/** Select the representative finding from a group (highest severity, then highest priority) */
function selectRepresentative(findings: Finding[]): Finding {
  const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
  return findings.sort((a, b) => {
    const sevDiff = severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity);
    if (sevDiff !== 0) return sevDiff;
    return b.priority_score - a.priority_score;
  })[0];
}
