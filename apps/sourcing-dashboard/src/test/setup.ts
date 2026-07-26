import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Explicit — @testing-library/react's own auto-cleanup relies on detecting a
// global `afterEach` (only present when vitest's `test.globals: true` is
// set, which this project deliberately doesn't — every test file imports
// `describe`/`it`/`expect` explicitly instead of relying on globals). Without
// this, a test's rendered DOM leaks into the next test in the same file,
// silently doubling up matches for any multi-test file (confirmed live:
// Connections.test.tsx's second test saw 4 "Enable" buttons instead of 2).
afterEach(() => {
  cleanup();
});
