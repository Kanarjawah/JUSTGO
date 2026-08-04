import { setStage } from '@/server/next-routes/driver';

export async function POST(request: Request, context: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await context.params;
  return setStage(request, kind, id);
}
