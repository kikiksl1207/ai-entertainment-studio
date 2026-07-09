export const BACKSTAGE_FAN_MISSION_MANAGEMENT_READINESS_CONTRACT = {
  version: '2026-07-08.backstage-fan-mission-management-readiness.v1',
  feature: 'fan_mission_management_backend',
  status: 'backend_unblocked_for_admin_qa',
  routes: [
    {
      method: 'GET',
      path: '/admin/api/v1/backstage/fan-engagement/missions',
      permission: '*',
      mutation: false,
    },
    {
      method: 'POST',
      path: '/admin/api/v1/backstage/fan-engagement/missions',
      permission: '*',
      mutation: true,
      idempotency: 'slug unique guard with stable duplicate error',
    },
    {
      method: 'POST',
      path: '/admin/api/v1/backstage/fan-engagement/missions/:missionId/archive',
      permission: '*',
      mutation: true,
      idempotency: 'archived mission remains archived',
    },
  ],
  serverAuthority: {
    adminPrincipal: 'AdminAuthGuard + AdminPermissionGuard',
    roleRequired: 'super_admin_or_wildcard_admin_permission',
    artistIdSource: 'server validated artist row',
    rewardPolicy: 'non_cash_fan_engagement_points_only',
    publicReadiness: 'server computed from status surface and active window',
  },
  auditEvents: [
    'fan_mission.create',
    'fan_mission.archive',
  ],
  nonMutationGuarantees: {
    walletLedgerMutation: false,
    paymentMutation: false,
    settlementMutation: false,
    payoutMutation: false,
    realUserCredentialMutation: false,
  },
  responsePolicy: {
    stableCodeMessageKeyOnValidationError: true,
    returnsRawEmail: false,
    returnsToken: false,
    returnsCookie: false,
    returnsDatabaseUrl: false,
  },
} as const;
