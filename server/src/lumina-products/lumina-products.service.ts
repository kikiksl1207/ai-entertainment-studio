import { Injectable } from '@nestjs/common';
import { activeChargeProductWhere } from '../payments/charge-products.policy';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LuminaProductsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.luminaProduct.findMany({
      where: activeChargeProductWhere(),
      orderBy: [{ priceAmount: 'asc' }, { luminaAmount: 'asc' }],
    });
  }
}
