import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const publicArtistInclude = {
  publicProfile: true,
  visualProfile: true,
  artistAssets: {
    where: {
      asset: {
        visibility: 'public' as const,
      },
    },
    include: {
      asset: true,
    },
    orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }],
  },
};

@Injectable()
export class ArtistsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.artist.findMany({
      where: { status: 'active' },
      include: publicArtistInclude,
      orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
    });
  }

  findBySlug(slug: string) {
    return this.prisma.artist.findFirst({
      where: {
        slug,
        status: 'active',
      },
      include: {
        ...publicArtistInclude,
        contentProfile: true,
      },
    });
  }
}
