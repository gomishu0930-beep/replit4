export type ReadinessResult = {
  ok: boolean;
  checks: Record<string, { ok: boolean; message?: string }>;
};

export async function checkReadiness(): Promise<ReadinessResult> {
  const checks: Record<string, { ok: boolean; message?: string }> = {
    server: { ok: true },
  };
  const ok = Object.values(checks).every((c) => c.ok);
  return { ok, checks };
}
