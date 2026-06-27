import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import {
  AiPremiumContentController,
  buildAiPremiumContentStatusPreviewFixture,
} from './ai-premium-content.controller';
import { AI_PREMIUM_CONTENT_STATUS_PREVIEW_FIXTURE_CONTRACT } from './ai-premium-content-state-contract';

describe('AiPremiumContentController', () => {
  it('mounts the public status preview fixture as a read-only GET route', () => {
    const handler = AiPremiumContentController.prototype.getStatusPreviewFixture;

    expect(Reflect.getMetadata(PATH_METADATA, AiPremiumContentController)).toBe(
      'ai-premium-content',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      'status-preview-fixture',
    );
  });

  it('returns a no-provider status preview fixture without mutation fields', () => {
    const controller = new AiPremiumContentController();
    const response = controller.getStatusPreviewFixture();

    expect(response).toMatchObject({
      version: AI_PREMIUM_CONTENT_STATUS_PREVIEW_FIXTURE_CONTRACT.version,
      feature: 'ai_premium_content_status_preview_fixture',
      status: 'read_only_fixture_ready',
      readOnly: true,
      authRequired: false,
      mutation: false,
      providerCallEnabled: false,
      endpoint: {
        method: 'GET',
        path: '/api/v1/ai-premium-content/status-preview-fixture',
        mounted: true,
        authRequired: false,
        mutation: false,
      },
      projection: {
        previewOnly: true,
        locale: 'ko-KR',
        rawEnumAsCopy: false,
        providerPayloadReturned: false,
        signedUrlsReturned: false,
        rawPromptReturned: false,
      },
      privacy: {
        rawPromptReturned: false,
        providerPayloadReturned: false,
        rawProviderStatusReturned: false,
        rawSafetyPayloadReturned: false,
        internalCostReturned: false,
        signedUrlsReturned: false,
      },
    });
    expect(response.items.map((item) => item.labelKo)).toEqual([
      '검수 중',
      '제작 중',
      '완료',
      '차단',
      '실패',
      '재생성 가능',
    ]);
    expect(response.items.every((item) => item.rawEnumAsCopy === false)).toBe(
      true,
    );
    expect(Object.values(response.sideEffects).every((enabled) => !enabled)).toBe(
      true,
    );
  });

  it('builds the same response shape used by the controller', () => {
    expect(new AiPremiumContentController().getStatusPreviewFixture()).toEqual(
      buildAiPremiumContentStatusPreviewFixture(),
    );
  });
});
