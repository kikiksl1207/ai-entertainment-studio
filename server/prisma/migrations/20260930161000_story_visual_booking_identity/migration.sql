ALTER TABLE story_visual_generations ADD COLUMN booking_identity jsonb;

ALTER TABLE story_visual_generations ADD CONSTRAINT chk_story_visual_booking_identity CHECK (
  booking_identity IS NULL OR (
    jsonb_typeof(booking_identity) = 'object'
    AND booking_identity->>'contract' IS NOT DISTINCT FROM 'story-visual-booking-v1'
    AND (booking_identity->>'identitySha256') IS NOT NULL
    AND (booking_identity->>'identitySha256') ~ '^[a-f0-9]{64}$'
    AND octet_length(booking_identity::text) <= 8192
  )
);
