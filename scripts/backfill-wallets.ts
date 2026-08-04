/**
 * Idempotent backfill: create one zero-balance LRD wallet for each user missing a wallet.
 * Does not modify balances, delete users, or create duplicates.
 *
 * Usage: npm run wallets:backfill
 */
import { PrismaClient } from '@prisma/client';
import { generatePublicWalletReference } from '../app/server/lib/create-user-with-wallet';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, phone: true, role: true, wallet: { select: { id: true } } },
  });

  let created = 0;
  let skipped = 0;

  for (const user of users) {
    if (user.wallet) {
      skipped += 1;
      continue;
    }
    await prisma.$transaction(async (tx) => {
      const again = await tx.wallet.findUnique({ where: { userId: user.id } });
      if (again) {
        skipped += 1;
        return;
      }
      await tx.wallet.create({
        data: {
          userId: user.id,
          publicReference: generatePublicWalletReference(),
          currency: 'LRD',
          status: 'ACTIVE',
          availableCents: 0,
          pendingCents: 0,
          heldCents: 0,
        },
      });
      created += 1;
    });
  }

  console.info(
    JSON.stringify({
      ok: true,
      scanned: users.length,
      created,
      skipped,
      message: 'Backfill complete. Existing balances unchanged.',
    }),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
