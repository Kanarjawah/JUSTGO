import { setPrep } from '@/server/next-routes/merchant';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return setPrep(request, (await context.params).id);
}
