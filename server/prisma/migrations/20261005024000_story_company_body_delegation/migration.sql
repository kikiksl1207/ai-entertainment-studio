ALTER TABLE story_author_body_reviews
  ADD COLUMN approval_basis varchar(24) NOT NULL DEFAULT 'human_review',
  ADD COLUMN delegation_snapshot jsonb,
  DROP CONSTRAINT chk_story_body_review_attestation;

ALTER TABLE story_author_body_reviews ADD CONSTRAINT chk_story_body_review_attestation CHECK (
  (approval_basis = 'human_review' AND delegation_snapshot IS NULL AND
    (style_reviewed OR characters_reviewed OR timeline_reviewed) AND
    (decision <> 'approve' OR (style_reviewed AND characters_reviewed AND timeline_reviewed)))
  OR
  (approval_basis = 'company_delegation' AND decision = 'approve' AND
    NOT style_reviewed AND NOT characters_reviewed AND NOT timeline_reviewed AND
    delegation_snapshot IS NOT NULL AND jsonb_typeof(delegation_snapshot) = 'object' AND
    delegation_snapshot->>'contract' IS NOT DISTINCT FROM 'story-company-body-delegation-v1')
);
