import 'reflect-metadata';
import { CanActivate, ExecutionContext, Get, Controller, HttpException, Injectable, INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { AdminContentRightsContractController, PartyContentRightsContractController } from './content-rights-contract.controller';
import { ContentContractRecord, INTERNAL_GENERATION_COST_TREATMENT } from './content-rights-contract.contract';
import { ContentRightsContractService } from './content-rights-contract.service';
import { ContentRightsContractRepository } from './content-rights-contract.repository';
import { contentRightsContractPrivacyMiddleware } from './content-rights-contract.privacy';

const ID = '00000000-0000-4000-8000-000000000841';
const OWNER = '00000000-0000-4000-8000-000000000842';
const AGENCY = '00000000-0000-4000-8000-000000000843';
const OUTSIDER = '00000000-0000-4000-8000-000000000844';
const UNKNOWN = '00000000-0000-4000-8000-000000000849';
const ORIGIN = 'https://contract-privacy-qa.example.invalid';
const roots = ['/admin/api/v1/content-rights-contracts', '/api/v1/me/creator-studio/content-rights-contracts'];
const reads = roots.flatMap(root => [root, root + '/' + ID]);
const date = new Date('2026-10-01T00:00:00Z');
const record: ContentContractRecord = {
  id: ID, workType: 'story', workId: ID, createdByUserId: OWNER, createdAt: date,
  versions: [{ id: ID, contractId: ID, revision: 1, sourceVersionId: null,
    approvalState: 'draft', createdByUserId: OWNER, approvedByUserId: null, createdAt: date,
    contentVersionId: ID, exclusivity: 'exclusive', media: ['story_publication'], regions: ['WORLDWIDE'],
    startsAt: date, endsAt: null, effectiveFrom: date, saleAllowed: false,
    aiTransformationAllowed: false, generatedResultReuseAllowed: false,
    authorRightsHolderShareBps: 3000, salesAgencyShareBps: 1000, companyShareBps: 6000,
    pointUsagePolicy: 'unresolved', refundReversalPolicy: 'unresolved', paidPointPolicy: 'unresolved',
    bonusPointPolicy: 'unresolved', vatPolicy: 'unresolved', internalGenerationCostTreatment: INTERNAL_GENERATION_COST_TREATMENT,
    parties: [{ role: 'rights_holder', userId: OWNER, agencyIdentifier: null },
      { role: 'sales_agency', userId: AGENCY, agencyIdentifier: 'synthetic-agency' }],
  }], audits: [],
};
const recordBefore = JSON.stringify(record);
const repository = {
  findById: jest.fn(async (id: string) => id === ID ? record : null),
  listAll: jest.fn(async () => [record]),
  listForParty: jest.fn(async (id: string) => [OWNER, AGENCY].includes(id) ? [record] : []),
  create: jest.fn(), revise: jest.fn(), approve: jest.fn(),
};

@Injectable()
class SyntheticAuthenticationGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (request.headers['x-qa-auth'] !== 'synthetic-allowed') throw new UnauthorizedException('Synthetic rejection');
    request.user = { id: request.headers['x-qa-party'] === 'agency' ? AGENCY : request.headers['x-qa-party'] === 'outsider' ? OUTSIDER : OWNER,
      adminPermissions: request.headers['x-qa-admin-read'] === 'yes' ? ['payments:read'] : [] };
    return true;
  }
}
@Injectable()
class SyntheticGlobalDenialGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    if (context.switchToHttp().getRequest().headers['x-qa-throttled'] === 'yes') throw new HttpException('Synthetic rejection', 429);
    return true;
  }
}
@Controller('synthetic-public')
class SyntheticPublicController { @Get() read() { return { syntheticOnly: true }; } }

