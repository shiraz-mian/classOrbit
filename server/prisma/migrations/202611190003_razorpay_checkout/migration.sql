CREATE TABLE "CheckoutOrder" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "courseId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL, "currency" TEXT NOT NULL DEFAULT 'inr',
  "status" TEXT NOT NULL DEFAULT 'CREATING', "providerOrderId" TEXT, "keyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CheckoutOrder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CheckoutOrder_providerOrderId_key" ON "CheckoutOrder"("providerOrderId");
CREATE INDEX "CheckoutOrder_userId_courseId_createdAt_idx" ON "CheckoutOrder"("userId", "courseId", "createdAt");
ALTER TABLE "CheckoutOrder" ADD CONSTRAINT "CheckoutOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CheckoutOrder" ADD CONSTRAINT "CheckoutOrder_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ALTER COLUMN "currency" SET DEFAULT 'inr';
ALTER TABLE "Payment" ADD COLUMN "checkoutId" TEXT;
CREATE UNIQUE INDEX "Payment_checkoutId_key" ON "Payment"("checkoutId");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "CheckoutOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
