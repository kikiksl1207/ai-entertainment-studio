import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';

const publicPath = '/api/v1/story-upload/intake';
const manuscriptPath = process.env.IMJIN_APPROVED_MANUSCRIPT_PATH?.trim();
const metadataPath = process.env.IMJIN_CONVERSION_METADATA_PATH?.trim();
const checks = {
  approvedSourceConfigured: Boolean(manuscriptPath),
  approvedSourceReadable: false,
  conversionMetadataConfigured: Boolean(metadataPath),
  conversionMetadataReadable: false,
  approvalRecorded: false,
  freePricing: false,
  fixedChoiceSlots123: false,
  customChoiceDisabled: false,
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
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    const release = record(metadata.release) ?? record(metadata) ?? {};
    const graph = record(release.branchGraphSnapshot) ?? release;
    const choiceRoutes = Array.isArray(graph.choiceRoutes)
      ? graph.choiceRoutes
      : [];
    const slots = new Set(
      choiceRoutes
        .map((route) => Number(record(route)?.displaySlot))
        .filter((slot) => Number.isInteger(slot)),
    );
    checks.conversionMetadataReadable = true;
    checks.approvalRecorded =
      release.approved === true ||
      record(release.approval)?.status === 'approved';
    checks.freePricing =
      release.pricingMode === 'free' || Number(release.priceLumina) === 0;
    checks.fixedChoiceSlots123 =
      choiceRoutes.length > 0 &&
      [...slots].every((slot) => [1, 2, 3].includes(slot)) &&
      [1, 2, 3].every((slot) => slots.has(slot));
    checks.customChoiceDisabled =
      release.customChoiceAllowed === false ||
      release.customChoiceEnabled === false;
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
      : 'blocked_source_or_private_session',
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
