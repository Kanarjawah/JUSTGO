import { rejectOrder } from '@/server/next-routes/merchant';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return rejectOrder(request, (await context.params).id);
}
