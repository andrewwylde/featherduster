import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Suites spawn real Node/tool processes and exercise short worker leases.
    // CPU-count parallelism oversubscribes these integration tests on large hosts.
    // Keep their real deadlines/assertions intact rather than dilating timeouts.
    maxWorkers: 2,
    minWorkers: 1,
    testTimeout: 15000,
  },
});
