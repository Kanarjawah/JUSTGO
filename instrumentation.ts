export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') return;
  // `next build` also invokes instrumentation; enforce the mock ban at runtime only.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const { assertOrangeSmsSafeToStart } = await import('./integrations/orange-sms');
  assertOrangeSmsSafeToStart();
}