// Actual controllers, permission guard, service projection, routing and filter; no real JWT, DB, contract or provider.
describe('content rights private reads through actual Nest HTTP routing', () => {
  let app: INestApplication | undefined, base: string;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminContentRightsContractController, PartyContentRightsContractController, SyntheticPublicController],
      providers: [ContentRightsContractService, { provide: ContentRightsContractRepository, useValue: repository },
        { provide: APP_GUARD, useClass: SyntheticGlobalDenialGuard }],
    }).overrideGuard(JwtAuthGuard).useClass(SyntheticAuthenticationGuard)
      .overrideGuard(AdminAuthGuard).useClass(SyntheticAuthenticationGuard).compile();
    app = module.createNestApplication({ logger: false });
    app.use((_request: unknown, response: { vary(field: string): unknown }, next: () => void) => {
      response.vary('Origin'); response.vary('Accept-Encoding'); next();
    });
    app.use(contentRightsContractPrivacyMiddleware);
    configureHttpRouting(app);
    app.useGlobalFilters(new HttpExceptionFilter());
    app.enableCors({ origin: [ORIGIN], credentials: true });
    await app.listen(0, '127.0.0.1');
    base = 'http://127.0.0.1:' + app.getHttpServer().address().port;
  });
  beforeEach(() => { for (const mock of Object.values(repository)) mock.mockClear(); });
  afterEach(() => {
    expect(JSON.stringify(record)).toBe(recordBefore);
    for (const mock of [repository.create, repository.revise, repository.approve]) expect(mock).not.toHaveBeenCalled();
  });
  afterAll(async () => { await app?.close(); });
  function readDispatches() { return repository.findById.mock.calls.length + repository.listAll.mock.calls.length + repository.listForParty.mock.calls.length; }
  async function call(method: string, path: string, headers: Record<string, string> = {}) {
    const response = await fetch(base + path, { method, headers: { Origin: ORIGIN, ...headers },
      redirect: 'error', signal: AbortSignal.timeout(5000) });
    return { response, text: await response.text() };
  }
  function privateStatus(result: Awaited<ReturnType<typeof call>>, status: number) {
    expect(result.response.status).toBe(status);
    expect(result.response.headers.get('cache-control')).toBe('private, no-store');
    const vary = (result.response.headers.get('vary') ?? '').toLowerCase().split(',').map(value => value.trim());
    expect(vary).toEqual(expect.arrayContaining(['origin', 'accept-encoding', 'authorization']));
    expect(vary.filter(value => value === 'authorization')).toHaveLength(1);
    expect(result.response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(result.response.headers.get('set-cookie')).toBeNull();
  }
  const allowed = { 'x-qa-auth': 'synthetic-allowed' };
  it('anonymous list/detail GET and HEAD401 are private before repository reads', async () => {
    for (const path of reads) for (const method of ['GET', 'HEAD']) privateStatus(await call(method, path), 401);
    expect(readDispatches()).toBe(0);
  });
  it('actual admin permission denial403 is private and does not grant a role or read records', async () => {
    for (const root of roots.slice(0, 1)) for (const suffix of ['', '/' + ID])
      for (const method of ['GET', 'HEAD']) privateStatus(await call(method, root + suffix, allowed), 403);
    expect(readDispatches()).toBe(0);
  });
  it('actual controller GET200 HEAD200 preserve admin projection and party-only projection', async () => {
    for (const path of reads) {
      const headers = { ...allowed, 'x-qa-admin-read': 'yes' };
      const get = await call('GET', path, headers); privateStatus(get, 200);
      const body = JSON.parse(get.text), item = path.endsWith(ID) ? body : body.items[0];
      if (path.startsWith('/admin/')) {
        expect(item.versions[0].shares).toEqual({ authorRightsHolderBps: 3000, salesAgencyBps: 1000, companyBps: 6000 });
      } else {
        expect(item.versions[0].parties).toEqual([{ role: 'rights_holder', userId: OWNER, agencyIdentifier: null, shareBps: 3000 }]);
        expect(get.text).not.toContain(AGENCY); expect(item.versions[0].shares).toBeUndefined();
      }
      const head = await call('HEAD', path, headers); privateStatus(head, 200); expect(head.text).toBe('');
    }
    expect(readDispatches()).toBe(8);
  });
  it('agency receives only its own share while outsider detail403 and list-empty200 stay private', async () => {
    const agency = await call('GET', roots[1] + '/' + ID, { ...allowed, 'x-qa-party': 'agency' });
    privateStatus(agency, 200);
    expect(JSON.parse(agency.text).versions[0].parties).toEqual([{ role: 'sales_agency', userId: AGENCY, agencyIdentifier: 'synthetic-agency', shareBps: 1000 }]);
    expect(agency.text).not.toContain(OWNER);
    for (const method of ['GET', 'HEAD']) privateStatus(await call(method, roots[1] + '/' + ID, { ...allowed, 'x-qa-party': 'outsider' }), 403);
    const list = await call('GET', roots[1], { ...allowed, 'x-qa-party': 'outsider' });
    privateStatus(list, 200); expect(JSON.parse(list.text)).toEqual({ items: [] });
  });
  it('invalid UUID400 and missing contract404 keep private headers without weakening validation', async () => {
    for (const root of roots) for (const method of ['GET', 'HEAD']) {
      privateStatus(await call(method, root + '/not-a-uuid', { ...allowed, 'x-qa-admin-read': 'yes' }), 400);
      privateStatus(await call(method, root + '/' + UNKNOWN, { ...allowed, 'x-qa-admin-read': 'yes' }), 404);
    }
    expect(readDispatches()).toBe(4);
  });
  it('malformed percent-encoded detail400 remains private before Express parameter decoding', async () => {
    for (const root of roots) privateStatus(await call('GET', root + '/%E0%A4%A', allowed), 400);
    expect(readDispatches()).toBe(0);
  });
  it('global throttling429 precedes authentication but not privacy headers', async () => {
    for (const path of reads) privateStatus(await call('GET', path, { 'x-qa-throttled': 'yes' }), 429);
    expect(readDispatches()).toBe(0);
  });
  it('repository failure500 stays private and does not expose its synthetic internal message', async () => {
    repository.findById.mockRejectedValueOnce(new Error('Synthetic private repository detail'));
    const result = await call('GET', roots[1] + '/' + ID, allowed);
    privateStatus(result, 500); expect(result.text).not.toContain('Synthetic private repository detail');
    expect(readDispatches()).toBe(1);
  });
  it('public response, writes, children, and CORS preflight keep their original header boundary', async () => {
    for (const [method, path, status] of [['GET', '/api/v1/synthetic-public', 200],
      ['POST', roots[0], 401], ['GET', roots[0] + '/one/two', 404]] as const) {
      const result = await call(method, path);
      expect(result.response.status).toBe(status); expect(result.response.headers.get('cache-control')).toBeNull();
      expect(result.response.headers.get('vary')?.toLowerCase()).not.toContain('authorization');
    }
    const preflight = await call('OPTIONS', roots[1], { 'Access-Control-Request-Method': 'GET' });
    expect(preflight.response.status).toBe(204); expect(preflight.response.headers.get('cache-control')).toBeNull();
    expect(preflight.response.headers.get('vary')?.toLowerCase()).not.toContain('authorization');
    expect(readDispatches()).toBe(0);
  });
});
