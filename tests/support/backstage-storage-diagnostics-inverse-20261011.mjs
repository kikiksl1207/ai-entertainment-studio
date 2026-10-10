import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const sha = value => createHash('sha256').update(value).digest('hex');
export const beforeSHA256 = '93a2051e3e400348a098fd4924f00cfa8e81e125165d80e7db13ba1e1f71bfb6';
export const afterSHA256 = '1be1ad523231597cd55383783e17c08fde73ff3a6f8bd161426923c42ce7ecd5';
const before = "function renderObjectStorageDiagnosticsFallback() {\n  renderObjectStorageDiagnostics({\n    reason: \"diagnostics endpoint unavailable\",\n    environment: {\n      storageProvider: \"-\",\n      directUploadMode: false,\n      bucketConfigured: false,\n      publicBaseUrlConfigured: false,\n      accessKeyConfigured: false,\n      secretKeyConfigured: false\n    },\n    recentUserImageUploads24h: { total: 0, pendingUpload: 0, uploaded: 0, failedOrUnconfirmed: 0 },\n    warnings: [\"진단 API 응답을 불러오지 못했습니다.\"],\n    nextActions: [\"관리자 세션과 백엔드 배포 상태를 확인하세요.\"],\n    policy: { secretsReturned: false }\n  });\n}";
const after = "function renderObjectStorageDiagnosticsFallback() {\n  if (!objectStorageReason || !objectStorageDiagnosticGrid || !objectStorageUploadStats || !objectStorageActions || !objectStoragePolicy) return;\n  objectStorageReason.classList.remove(\"is-ready\");\n  objectStorageReason.classList.add(\"is-warning\");\n  objectStorageReason.textContent = \"진단 데이터를 불러오지 못했습니다.\";\n  objectStorageDiagnosticGrid.innerHTML = [\"Direct upload\", \"Bucket\", \"Public URL\", \"R2 credentials\"]\n    .map(label => `<article><span>${escapeHtml(label)}</span><strong>확인 불가</strong></article>`).join(\"\");\n  objectStorageUploadStats.innerHTML = [\"Total\", \"Pending\", \"Uploaded\", \"Failed/Unconfirmed\"]\n    .map(label => `<div><dt>${escapeHtml(label)}</dt><dd>확인 불가</dd></div>`).join(\"\");\n  objectStorageActions.innerHTML = \"<li>진단 API 응답을 불러오지 못했습니다.</li><li>관리자 세션과 백엔드 배포 상태를 확인하세요.</li>\";\n  objectStoragePolicy.textContent = \"민감 값 반환 정책: 확인 불가\";\n}";

// Only the frozen diagnostics fallback may precede the existing inverse chain.
export function sourceWithoutStorageDiagnosticsDelta(value) {
  const source = value.replaceAll('\r\n', '\n');
  if (sha(source) === beforeSHA256) return source;
  assert.equal(sha(source), afterSHA256, 'Exact storage diagnostics source');
  assert.equal(source.split(after).length, 2, 'One frozen fallback');
  const restored = source.replace(after, before);
  assert.equal(sha(restored), beforeSHA256, 'All previous source bytes restored');
  return restored;
}
