import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const ACTIVE_CHARGE_PRICE_AMOUNTS_KRW = [1000, 3000, 5000, 10000, 50000, 100000];

@Injectable()
export class LuminaProductsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.luminaProduct.findMany({
      where: {
        status: 'active',
        priceAmount: { in: ACTIVE_CHARGE_PRICE_AMOUNTS_KRW },
      },
      orderBy: [{ priceAmount: 'asc' }, { luminaAmount: 'asc' }],
    });
  }
}
