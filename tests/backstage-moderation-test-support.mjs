import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const source = readFileSync(new URL('../backstage.js', import.meta.url), 'utf8');
export function segment(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing source segment: ${start}`);
  return source.slice(from, to);
}

export const runtime = [
  segment('const BACKSTAGE_API_BASE =', 'const loginView ='),
  segment('const statusClassMap =', 'const backstageRows ='),
  segment('const tableMeta =', 'const sectionLoaders ='),
  segment('function getBackstageAuth()', 'function getSavedSection()'),
  segment('async function backstageFetch(', 'window.LuminaBackstageApi ='),
  segment('function normalizeAuthPayload(', 'function applyAdminContext('),
  segment('function publicApiPath(', 'async function verifyAdminAccess('),
  segment('function statusBadge(', 'function renderSettlementChildren('),
  segment('function localizeReportStatus(', 'function creatorImageCostLabel('),
  segment('function localizeFeedSearchType(', 'function localizePayoutCheck('),
  segment('function renderLoadingRow(', 'function renderFallbackNote('),
  segment('function backstageErrorStatus(', 'function artistKnowledgeQueueErrorMessage('),
  segment('function formatHistoryTime(', 'function renderDetailHistory('),
  segment('function firstValue(', 'function splitTargetUsers('),
  segment('function escapeHtml(', 'function firstRoleName('),
  segment('function currentAdminRoleName()', 'function syncCurrentAdminContext('),
  segment('function canAccessBackstageSection(', 'function applyPermissionVisibility('),
  segment('function formatCount(', 'function renderSummaryKpis('),
  segment('function localizeWorkflowStatus(', 'function localizeArtistKnowledgeStatus('),
  segment('let moderationReadGeneration =', 'function fanMissionStatusLabel('),
].join('\n');
