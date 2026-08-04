import { setAccountStatus } from '@/server/next-routes/admin';

export async function POST(request: Request, context: { params: Promise<{ userId: string }> }) {
  return setAccountStatus(request, (await context.params).userId);
}
