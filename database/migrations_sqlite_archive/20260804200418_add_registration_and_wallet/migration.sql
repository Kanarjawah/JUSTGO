-- Expand wallets for all roles: publicReference, unique userId, holds, payouts, withdrawals.
-- Safe for existing Wallet rows (backfills publicReference).

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- Redefine Wallet with publicReference + unique userId + heldCents/status
CREATE TABLE "new_Wallet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publicReference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'LRD',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "availableCents" INTEGER NOT NULL DEFAULT 0,
    "pendingCents" INTEGER NOT NULL DEFAULT 0,
    "heldCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Wallet" ("availableCents", "createdAt", "currency", "id", "pendingCents", "updatedAt", "userId", "publicReference", "heldCents", "status")
SELECT
  "availableCents",
  "createdAt",
  "currency",
  "id",
  "pendingCents",
  "updatedAt",
  "userId",
  'JG-W-' || upper(hex(randomblob(8))),
  0,
  'ACTIVE'
FROM "Wallet";
DROP TABLE "Wallet";
ALTER TABLE "new_Wallet" RENAME TO "Wallet";
CREATE UNIQUE INDEX "Wallet_publicReference_key" ON "Wallet"("publicReference");
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

CREATE TABLE "PayoutDestination" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "accountHolderName" TEXT NOT NULL,
    "bankName" TEXT,
    "accountNumberEncrypted" TEXT,
    "bankOrBranchCode" TEXT,
    "provider" TEXT,
    "phoneEncrypted" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'LRD',
    "country" TEXT NOT NULL DEFAULT 'LR',
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "displayHint" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "changeCooloffUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "verifiedAt" DATETIME,
    CONSTRAINT "PayoutDestination_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PayoutDestination_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "WithdrawalRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'LRD',
    "payoutDestinationId" TEXT NOT NULL,
    "provider" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "failureReason" TEXT,
    "requestedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "ledgerTxId" TEXT,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" DATETIME,
    "completedAt" DATETIME,
    CONSTRAINT "WithdrawalRequest_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WithdrawalRequest_payoutDestinationId_fkey" FOREIGN KEY ("payoutDestinationId") REFERENCES "PayoutDestination" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WithdrawalRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WithdrawalRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WithdrawalRequest_ledgerTxId_fkey" FOREIGN KEY ("ledgerTxId") REFERENCES "WalletTransaction" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "WalletHold" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'LRD',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT NOT NULL,
    "withdrawalRequestId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" DATETIME,
    "capturedAt" DATETIME,
    CONSTRAINT "WalletHold_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WalletHold_withdrawalRequestId_fkey" FOREIGN KEY ("withdrawalRequestId") REFERENCES "WithdrawalRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WalletHold_withdrawalRequestId_key" ON "WalletHold"("withdrawalRequestId");
CREATE UNIQUE INDEX "WalletHold_idempotencyKey_key" ON "WalletHold"("idempotencyKey");
CREATE INDEX "WalletHold_walletId_status_idx" ON "WalletHold"("walletId", "status");
CREATE INDEX "PayoutDestination_userId_active_idx" ON "PayoutDestination"("userId", "active");
CREATE UNIQUE INDEX "WithdrawalRequest_idempotencyKey_key" ON "WithdrawalRequest"("idempotencyKey");
CREATE UNIQUE INDEX "WithdrawalRequest_ledgerTxId_key" ON "WithdrawalRequest"("ledgerTxId");
CREATE INDEX "WithdrawalRequest_walletId_status_idx" ON "WithdrawalRequest"("walletId", "status");
CREATE INDEX "WithdrawalRequest_requestedById_requestedAt_idx" ON "WithdrawalRequest"("requestedById", "requestedAt");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
