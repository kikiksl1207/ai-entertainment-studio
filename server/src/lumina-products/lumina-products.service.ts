import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LuminaProductsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.luminaProduct.findMany({
      where: { status: 'active' },
      orderBy: [{ priceAmount: 'asc' }, { luminaAmount: 'asc' }],
    });
  }
}
