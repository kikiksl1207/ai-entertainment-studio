import { Controller, Get } from '@nestjs/common';
import { AI_PREMIUM_CONTENT_STATUS_PREVIEW_FIXTURE_CONTRACT } from './ai-premium-content-state-contract';

const disabledSideEffects = Object.fromEntries(
  Object.keys(
    AI_PREMIUM_CONTENT_STATUS_PREVIEW_FIXTURE_CONTRACT.noSideEffects,
  ).map((key) => [key, false]),
) as Record<
  keyof typeof AI_PREMIUM_CONTENT_STATUS_PREVIEW_FIXTURE_CONTRACT.noSideEffects,
  false
>;

export const buildAiPremiumContentStatusPreviewFixture = () => ({
  version: AI_PREMIUM_CONTENT_STATUS_PREVIEW_FIXTURE_CONTRACT.version,
  feature: AI_PREMIUM_CONTENT_STATUS_PREVIEW_FIXTURE_CONTRACT.feature,
  status: 'read_only_fixture_ready',
  readOnly: true,
  authRequired: false,
  mutation: false,
  providerCallEnabled: false,
  endpoint: {
    ...AI_PREMIUM_CONTENT_STATUS_PREVIEW_FIXTURE_CONTRACT.endpoint,
    mounted: true,
  },
  projection: {
    ...AI_PREMIUM_CONTENT_STATUS_PREVIEW_FIXTURE_CONTRACT.responseProjection,
  },
  items: AI_PREMIUM_CONTENT_STATUS_PREVIEW_FIXTURE_CONTRACT.fixtureStates.map(
    (state) => ({
      key: state.key,
      displayStatus: state.displayStatus,
      labelKo: state.labelKo,
      labels: state.labels,
      messageKey: state.messageKey,
      regenerateCtaEnabled:
        'regenerateCtaEnabled' in state ? state.regenerateCtaEnabled : false,
      rawEnumAsCopy: false,
    }),
  ),
  sideEffects: disabledSideEffects,
  privacy: {
    rawPromptReturned: false,
    providerPayloadReturned: false,
    rawProviderStatusReturned: false,
    rawSafetyPayloadReturned: false,
    internalCostReturned: false,
    signedUrlsReturned: false,
  },
});

@Controller('ai-premium-content')
export class AiPremiumContentController {
  @Get('status-preview-fixture')
  getStatusPreviewFixture() {
    return buildAiPremiumContentStatusPreviewFixture();
  }
}
