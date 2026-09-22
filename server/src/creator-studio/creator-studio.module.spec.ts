import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { CreatorStudioModule } from './creator-studio.module';

describe('CreatorStudioModule', () => {
  it('resolves the optional artist identity analysis transport at runtime', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }), PrismaModule, CreatorStudioModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
