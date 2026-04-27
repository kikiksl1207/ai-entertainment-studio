import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ShortformsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.shortform.findMany({
      where: { status: 'published' },
      include: {
        artist: {
          select: {
            id: true,
            slug: true,
            displayName: true,
          },
        },
        assets: {
          where: {
            asset: {
              visibility: 'public',
            },
          },
          include: {
            asset: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }
}
