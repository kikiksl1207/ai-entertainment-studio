-- Remove user-facing MVP launch copy from the active seed campaign.
UPDATE boost_campaigns
SET
  name = '루미나 메인픽',
  description = '첫 공개 6캐릭터 부스트 캠페인',
  updated_at = NOW()
WHERE slug = 'mvp-launch-main-pick'
  AND (
    name = 'MVP 런칭 메인픽'
    OR name ILIKE '%MVP%'
    OR description ILIKE '%MVP%'
  );
