import { describe, it, expect } from 'vitest';
import { VERSION } from '../../src/utils/version.js';

describe('skeleton', () => {
  it('exports VERSION', () => {
    expect(VERSION).toBe('0.1.2');
  });
});
