import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';

const publicPath = '/api/v1/story-upload/intake';
const manuscriptPath = process.env.NORSE_APPROVED_MANUSCRIPT_PATH?.trim();
const metadataPath = process.env.NORSE_CONVERSION_METADATA_PATH?.trim();
const checks = {
  approvedSourceConfigured: Boolean(manuscriptPath),
  approvedSourceReadable: false,
  conversionMetadataConfigured: Boolean(metadataPath),
  conversionMetadataReadable: false,
  targetIdentityNorse: false,
  approvalRecorded: false,
  rightsStatusDeclared: false,
  rightsCleared: false,
  paidPricing: false,
  fixedChoiceSlots123: false,
  customChoiceDeclared: false,
  paidCapabilityDeclared: false,
  customChoiceCapabilityConsistent: false,
  stagingOriginConfigured: configured('STORY_UPLOAD_STAGING_API_ORIGIN'),
  privateSessionConfigured: configured('STORY_UPLOAD_STAGING_ACCESS_TOKEN'),
  persistenceInspectionConfigured: configured('DATABASE_URL'),
};

if (manuscriptPath) {
  try {
    const source = await stat(manuscriptPath);
    checks.approvedSourceReadable =
      source.isFile() &&
      source.size > 0 &&
      ['.md', '.txt', '.docx', '.pdf', '.json'].includes(
        extname(manuscriptPath).toLowerCase(),
      );
  } catch {
    checks.approvedSourceReadable = false;
  }
}

if (metadataPath) {
  try {
    const metadata = record(
      JSON.parse(await readFile(metadataPath, 'utf8')),
    ) ?? {};
    const release = record(metadata.release) ?? metadata;
    const graph = record(release.branchGraphSnapshot) ?? release;
    const rights = record(release.rights) ?? record(metadata.rights) ?? {};
    const pricing = record(release.pricing) ?? release;
    const capability =
      record(release.capabilityProjection) ??
      record(release.storyCapability) ??
      record(release.capabilities) ??
      {};
    const choiceRoutes = Array.isArray(graph.choiceRoutes)
      ? graph.choiceRoutes
      : [];
    const slots = new Set(
      choiceRoutes
        .map((route) => Number(record(route)?.displaySlot))
        .filter((slot) => Number.isInteger(slot)),
    );
    const targetKeys = [
      release.storyKey,
      release.workKey,
      release.targetKey,
      release.slug,
      metadata.storyKey,
      metadata.workKey,
      metadata.targetKey,
      metadata.slug,
    ]
      .filter((value) => typeof value === 'string')
      .map(normalizeKey);
    const rightsStatus = String(
      rights.status ?? release.rightsStatus ?? '',
    ).toLowerCase();
    const pricingMode = String(
      pricing.mode ?? release.pricingMode ?? '',
    ).toLowerCase();
    const priceLumina = Number(
      pricing.priceLumina ?? release.priceLumina,
    );
    const customChoice = firstBoolean([
      release.customChoiceAllowed,
      release.customChoiceEnabled,
    ]);
    const capabilityCustomChoice = firstBoolean([
      capability.customChoiceAllowed,
      capability.customChoiceEnabled,
      record(capability.customChoice)?.enabled,
    ]);
    const capabilityTier = String(
      capability.tier ?? capability.accessTier ?? capability.mode ?? '',
    ).toLowerCase();

    checks.conversionMetadataReadable = true;
    checks.targetIdentityNorse = targetKeys.some((key) =>
      ['norse_myth', 'norse_mythology'].includes(key),
    );
    checks.approvalRecorded =
      release.approved === true ||
      record(release.approval)?.status === 'approved';
    checks.rightsStatusDeclared = Boolean(rightsStatus);
    checks.rightsCleared = ['approved', 'cleared'].includes(rightsStatus);
    checks.paidPricing =
      ['paid', 'premium'].includes(pricingMode) &&
      Number.isFinite(priceLumina) &&
      priceLumina > 0;
    checks.fixedChoiceSlots123 =
      choiceRoutes.length > 0 &&
      [...slots].every((slot) => [1, 2, 3].includes(slot)) &&
      [1, 2, 3].every((slot) => slots.has(slot));
    checks.customChoiceDeclared = customChoice !== null;
    checks.paidCapabilityDeclared = ['paid', 'premium'].includes(
      capabilityTier,
    );
    checks.customChoiceCapabilityConsistent =
      customChoice !== null &&
      capabilityCustomChoice !== null &&
      customChoice === capabilityCustomChoice;
  } catch {
    checks.conversionMetadataReadable = false;
  }
}

const ready = Object.values(checks).every(Boolean);
console.log(
  JSON.stringify({
    runId: randomUUID(),
    publicPath,
    status: ready
      ? 'ready_for_controlled_upload'
      : 'blocked_source_rights_capability_or_private_session',
    checks,
    mutationExecuted: false,
  }),
);

function configured(name) {
  return Boolean(process.env[name]?.trim());
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null;
}

function firstBoolean(values) {
  return values.find((value) => typeof value === 'boolean') ?? null;
}

function normalizeKey(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
