-- A2 was seeded offline even though the synthetic feed publishes its second view.
UPDATE "Camera" SET "status" = 'ONLINE' WHERE "code" = 'A2' AND "status" = 'OFFLINE';
