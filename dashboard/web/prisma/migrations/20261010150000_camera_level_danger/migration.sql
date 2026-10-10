-- Camera-level DANGER alerts (live detection) have no video.
ALTER TABLE "Alert" ALTER COLUMN "videoId" DROP NOT NULL;

-- Only a camera-level danger (DANGER, no nest site) may lack a video.
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_video_unless_camera_danger" CHECK ("videoId" IS NOT NULL OR ("kind" = 'DANGER' AND "siteId" IS NULL));
