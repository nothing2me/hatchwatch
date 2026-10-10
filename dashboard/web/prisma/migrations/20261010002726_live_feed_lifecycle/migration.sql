-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AlertStatus" ADD VALUE 'HATCHED';
ALTER TYPE "AlertStatus" ADD VALUE 'LOST';
ALTER TYPE "AlertStatus" ADD VALUE 'ARCHIVED';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'VOLUNTEER';

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "detectedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "disabledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "liveChunkId" TEXT;

-- AlterTable
ALTER TABLE "Zone" ADD COLUMN     "createdById" TEXT;

-- CreateTable
CREATE TABLE "SiteEvent" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "userId" TEXT,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveChunk" (
    "id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "zoneId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mediaPruned" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LiveChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SiteEvent_alertId_at_idx" ON "SiteEvent"("alertId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "LiveChunk_sequence_key" ON "LiveChunk"("sequence");

-- CreateIndex
CREATE INDEX "Alert_status_idx" ON "Alert"("status");

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_liveChunkId_fkey" FOREIGN KEY ("liveChunkId") REFERENCES "LiveChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteEvent" ADD CONSTRAINT "SiteEvent_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteEvent" ADD CONSTRAINT "SiteEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveChunk" ADD CONSTRAINT "LiveChunk_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
