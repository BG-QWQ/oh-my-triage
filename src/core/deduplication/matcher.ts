import type { Finding } from '../models/finding.js';
import { generateFindingFingerprints } from './fingerprint.js';

export interface DuplicateGroup {
  group_id: string;
  representative: Finding;
  duplicates: Finding[];
  match_level: 'exact' | 'location' | 'semantic' | 'near';
  confidence: number;
}

type MatchLevel = DuplicateGroup['match_level'];

type DuplicateLayer = {
  prefix: string;
  matchLevel: MatchLevel;
  confidence: number;
  fingerprint: (finding: Finding) => string;
};

const DUPLICATE_LAYERS: DuplicateLayer[] = [
  {
    prefix: 'dup-exact',
    matchLevel: 'exact',
    confidence: 0.99,
    fingerprint: (finding) => generateFindingFingerprints(finding).exact,
  },
  {
    prefix: 'dup-loc',
    matchLevel: 'location',
    confidence: 0.9,
    fingerprint: (finding) => generateFindingFingerprints(finding).location,
  },
  {
    prefix: 'dup-sem',
    matchLevel: 'semantic',
    confidence: 0.75,
    fingerprint: (finding) => generateFindingFingerprints(finding).semantic,
  },
];

/** Preview duplicate groups without modifying the database */
export function previewDuplicates(findings: Finding[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const grouped = new Set<string>();

  for (const layer of DUPLICATE_LAYERS) {
    groups.push(...previewLayerDuplicates(findings, grouped, layer));
  }

  return groups;
}

/** Preview duplicate groups for one fingerprint layer. */
function previewLayerDuplicates(findings: Finding[], grouped: Set<string>, layer: DuplicateLayer): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  for (const [fingerprint, matches] of groupByLayerFingerprint(findings, grouped, layer).entries()) {
    if (matches.length <= 1) {
      continue;
    }
    groups.push(createDuplicateGroup(matches, fingerprint, layer));
    markGrouped(matches, grouped);
  }
  return groups;
}

/** Group unclaimed findings by the fingerprint selected for a layer. */
function groupByLayerFingerprint(findings: Finding[], grouped: Set<string>, layer: DuplicateLayer): Map<string, Finding[]> {
  const matchesByFingerprint = new Map<string, Finding[]>();
  for (const finding of findings) {
    if (grouped.has(finding.id)) {
      continue;
    }
    const fingerprint = layer.fingerprint(finding);
    const matches = matchesByFingerprint.get(fingerprint) ?? [];
    matches.push(finding);
    matchesByFingerprint.set(fingerprint, matches);
  }
  return matchesByFingerprint;
}

/** Convert a matching fingerprint bucket into a duplicate group. */
function createDuplicateGroup(matches: Finding[], fingerprint: string, layer: DuplicateLayer): DuplicateGroup {
  const sortedMatches = sortByRepresentativePriority(matches);
  const representative = sortedMatches[0];
  return {
    group_id: `${layer.prefix}-${fingerprint.slice(0, 12)}`,
    representative,
    duplicates: sortedMatches.filter((finding) => finding.id !== representative.id),
    match_level: layer.matchLevel,
    confidence: layer.confidence,
  };
}

/** Mark every finding in a duplicate bucket as claimed by earlier layers. */
function markGrouped(findings: Finding[], grouped: Set<string>): void {
  for (const finding of findings) {
    grouped.add(finding.id);
  }
}

/** Sort findings by the same priority used to select representatives. */
function sortByRepresentativePriority(findings: Finding[]): Finding[] {
  const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
  return [...findings].sort((a, b) => {
    const sevDiff = severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity);
    if (sevDiff !== 0) return sevDiff;
    return b.priority_score - a.priority_score;
  });
}
