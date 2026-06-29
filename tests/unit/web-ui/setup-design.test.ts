import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();

function readProjectFile(path: string): string {
  return readFileSync(join(projectRoot, path), 'utf8');
}

describe('setup wizard design system migration', () => {
  it('uses the triage console shell and reusable primitives from the reference design', () => {
    const html = readProjectFile('src/web-ui/index.html');
    const css = readProjectFile('src/web-ui/styles.css');

    expect(html).toContain('class="app-shell"');
    expect(html).toContain('class="brand-mark"');
    expect(html).toContain('triage console');
    expect(html).toContain('class="step-eyebrow"');
    expect(html).toContain('class="scanner-modules"');
    expect(html).toContain('class="summary-readout"');
    expect(html).not.toMatch(/[🌉📄🐙☁️🔌🛡️🔍]/u);

    expect(css).toContain('--bg:        oklch(14% 0.012 260);');
    expect(css).toContain('--accent:    oklch(72% 0.135 85);');
    expect(css).toContain('--radius: 4px;');
    expect(css).toContain('.sidebar {');
    expect(css).toContain('width: 260px;');
    expect(css).toContain('.step-nav-item.active { background: var(--elevated); color: var(--accent); border-left-color: var(--accent); }');
    expect(css).toContain('@media (max-width: 820px)');
  });
});
