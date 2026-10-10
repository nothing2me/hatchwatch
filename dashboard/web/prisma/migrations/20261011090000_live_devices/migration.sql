-- AlterTable
ALTER TABLE "Camera" ADD COLUMN     "liveDeviceId" TEXT;

-- CreateTable
CREATE TABLE "LiveDevice" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiveDevice_ownerId_idx" ON "LiveDevice"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Camera_liveDeviceId_key" ON "Camera"("liveDeviceId");

-- AddForeignKey
ALTER TABLE "Camera" ADD CONSTRAINT "Camera_liveDeviceId_fkey" FOREIGN KEY ("liveDeviceId") REFERENCES "LiveDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveDevice" ADD CONSTRAINT "LiveDevice_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

