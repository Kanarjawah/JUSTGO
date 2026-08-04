import { clearSession, getSessionUser } from '@/server/session';
import { writeAudit } from '@/server/lib/audit';
import { error, json } from '@/server/http';

export async function POST() {
  const user = await getSessionUser();
  if (!user) return error('Authentication required', 401);
  await clearSession();
  await writeAudit({
    actorId: user.id,
    action: 'LOGOUT',
    entityType: 'User',
    entityId: user.id,
  });
  return json({ ok: true });
}
