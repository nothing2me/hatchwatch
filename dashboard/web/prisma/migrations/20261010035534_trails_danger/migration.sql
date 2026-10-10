-- AlterEnum
ALTER TYPE "AlertKind" ADD VALUE 'DANGER';

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "level" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "alertId" TEXT,
ADD COLUMN     "colorIndex" INTEGER;

-- CreateIndex
CREATE INDEX "Alert_siteId_idx" ON "Alert"("siteId");

-- CreateIndex
CREATE INDEX "Track_videoId_idx" ON "Track"("videoId");

-- CreateIndex
CREATE INDEX "Track_alertId_idx" ON "Track"("alertId");

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
