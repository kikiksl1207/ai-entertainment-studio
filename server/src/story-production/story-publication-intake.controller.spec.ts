import { ADMIN_PERMISSIONS_KEY } from '../auth/decorators/admin-permissions.decorator';
import { PromoteStoryUploadDto } from './dto/story-publication-intake.dto';
import { StoryPublicationIntakeController } from './story-publication-intake.controller';

describe('StoryPublicationIntakeController', () => {
  it('keeps the queue and public promotion behind wildcard Backstage access', () => {
    expect(
      Reflect.getMetadata(
        ADMIN_PERMISSIONS_KEY,
        StoryPublicationIntakeController.prototype.submissions,
      ),
    ).toEqual(['*']);
    expect(
      Reflect.getMetadata(
        ADMIN_PERMISSIONS_KEY,
        StoryPublicationIntakeController.prototype.intake,
      ),
    ).toEqual(['*']);
    expect(
      Reflect.getMetadata(
        ADMIN_PERMISSIONS_KEY,
        StoryPublicationIntakeController.prototype.publishApproved,
      ),
    ).toEqual(['*']);
    expect(
      Reflect.getMetadata(
        ADMIN_PERMISSIONS_KEY,
        StoryPublicationIntakeController.prototype.startApprovedUpload,
      ),
    ).toEqual(['*']);
    expect(
      Reflect.getMetadata(
        ADMIN_PERMISSIONS_KEY,
        StoryPublicationIntakeController.prototype.uploadApprovedSourceChunk,
      ),
    ).toEqual(['*']);
    expect(
      Reflect.getMetadata(
        ADMIN_PERMISSIONS_KEY,
        StoryPublicationIntakeController.prototype.prepareApprovedSourceChunks,
      ),
    ).toEqual(['*']);
    expect(
      Reflect.getMetadata(
        ADMIN_PERMISSIONS_KEY,
        StoryPublicationIntakeController.prototype.processApprovedJob,
      ),
    ).toEqual(['*']);
    expect(
      Reflect.getMetadata(
        ADMIN_PERMISSIONS_KEY,
        StoryPublicationIntakeController.prototype.promote,
      ),
    ).toEqual(['*']);
  });

  it('passes the authenticated operator and explicit confirmations to the service', async () => {
    const publication = {
      promote: jest.fn().mockResolvedValue({ work: { id: 'work' } }),
    };
    const controller = new StoryPublicationIntakeController(
      publication as never,
      {} as never,
    );
    const body: PromoteStoryUploadDto = {
      storyKey: 'imjin',
      finalManuscriptConfirmed: true,
      rightsConfirmed: true,
      publicReleaseConfirmed: true,
    };
    await expect(controller.promote({ id: 'owner' } as never, 'submission', body))
      .resolves.toEqual({ work: { id: 'work' } });
    expect(publication.promote).toHaveBeenCalledWith('owner', 'submission', body);
  });

  it('records an operator upload under the authenticated operator', async () => {
    const uploads = {
      intake: jest.fn().mockResolvedValue({ submissionId: 'submission' }),
    };
    const controller = new StoryPublicationIntakeController(
      {} as never,
      uploads as never,
    );
    const body = {
      title: '불타는 바다의 기록자',
      originalLocale: 'ko',
      sourceClass: 'public_domain',
      submissionType: 'final',
    } as never;
    const files = { manuscripts: [{ size: 12 }] } as never;

    await expect(
      controller.intake({ id: 'owner' } as never, undefined, body, files),
    ).resolves.toEqual({ submissionId: 'submission' });
    expect(uploads.intake).toHaveBeenCalledWith(
      'owner',
      body,
      files,
      undefined,
    );
  });

  it('passes exact approved files directly to publication', async () => {
    const publication = {
      publishApproved: jest.fn().mockResolvedValue({ work: { id: 'work' } }),
    };
    const controller = new StoryPublicationIntakeController(
      publication as never,
      {} as never,
    );
    const body: PromoteStoryUploadDto = {
      storyKey: 'norse',
      finalManuscriptConfirmed: true,
      rightsConfirmed: true,
      publicReleaseConfirmed: true,
    };
    const files = { manuscripts: [{ size: 12 }, { size: 24 }] } as never;

    await expect(
      controller.publishApproved({ id: 'owner' } as never, body, files),
    ).resolves.toEqual({ work: { id: 'work' } });
    expect(publication.publishApproved).toHaveBeenCalledWith(
      'owner',
      body,
      files,
    );
  });

  it('continues a staged publication job as the authenticated operator', async () => {
    const publication = {
      processApprovedJob: jest.fn().mockResolvedValue({ status: 'structuring' }),
    };
    const controller = new StoryPublicationIntakeController(
      publication as never,
      {} as never,
    );
    await expect(
      controller.processApprovedJob({ id: 'owner' } as never, 'job-id'),
    ).resolves.toEqual({ status: 'structuring' });
    expect(publication.processApprovedJob).toHaveBeenCalledWith('owner', 'job-id');
  });

  it('passes approved source chunks through the authenticated publication job', async () => {
    const publication = {
      startApprovedUpload: jest.fn().mockResolvedValue({ status: 'uploading' }),
      uploadApprovedSourceChunk: jest.fn().mockResolvedValue({ uploadedChunks: 1 }),
      prepareApprovedSourceChunks: jest.fn().mockResolvedValue({ status: 'queued' }),
    };
    const controller = new StoryPublicationIntakeController(
      publication as never,
      {} as never,
    );
    const body: PromoteStoryUploadDto = {
      storyKey: 'norse',
      finalManuscriptConfirmed: true,
      rightsConfirmed: true,
      publicReleaseConfirmed: true,
    };
    const chunk = { size: 12, buffer: Buffer.from('approved-data') } as never;

    await controller.startApprovedUpload({ id: 'owner' } as never, body);
    await controller.uploadApprovedSourceChunk(
      { id: 'owner' } as never,
      'job-id',
      '0',
      '10',
      chunk,
    );
    await controller.prepareApprovedSourceChunks(
      { id: 'owner' } as never,
      'job-id',
    );

    expect(publication.startApprovedUpload).toHaveBeenCalledWith('owner', body);
    expect(publication.uploadApprovedSourceChunk).toHaveBeenCalledWith(
      'owner',
      'job-id',
      '0',
      '10',
      chunk,
    );
    expect(publication.prepareApprovedSourceChunks).toHaveBeenCalledWith(
      'owner',
      'job-id',
    );
  });
});
