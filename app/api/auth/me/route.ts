import { getSessionUser } from '@/server/session';
import { error, json } from '@/server/http';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return error('Authentication required', 401);
  return json({ user });
}
