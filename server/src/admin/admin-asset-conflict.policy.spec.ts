import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { rethrowAdminAssetConflict } from './admin-asset-conflict.policy';

const CANARY = 'QA_PRIVATE_ASSET_KEY_SIGNED_URL_20261007';
const target = () => ['storage_provider', 'storage_key'];
const meta = () => ({ modelName: 'Asset', target: target() });
const known = (data: unknown, code = 'P2002') => new Prisma.PrismaClientKnownRequestError(CANARY, {
  code, clientVersion: 'qa-existing-sdk', meta: data as Record<string, unknown>,
});

function rejected(error: unknown): unknown {
  try { rethrowAdminAssetConflict(error); } catch (result) { return result; }
  throw new Error('Expected rejection');
}

describe('narrow Admin asset storage conflict policy', () => {
  it.each([
    ['mapped pair', meta()],
    ['reversed mapped pair', { modelName: 'Asset', target: target().reverse() }],
    ['frozen SDK metadata', Object.freeze({ modelName: 'Asset', target: Object.freeze(target()) })],
  ])('maps genuine SDK P2002 %s to a constant redacted HTTP409', (_name, data) => {
    const original = known(data), result = rejected(original) as ConflictException;
    expect(result).toBeInstanceOf(ConflictException);
    expect(result).not.toBe(original);
    expect(result.getStatus()).toBe(409);
    expect(result.getResponse()).toEqual({ code: 'ADMIN_ASSET_STORAGE_CONFLICT' });
    expect(JSON.stringify(result.getResponse())).not.toContain(CANARY);
    expect(JSON.stringify(result.getResponse())).not.toContain('storage_key');
    expect(original.meta).toBe(data);
    expect(original.code).toBe('P2002');
  });

  it.each([
    ['unscoped legacy target', { target: target() }],
    ['audit model', { modelName: 'AuditEvent', target: target() }],
    ['asset primary key', { modelName: 'Asset', target: ['id'] }],
    ['extra target', { modelName: 'Asset', target: [...target(), 'id'] }],
    ['duplicate target', { modelName: 'Asset', target: ['storage_key', 'storage_key'] }],
    ['camelcase instead of mapped columns', { modelName: 'Asset', target: ['storageProvider', 'storageKey'] }],
    ['constraint-name string', { modelName: 'Asset', target: 'assets_storage_provider_storage_key_key' }],
    ['symbol target', { modelName: 'Asset', target: Symbol(CANARY) }],
    ['symbol target entry', { modelName: 'Asset', target: ['storage_provider', Symbol(CANARY)] }],
    ['symbol model', { modelName: Symbol(CANARY), target: target() }],
    ['prototype-name model', { modelName: '__proto__', target: target() }],
    ['null metadata', null], ['undefined metadata', undefined],
    ['metadata array', [meta()]], ['inherited metadata', Object.create(meta())],
    ['null-prototype metadata', Object.assign(Object.create(null), meta())],
    ['inherited target entry', Object.setPrototypeOf(['storage_provider'], { 1: 'storage_key' })],
    ['sparse target', new Array(2)],
  ])('preserves genuine P2002 with %s metadata by identity', (_name, data) => {
    const error = known(data);
    expect(rejected(error)).toBe(error);
  });

  it.each(['P2003', 'P2025', 'P2034', '23505', 'p2002'])('preserves other SDK code %s', code => {
    const error = known(meta(), code);
    expect(rejected(error)).toBe(error);
  });

  it('rejects name/code-shaped and prototype-only impostors, including native ordinary errors', () => {
    const shape = { name: 'PrismaClientKnownRequestError', code: 'P2002', meta: meta() };
    const prototypeOnly = Object.assign(Object.create(Prisma.PrismaClientKnownRequestError.prototype), shape);
    const nativeShape = Object.assign(new Error(CANARY), shape);
    const unknown = new Prisma.PrismaClientUnknownRequestError(CANARY, { clientVersion: 'qa-existing-sdk' });
    const subclass = new (class extends Prisma.PrismaClientKnownRequestError {})(CANARY, {
      code: 'P2002', clientVersion: 'qa-existing-sdk', meta: meta(),
    });
    for (const error of [shape, prototypeOnly, nativeShape, unknown, subclass, null, undefined, 0,
      false, '', CANARY + ' P2002 storage_provider storage_key', Symbol(CANARY)]) {
      expect(rejected(error)).toBe(error);
    }
  });

  it('never reads arbitrary error messages, accessors or inherited classification fields', () => {
    const poison = jest.fn(() => { throw new Error('CLASSIFICATION_GETTER_MUST_NOT_RUN'); });
    const values = [known(meta()), known(meta()), known(meta()), known(meta()), known(meta())];
    Object.defineProperty(values[0], 'code', { get: poison });
    Object.defineProperty(values[1], 'meta', { get: poison });
    values[2].meta = Object.defineProperty({}, 'modelName', { get: poison });
    values[3].meta = Object.defineProperty({ modelName: 'Asset' }, 'target', { get: poison });
    values[4].meta = { modelName: 'Asset', target: Object.defineProperty(target(), '0', { get: poison }) };
    for (const value of values) expect(rejected(value)).toBe(value);
    const error = known(meta());
    Object.defineProperty(error, 'message', { get: poison });
    expect((rejected(error) as ConflictException).getStatus()).toBe(409);
    expect(poison).not.toHaveBeenCalled();
  });

  it('rejects proxied and revoked values without invoking traps or replacing the original rejection', () => {
    const trap = jest.fn(() => { throw new Error('PROXY_TRAP_MUST_NOT_RUN'); });
    const proxy = (value: object) => new Proxy(value, { get: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const errors: unknown[] = [proxy(known(meta())), revoked.proxy, known(proxy(meta())),
      known({ modelName: 'Asset', target: proxy(target()) }),
      known({ modelName: 'Asset', target: revoked.proxy })];
    for (const error of errors) expect(rejected(error)).toBe(error);
    expect(trap).not.toHaveBeenCalled();
  });
});
