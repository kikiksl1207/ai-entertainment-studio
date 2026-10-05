import 'reflect-metadata';
import { Controller, ForbiddenException, Get, INestApplication, InternalServerErrorException,
  UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AdminModule } from './admin.module';
import { AdminService } from './admin.service';
import { AdminUsersReadService } from './admin-users-read.service';
import { AdminTestAccountService } from './admin-test-account.service';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';

@Controller('qa-public')
class PublicProbeController {
  @Get() get() { return { synthetic: true }; }
}

describe('registered admin routes private-cache transport (synthetic guards and services)', () => {
  let app: INestApplication, base: string, outcome = 200;
  const calls: string[] = [];
  const read = () => {
    calls.push('synthetic-read');
    if (outcome === 500) throw new InternalServerErrorException('Synthetic service failure');
    return { synthetic: true };
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AdminModule], controllers: [PublicProbeController] })
      .overrideProvider(AdminService).useValue({ getAdminMe: read, getUsers: read, getUser: read,
        getAuditEvents: read, getBackstageSummary: read })
      .overrideProvider(AdminUsersReadService).useValue({ getBackstageUsersOverview: read })
      .overrideProvider(AdminTestAccountService).useValue({ get: read, set: read })
      .overrideGuard(AdminAuthGuard).useValue({ canActivate(context: any) {
        if (outcome === 401) throw new UnauthorizedException();
        context.switchToHttp().getRequest().user = { id: 'synthetic-private-cache-user' };
        return true;
      } })
      .overrideGuard(AdminPermissionGuard).useValue({ canActivate() {
        if (outcome === 403) throw new ForbiddenException();
        return true;
      } }).compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => { calls.length = 0; });

  const legacyPaths = ['me', 'users', 'users/00000000-0000-4000-8000-000000000001',
    'audit-events', 'backstage/summary'];
  it.each(legacyPaths.flatMap(route => [200, 401, 403, 500].map(status => [route, status] as const)))
    ('legacy %s sets privacy headers for %s without bypassing the downstream result', async (route, status) => {
      outcome = status;
      const response = await fetch(`${base}/admin/api/v1/${route}`);
      expect(response.status).toBe(status);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('pragma')).toBe('no-cache');
      expect(response.headers.get('expires')).toBe('0');
      expect(response.headers.get('vary')?.split(',').map(x => x.trim().toLowerCase())).toContain('authorization');
      expect(calls.length).toBe(status === 401 || status === 403 ? 0 : 1);
    });

  it('preserves existing classification POST protection before permission denial', async () => {
    outcome = 403;
    const response = await fetch(`${base}/admin/api/v1/users/00000000-0000-4000-8000-000000000001/test-account-classification`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(calls).toEqual([]);
  });

  it('does not apply admin privacy middleware to unrelated public content', async () => {
    outcome = 200;
    const response = await fetch(`${base}/qa-public`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBeNull();
    expect(response.headers.get('pragma')).toBeNull();
    expect(calls).toEqual([]);
  });
});
