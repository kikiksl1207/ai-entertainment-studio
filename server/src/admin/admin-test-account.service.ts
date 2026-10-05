import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { parseTestAccountCommand } from './admin-test-account-policy';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type State = { classification: string; revision: number; updatedAt: Date } | null;
const stateSnapshot = (state: State) => ({
  classification: state?.classification ?? 'unclassified', revision: state?.revision ?? 0,
  source: state ? 'explicit_admin' : 'unclassified', updatedAt: state?.updatedAt ?? null,
});
const historySelect = { id: true, revision: true, classification: true, reasonCode: true, createdAt: true } as const;

@Injectable()
export class AdminTestAccountService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private targetId(value: unknown) {
    if (typeof value !== 'string' || !UUID.test(value)) throw new BadRequestException('A user UUID is required');
    return value.toLowerCase();
  }

  private assertActor(user: AuthUser) {
    if (!user || !UUID.test(user.id) || !user.adminPermissions?.includes('*')) {
      throw new ForbiddenException('Existing full admin permission is required');
    }
  }

  private async authorize(tx: Prisma.TransactionClient, user: AuthUser, targetId: string, write: boolean) {
    this.assertActor(user);
    // Stable lock ordering protects both the actor and target without changing account permissions.
    const ids = [...new Set([user.id.toLowerCase(), targetId])].sort();
    const lock = write ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`;
    await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id ${lock}`);
    const actor = await tx.user.findUnique({ where: { id: user.id }, select: { status: true, deletedAt: true, email: true } });
    if (!actor || actor.status !== 'active' || actor.deletedAt) throw new ForbiddenException('Admin account is not active');
    const grants = await tx.$queryRaw<{ status: string; permissions: string[] }[]>(Prisma.sql`
      SELECT a.status, r.permissions FROM admin_users a JOIN admin_roles r ON r.id = a.role_id
      WHERE a.user_id = ${user.id}::uuid FOR SHARE OF a, r
    `);
    const bootstrapEmails = new Set((this.config.get<string>('ADMIN_EMAILS') ?? '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean));
    const activeGrants = grants.filter(grant => grant.status === 'active');
    const existingGrant = activeGrants.some(grant => grant.permissions.includes('*'));
    const existingBootstrap = actor.email && bootstrapEmails.has(actor.email.toLowerCase());
    // An active stored role takes precedence over the existing bootstrap fallback, as in AdminAuthGuard.
    if (activeGrants.length ? !existingGrant : !existingBootstrap) throw new ForbiddenException('Current admin permission is required');
    const target = await tx.user.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!target) throw new NotFoundException('Account was not found');
  }

  private rethrow(error: unknown): never {
    if (error instanceof BadRequestException || error instanceof ConflictException ||
        error instanceof ForbiddenException || error instanceof NotFoundException) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
      throw new ConflictException('Classification changed; read the current state before a new command');
    }
    throw new ServiceUnavailableException('Test account classification is temporarily unavailable');
  }

  async get(user: AuthUser, rawUserId: unknown) {
    this.assertActor(user);
    const userId = this.targetId(rawUserId);
    try {
      return await this.prisma.$transaction(async tx => {
        await this.authorize(tx, user, userId, false);
        const [state, history] = await Promise.all([
          tx.adminTestAccountState.findUnique({ where: { userId } }),
          tx.adminTestAccountChange.findMany({ where: { userId }, orderBy: { revision: 'desc' }, take: 20, select: historySelect }),
        ]);
        return { contract: 'admin-test-account-classification-v1', userId, readOnly: true,
          state: stateSnapshot(state), history,
          policy: { realCustomerInference: false, permissionChanges: false } };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10_000 });
    } catch (error) { this.rethrow(error); }
  }

  async set(user: AuthUser, rawUserId: unknown, key: unknown, body: unknown) {
    this.assertActor(user);
    const command = parseTestAccountCommand(rawUserId, key, body);
    const requestKeyHash = createHash('sha256').update(command.idempotencyKey).digest('hex');
    try {
      return await this.prisma.$transaction(async tx => {
        await this.authorize(tx, user, command.userId, true);
        const previous = await tx.adminTestAccountChange.findUnique({
          where: { actorUserId_requestKeyHash: { actorUserId: user.id, requestKeyHash } },
        });
        const current = await tx.adminTestAccountState.findUnique({ where: { userId: command.userId } });
        if (previous) {
          if (previous.requestFingerprint !== command.fingerprint || previous.userId !== command.userId) {
            throw new ConflictException('The command key is already bound to a different declaration');
          }
          return { contract: 'admin-test-account-classification-command-v1', userId: command.userId,
            idempotentReplay: true, receipt: { classification: previous.classification, revision: previous.revision, reasonCode: previous.reasonCode },
            current: stateSnapshot(current), permissionChanges: false };
        }
        const revision = current?.revision ?? 0;
        if (revision !== command.expectedRevision) throw new ConflictException('Classification changed; read the current state before a new command');
        const change = await tx.adminTestAccountChange.create({ data: {
          userId: command.userId, actorUserId: user.id, classification: command.classification,
          expectedRevision: revision, revision: revision + 1, reasonCode: command.reasonCode,
          requestKeyHash, requestFingerprint: command.fingerprint,
        } });
        const stateData = { classification: command.classification, revision: change.revision, latestChangeId: change.id, updatedAt: change.createdAt };
        const next = current
          ? await tx.adminTestAccountState.update({ where: { userId: command.userId }, data: stateData })
          : await tx.adminTestAccountState.create({ data: { userId: command.userId, ...stateData } });
        await tx.auditEvent.create({ data: {
          actorUserId: user.id, actorType: 'admin', action: 'user.test_account_classification', targetType: 'user', targetId: command.userId,
          beforeData: { classification: current?.classification ?? 'unclassified', revision },
          afterData: { classification: next.classification, revision: next.revision },
          metadata: { changeId: change.id, reasonCode: change.reasonCode, permissionChanges: false, realCustomerInference: false },
        } });
        return { contract: 'admin-test-account-classification-command-v1', userId: command.userId,
          idempotentReplay: false, receipt: { classification: next.classification, revision: next.revision, reasonCode: change.reasonCode },
          current: stateSnapshot(next), permissionChanges: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10_000 });
    } catch (error) { this.rethrow(error); }
  }
}
