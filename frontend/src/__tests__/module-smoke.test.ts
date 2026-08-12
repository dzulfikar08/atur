import { describe, it, expect } from 'vitest';

/**
 * Regression guard for blank-white crashes.
 *
 * A bad import/export (missing named export, circular import that resolves to
 * undefined, a module that throws at load time) crashes every route that mounts
 * the offender. These tests eagerly import the always-mounted shell plus the
 * files most often hand-edited, so such a regression fails CI instead of
 * shipping a white screen.
 *
 * NOTE: `@/main` is intentionally excluded — it calls createRoot() at module
 * top level, which has no #root element to bind to under jsdom.
 */
const MODULES = [
  '@/App',
  '@/components/ErrorBoundary',
  '@/components/layout/AppShell',
  '@/components/layout/TopBar',
  '@/components/layout/Sidebar',
  '@/components/mobile/BottomNav',
  '@/components/issues/IssueDetail',
];

describe('module load smoke (blank-white guard)', () => {
  for (const mod of MODULES) {
    it(`imports ${mod} without throwing`, async () => {
      await expect(import(mod)).resolves.toBeDefined();
    });
  }
});
