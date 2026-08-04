import { decideMerchant } from '@/server/next-routes/admin';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return decideMerchant(request, (await context.params).id);
}
