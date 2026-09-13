import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { IncomingMessage } from 'http';
import { PrismaService } from '../prisma/prisma.service';
import { fail, uuid } from './ott-media.contract';
import { BrowserGrant, OttMediaDelivery } from './ott-media.delivery';

export type BrowserRequest = IncomingMessage & { params: { fileId: string }; ottGrant: BrowserGrant };

@Injectable()
export class OttMediaBrowserGuard implements CanActivate {
  constructor(private readonly delivery: OttMediaDelivery, private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<BrowserRequest>();
    this.delivery.assertBrowserOrigin(req.headers.origin, false, req.headers['sec-fetch-site']);
    const grant = this.delivery.readBrowserSession(req.headers.cookie, uuid(req.params.fileId));
    const owner = await this.prisma.user.findFirst({ where: { id: uuid(grant.ownerId), status: 'active', deletedAt: null }, select: { id: true } })
      .catch(() => fail('PERSISTENCE_UNAVAILABLE'));
    if (!owner) fail('TOKEN_INVALID');
    req.ottGrant = grant;
    return true;
  }
}
