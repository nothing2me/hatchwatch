-- CreateEnum
CREATE TYPE "DeviceKind" AS ENUM ('PHONE', 'BOARD');

-- AlterTable
ALTER TABLE "LiveDevice" ADD COLUMN     "kind" "DeviceKind" NOT NULL DEFAULT 'PHONE',
ADD COLUMN     "tokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LiveDevice_tokenHash_key" ON "LiveDevice"("tokenHash");


-- Every board has a token hash and no phone has one.
ALTER TABLE "LiveDevice" ADD CONSTRAINT "LiveDevice_token_matches_kind" CHECK (("kind" = 'BOARD') = ("tokenHash" IS NOT NULL));
