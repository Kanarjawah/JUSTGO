import { decideDriver } from '@/server/next-routes/admin';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return decideDriver(request, (await context.params).id);
}
