-- AlterTable
ALTER TABLE "User" ADD COLUMN "phoneVerifiedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "termsAcceptedAt" DATETIME;

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'LRD',
    "availableCents" INTEGER NOT NULL DEFAULT 0,
    "pendingCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'LRD',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "providerReference" TEXT,
    "description" TEXT NOT NULL,
    "relatedRideId" TEXT,
    "relatedDeliveryId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WalletTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletId" TEXT,
    "userId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'LRD',
    "method" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerReference" TEXT,
    "momoPhone" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "walletTxId" TEXT,
    "failureReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "PaymentAttempt_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PaymentAttempt_walletTxId_fkey" FOREIGN KEY ("walletTxId") REFERENCES "WalletTransaction" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentMethodReference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "walletId" TEXT,
    "method" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalRef" TEXT,
    "displayHint" TEXT NOT NULL,
    "momoPhoneMasked" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaymentMethodReference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentMethodReference_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Refund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paymentId" TEXT,
    "walletTransactionId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'LRD',
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerReference" TEXT,
    "rideRequestId" TEXT,
    "deliveryRequestId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Refund_walletTransactionId_fkey" FOREIGN KEY ("walletTransactionId") REFERENCES "WalletTransaction" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Refund_rideRequestId_fkey" FOREIGN KEY ("rideRequestId") REFERENCES "RideRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Refund_deliveryRequestId_fkey" FOREIGN KEY ("deliveryRequestId") REFERENCES "DeliveryRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Refund" ("amountCents", "createdAt", "deliveryRequestId", "id", "paymentId", "reason", "rideRequestId") SELECT "amountCents", "createdAt", "deliveryRequestId", "id", "paymentId", "reason", "rideRequestId" FROM "Refund";
DROP TABLE "Refund";
ALTER TABLE "new_Refund" RENAME TO "Refund";
CREATE UNIQUE INDEX "Refund_walletTransactionId_key" ON "Refund"("walletTransactionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_currency_key" ON "Wallet"("userId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_idempotencyKey_key" ON "WalletTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WalletTransaction_walletId_createdAt_idx" ON "WalletTransaction"("walletId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_provider_providerReference_key" ON "WalletTransaction"("provider", "providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_idempotencyKey_key" ON "PaymentAttempt"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_walletTxId_key" ON "PaymentAttempt"("walletTxId");

-- CreateIndex
CREATE INDEX "PaymentAttempt_userId_createdAt_idx" ON "PaymentAttempt"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_provider_providerReference_key" ON "PaymentAttempt"("provider", "providerReference");

-- CreateIndex
CREATE INDEX "PaymentMethodReference_userId_idx" ON "PaymentMethodReference"("userId");
