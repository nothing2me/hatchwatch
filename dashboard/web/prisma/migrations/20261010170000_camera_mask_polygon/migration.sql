-- Per-camera watch area (normalised); null = whole picture.
ALTER TABLE "Camera" ADD COLUMN "maskPolygon" JSONB;
ALTER TABLE "Camera" ADD COLUMN "maskUpdatedAt" TIMESTAMP(3);
