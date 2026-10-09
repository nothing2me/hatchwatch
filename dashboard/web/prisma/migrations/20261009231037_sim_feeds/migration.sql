-- CreateEnum
CREATE TYPE "VideoSource" AS ENUM ('UPLOAD', 'SIMULATION');

-- CreateEnum
CREATE TYPE "EvidenceTier" AS ENUM ('TWO_CAMERA', 'SINGLE_CAMERA');

-- DropForeignKey
ALTER TABLE "Video" DROP CONSTRAINT "Video_uploadedById_fkey";

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "evidenceTier" "EvidenceTier",
ADD COLUMN     "simulated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "pureMotionPath" TEXT,
ADD COLUMN     "simRunId" TEXT,
ADD COLUMN     "source" "VideoSource" NOT NULL DEFAULT 'UPLOAD',
ALTER COLUMN "uploadedById" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Video_cameraId_createdAt_idx" ON "Video"("cameraId", "createdAt");

-- CreateIndex
CREATE INDEX "Video_simRunId_idx" ON "Video"("simRunId");

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
