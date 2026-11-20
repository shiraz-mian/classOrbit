-- New self-registered instructors require explicit teaching access.
ALTER TABLE "User" ADD COLUMN "instructorApproved" BOOLEAN NOT NULL DEFAULT false;

-- Existing instructors were assigned their role by an administrator. Preserve that access.
UPDATE "User" SET "instructorApproved" = true WHERE "role" = 'INSTRUCTOR';
