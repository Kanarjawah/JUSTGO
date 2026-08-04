import { randomBytes } from 'node:crypto';
import type { AccountStatus, Prisma, Role } from '@prisma/client';
import { prisma } from '../db';

export function generatePublicWalletReference(): string {
  // Non-sequential public reference — not derived from DB id.
  return `JG-W-${randomBytes(8).toString('hex').toUpperCase()}`;
}

export type CreateUserWithWalletInput = {
  phone: string;
  email?: string | null;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: Role;
  status?: AccountStatus;
  phoneVerifiedAt?: Date | null;
  termsAcceptedAt?: Date | null;
  /** Profile extras */
  driver?: { vehicleType?: string; licenseNumber?: string; applicationStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' };
  merchant?: { businessName: string; applicationStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' };
  admin?: { title?: string };
};

/**
 * Creates a User and exactly one LRD Wallet in the same transaction.
 * If wallet creation fails, the entire registration rolls back.
 * Public Admin signup must not call this with role ADMIN — use seed/invite only.
 */
export async function createUserWithWallet(
  input: CreateUserWithWalletInput,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const run = async (tx: Prisma.TransactionClient) => {
    const user = await tx.user.create({
      data: {
        phone: input.phone,
        email: input.email ?? null,
        passwordHash: input.passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role,
        status: input.status ?? 'PENDING',
        phoneVerifiedAt: input.phoneVerifiedAt ?? null,
        termsAcceptedAt: input.termsAcceptedAt ?? null,
      },
    });

    if (input.role === 'CUSTOMER') {
      await tx.customerProfile.create({ data: { userId: user.id } });
    } else if (input.role === 'DRIVER') {
      await tx.driverProfile.create({
        data: {
          userId: user.id,
          applicationStatus: input.driver?.applicationStatus ?? 'PENDING',
          vehicleType: input.driver?.vehicleType,
          licenseNumber: input.driver?.licenseNumber,
          availability: { create: { status: 'OFF' } },
        },
      });
    } else if (input.role === 'MERCHANT') {
      await tx.merchantProfile.create({
        data: {
          userId: user.id,
          businessName: input.merchant?.businessName ?? `${input.firstName}'s business`,
          applicationStatus: input.merchant?.applicationStatus ?? 'PENDING',
        },
      });
    } else if (input.role === 'ADMIN') {
      await tx.adminProfile.create({
        data: { userId: user.id, title: input.admin?.title ?? 'Platform Administrator' },
      });
    }

    const wallet = await tx.wallet.create({
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

    return { user, wallet };
  };

  if (client === prisma) {
    return prisma.$transaction(run);
  }
  return run(client);
}

/** Idempotent ensure: one wallet per user. Prefer createUserWithWallet for new accounts. */
export async function ensureUserWallet(userId: string, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  const existing = await tx.wallet.findUnique({ where: { userId } });
  if (existing) return existing;
  return tx.wallet.create({
    data: {
      userId,
      publicReference: generatePublicWalletReference(),
      currency: 'LRD',
      status: 'ACTIVE',
      availableCents: 0,
      pendingCents: 0,
      heldCents: 0,
    },
  });
}
