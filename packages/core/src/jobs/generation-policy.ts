/** New captures use the current policy; stored generations keep their own. */
export const SYNTHESIS_POLICY = 'accomplishments-2';
export function isSynthesisPolicy(policy: string | undefined): boolean {
  return policy === 'accomplishments-1' || policy === SYNTHESIS_POLICY;
}
export function requiresSkillsIntent(policy: string | undefined): boolean {
  return policy === SYNTHESIS_POLICY;
}
