import { updateProduct } from '@/server/next-routes/merchant';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return updateProduct(request, (await context.params).id);
}
