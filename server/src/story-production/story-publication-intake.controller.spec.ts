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
        StoryPublicationIntakeController.prototype.promote,
      ),
    ).toEqual(['*']);
  });

  it('passes the authenticated operator and explicit confirmations to the service', async () => {
    const publication = {
      promote: jest.fn().mockResolvedValue({ work: { id: 'work' } }),
    };
    const controller = new StoryPublicationIntakeController(publication as never);
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
});
