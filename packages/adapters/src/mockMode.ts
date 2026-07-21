/**
 * Shared mock-mode gate for every adapter: `createX(env)` returns the mock
 * implementation whenever MOCK_MODE=true OR the adapter's own key looks like
 * an unfilled placeholder (see .dev.vars.example / spec section 10).
 */
export function isMockMode(mockModeFlag: string | undefined, ...secretKeys: (string | undefined)[]): boolean {
  if (mockModeFlag === 'true') return true;
  return secretKeys.some((key) => !key || key.startsWith('PLACEHOLDER__'));
}
