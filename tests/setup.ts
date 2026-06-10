import { vi } from 'vitest';

// Global test setup
vi.mock('keytar', () => ({
  default: {
    getPassword: vi.fn(),
    setPassword: vi.fn(),
    deletePassword: vi.fn(),
  },
}));

// Clean up any temporary databases after tests
afterAll(() => {
  // Cleanup handled per-test where needed
});
