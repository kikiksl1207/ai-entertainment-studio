import { BACKSTAGE_FAN_MISSION_MANAGEMENT_READINESS_CONTRACT } from './backstage-fan-mission-management-readiness-contract';

describe('backstage fan mission management readiness contract', () => {
  it('unblocks admin QA routes with wildcard admin authority', () => {
    expect(BACKSTAGE_FAN_MISSION_MANAGEMENT_READINESS_CONTRACT).toMatchObject({
      feature: 'fan_mission_management_backend',
      status: 'backend_unblocked_for_admin_qa',
      serverAuthority: {
        adminPrincipal: 'AdminAuthGuard + AdminPermissionGuard',
        roleRequired: 'super_admin_or_wildcard_admin_permission',
        rewardPolicy: 'non_cash_fan_engagement_points_only',
      },
    });
    expect(BACKSTAGE_FAN_MISSION_MANAGEMENT_READINESS_CONTRACT.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'GET',
          path: '/admin/api/v1/backstage/fan-engagement/missions',
          permission: '*',
          mutation: false,
        }),
        expect.objectContaining({
          method: 'POST',
          path: '/admin/api/v1/backstage/fan-engagement/missions',
          permission: '*',
          mutation: true,
        }),
        expect.objectContaining({
          method: 'POST',
          path: '/admin/api/v1/backstage/fan-engagement/missions/:missionId/archive',
          permission: '*',
          mutation: true,
        }),
      ]),
    );
  });

  it('keeps fan mission management separate from wallet and credential mutations', () => {
    expect(
      BACKSTAGE_FAN_MISSION_MANAGEMENT_READINESS_CONTRACT.auditEvents,
    ).toEqual(['fan_mission.create', 'fan_mission.archive']);
    expect(
      Object.values(
        BACKSTAGE_FAN_MISSION_MANAGEMENT_READINESS_CONTRACT.nonMutationGuarantees,
      ),
    ).not.toContain(true);
    expect(
      BACKSTAGE_FAN_MISSION_MANAGEMENT_READINESS_CONTRACT.responsePolicy,
    ).toMatchObject({
      stableCodeMessageKeyOnValidationError: true,
      returnsRawEmail: false,
      returnsToken: false,
      returnsCookie: false,
      returnsDatabaseUrl: false,
    });
  });
});
