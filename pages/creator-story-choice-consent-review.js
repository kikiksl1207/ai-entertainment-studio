(function initCreatorChoiceConsentReview() {
  "use strict";
  const parts = document.getElementById("writerFinalParts");
  const modal = document.getElementById("writerFinalModal");
  if (!parts?.parentElement || !modal?.contains(parts)) return;
  const hash = /^[a-f0-9]{64}$/;
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  const partKey = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
  const activeKeys = ["workId", "manuscriptVersionId", "analysisJobId", "manuscriptHash", "contentHash", "sourceChecksum", "checksum", "sourceLocale"];
  const expectedKeys = ["expectedManuscriptHash", "expectedApprovedFingerprint", "expectedProfilePinHash", "expectedReleaseChecksum"];
  // Localized consent language follows the existing five-language creator review.
  const copy = {
    ko: {
      title: "저장된 선택지 재사용 승인", notice: "동의 내용이 변경되어 저장된 선택지의 재사용 승인이 필요합니다.",
      count: "{count}개 장면", scene: "{number}. {title}", writer_original: "원작 경로", generation_required: "AI 분기 경로",
      reviewed: "저장된 선택지를 검토했습니다.", consent: "현재 동의가 이 선택지의 재사용에 적용됨을 확인합니다.",
      approve: "저장된 선택지 재사용 승인", confirm: "현재 동의에 따라 {count}개 장면의 저장된 선택지 재사용을 승인할까요? 새로운 AI 생성은 시작되지 않습니다.",
      unavailable: "현재 승인된 스토리 설정과 동의를 확인한 뒤 다시 열어 주세요. 재사용을 승인할 수 없습니다.",
      apiUnavailable: "작가 서비스에 연결할 수 없습니다. 재사용을 승인할 수 없습니다. 최종 검토를 다시 열어 주세요.",
      invalid: "저장된 선택지와 검토 정보를 확인할 수 없습니다. 최종 검토를 다시 열어 주세요.",
      saving: "재사용 승인 확인 중...", approved: "저장된 선택지 재사용이 승인되었습니다.",
      unconfirmed: "재사용 승인을 확인하지 못했습니다. 최종 검토를 다시 열어 확인해 주세요."
    },
    en: {
      title: "Saved Choice Reuse Approval", notice: "Consent changed. Saved choices need renewed reuse approval.",
      count: "{count} scenes", scene: "{number}. {title}", writer_original: "Original path", generation_required: "AI branch path",
      reviewed: "I reviewed saved choices.", consent: "I confirm current consent applies to reusing these choices.",
      approve: "Approve Saved Choice Reuse", confirm: "Approve reuse of saved choices for all {count} scenes under current consent? No new AI generation will start.",
      unavailable: "Reuse cannot be approved. Check the current approved story settings and consent, then reopen this review.",
      apiUnavailable: "The creator service is unavailable. Reuse cannot be approved. Reopen final review.",
      invalid: "Saved choices and review details could not be verified. Reopen final review.",
      saving: "Confirming reuse approval...", approved: "Saved choice reuse approved.",
      unconfirmed: "Reuse approval could not be confirmed. Reopen final review to check."
    },
    ja: {
      title: "保存済み選択肢の再利用承認", notice: "同意内容が変更されたため、保存済み選択肢の再利用承認が必要です。",
      count: "{count} シーン", scene: "{number}. {title}", writer_original: "原作経路", generation_required: "AI 分岐経路",
      reviewed: "保存済みの選択肢を確認しました。", consent: "現在の同意がこれらの選択肢の再利用に適用されることを確認します。",
      approve: "保存済み選択肢の再利用を承認", confirm: "現在の同意に基づき、全 {count} シーンの保存済み選択肢の再利用を承認しますか？新たな AI 生成は開始されません。",
      unavailable: "再利用を承認できません。現在承認済みの設定と同意を確認してから、この確認を開き直してください。",
      apiUnavailable: "作者向けサービスを利用できません。再利用を承認できません。最終確認を開き直してください。",
      invalid: "保存済み選択肢と確認情報を検証できません。最終確認を開き直してください。",
      saving: "再利用承認を確認中...", approved: "保存済み選択肢の再利用を承認しました。",
      unconfirmed: "再利用承認を確認できませんでした。最終確認を開き直してください。"
    },
    "zh-Hans": {
      title: "批准复用已保存选项", notice: "同意内容已更改，已保存选项需要重新批准复用。",
      count: "{count} 个场景", scene: "{number}. {title}", writer_original: "原作路径", generation_required: "AI 分支路径",
      reviewed: "我已审阅已保存的选项。", consent: "我确认当前同意适用于复用这些选项。",
      approve: "批准复用已保存选项", confirm: "是否根据当前同意批准复用全部 {count} 个场景的已保存选项？不会启动新的 AI 生成。",
      unavailable: "无法批准复用。请确认当前已批准的故事设置和同意，再重新打开审阅。",
      apiUnavailable: "作者服务不可用，无法批准复用。请重新打开最终审阅。",
      invalid: "无法验证已保存选项及审阅信息。请重新打开最终审阅。",
      saving: "正在确认复用批准...", approved: "已批准复用已保存选项。",
      unconfirmed: "无法确认复用批准。请重新打开最终审阅以核对。"
    },
    "zh-Hant": {
      title: "核准重用已儲存選項", notice: "同意內容已變更，已儲存選項需要重新核准重用。",
      count: "{count} 個場景", scene: "{number}. {title}", writer_original: "原作路徑", generation_required: "AI 分支路徑",
      reviewed: "我已審閱已儲存的選項。", consent: "我確認目前的同意適用於重用這些選項。",
      approve: "核准重用已儲存選項", confirm: "是否根據目前的同意核准重用全部 {count} 個場景的已儲存選項？不會啟動新的 AI 生成。",
      unavailable: "無法核准重用。請確認目前已核准的故事設定和同意，再重新開啟審閱。",
      apiUnavailable: "作者服務無法使用，無法核准重用。請重新開啟最終審閱。",
      invalid: "無法驗證已儲存選項及審閱資訊。請重新開啟最終審閱。",
      saving: "正在確認重用核准...", approved: "已核准重用已儲存選項。",
      unconfirmed: "無法確認重用核准。請重新開啟最終審閱以核對。"
    }
  };
  function t(key, values = {}) {
    const locale = window.luminaI18n?.getLocale?.() || document.documentElement.lang || "ko";
    const language = { "en-US": "en", "ja-JP": "ja", "ko-KR": "ko", "zh-CN": "zh-Hans", "zh-TW": "zh-Hant" }[locale] || locale;
    return (copy[language] || copy.ko)[key].replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
  }
  function element(tag, name, parent) {
    const node = document.createElement(tag);
    if (name) node.id = "writerChoiceConsent" + name;
    parent?.append(node);
    return node;
  }
  const root = element("section", "Review");
  root.className = "writer-choice-consent-review";
  root.hidden = true;
  root.setAttribute("aria-labelledby", "writerChoiceConsentTitle");
  parts.after(root);
  const title = element("h3", "Title", root);
  const notice = element("p", "Notice", root);
  const count = element("p", "Count", root);
  const list = element("ol", "Scenes", root);
  list.tabIndex = 0;
  const status = element("p", "Status", root);
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  function acknowledgement(name) {
    const label = element("label", null, root);
    label.className = "writer-choice-consent-check";
    const input = element("input", name, label);
    input.type = "checkbox";
    const text = element("span", name + "Text", label);
    return { input, text };
  }
  const reviewed = acknowledgement("Reviewed");
  const consent = acknowledgement("Confirmed");
  const actions = element("div", "Actions", root);
  const approve = element("button", "Approve", actions);
  approve.type = "button";
  approve.className = "primary-action";
  let scope = null;
  let revision = 0;
  let timer = null;
  let busy = false;
  let blocked = false;
  let statusKey = null;
  let controller = null;
  const pending = new Set();
  const plain = (value, limit) => typeof value === "string" && value.length <= limit && Boolean(value.trim()) &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value);
  const validTitle = value => typeof value === "string" && value.length > 0 && value.length <= 1000 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value);
  const validId = value => typeof value === "string" && uuid.test(value);
  const validHash = value => typeof value === "string" && hash.test(value);
  const positive = value => Number.isSafeInteger(value) && value > 0;
  const validKey = value => typeof value === "string" && partKey.test(value);

  function validActive(active) {
    return Boolean(active && [active.workId, active.manuscriptVersionId, active.analysisJobId].every(validId) &&
      plain(active.identity?.ownerId, 320) && Number.isSafeInteger(active.identity?.epoch) && active.identity.epoch >= 0);
  }
  function apiAvailable() {
    return typeof window.LuminaCreatorStudioApi?.fetch === "function" && typeof window.LuminaCreatorStudioApi?.isCurrent === "function";
  }
  function currentAuthor(active) {
    try {
      const api = window.LuminaCreatorStudioApi;
      const completed = window.LuminaCreatorAnalysis?.completed?.();
      return Boolean(validActive(active) && typeof api?.fetch === "function" && api.isCurrent?.(active.identity) === true &&
        completed && activeKeys.every(key => completed[key] === active[key]) &&
        completed.identity?.ownerId === active.identity.ownerId && completed.identity?.epoch === active.identity.epoch);
    } catch (_) { return false; }
  }
  function readData(snapshot, review, active) {
    try {
      const batch = review?.consentReview;
      const source = snapshot?.parts;
      if (!validActive(active) || !validId(snapshot?.releaseId) || review?.releaseId !== snapshot.releaseId ||
          review.status !== "consent_changed" || review.canReset !== false || review.generationStarted !== false ||
          snapshot.manuscriptVersionId !== active.manuscriptVersionId || snapshot.analysisJobId !== active.analysisJobId ||
          (snapshot.workId !== undefined && snapshot.workId !== active.workId) || !validHash(snapshot.manuscriptHash) ||
          ["manuscriptHash", "contentHash"].some(key => active[key] !== undefined && active[key] !== snapshot.manuscriptHash) ||
          !Array.isArray(source) || !source.length || source.some(part => !validKey(part?.partKey) || !validTitle(part.title)) ||
          new Set(source.map(part => part.partKey)).size !== source.length ||
          typeof batch?.canReapprove !== "boolean" || !validId(batch.consentId) || !positive(batch.consentRevision) || !validHash(batch.batchHash) ||
          !expectedKeys.every(key => review[key] === null || validHash(review[key])) ||
          (review.expectedManuscriptHash !== null && review.expectedManuscriptHash !== snapshot.manuscriptHash) ||
          (batch.canReapprove && !expectedKeys.every(key => validHash(review[key])))) return null;
      for (const key of ["preparedScenes", "resetRequiredScenes"]) {
        if (!Number.isSafeInteger(review[key]) || review[key] < 0 || review[key] > source.length) return null;
      }
      if (batch.canReapprove && review.preparedScenes !== source.length) return null;
      const stored = snapshot.scenes;
      if (!Array.isArray(stored) || stored.length !== source.length || !Array.isArray(batch.scenes) || batch.scenes.length !== source.length) return null;
      for (const scenes of [stored, batch.scenes]) {
        if (scenes.some(scene => !validKey(scene?.partKey) || !validId(scene.sceneId)) ||
            new Set(scenes.map(scene => scene.partKey)).size !== source.length ||
            new Set(scenes.map(scene => scene.sceneId.toLowerCase())).size !== source.length) return null;
      }
      if (stored.some(scene => scene.choiceCount !== 3)) return null;
      const storedByKey = new Map(stored.map(scene => [scene.partKey, scene]));
      const batchByKey = new Map(batch.scenes.map(scene => [scene.partKey, scene]));
      const scenes = [];
      for (const part of source) {
        const saved = storedByKey.get(part.partKey);
        const scene = batchByKey.get(part.partKey);
        if (!saved || !scene || saved.sceneId !== scene.sceneId || !Array.isArray(scene.choices) || scene.choices.length !== 3 ||
            scene.choices.some(choice => ![1, 2, 3].includes(choice?.position) || !plain(choice.label, 120) ||
              choice.routeKind !== (choice.position === 1 ? "writer_original" : "generation_required")) ||
            new Set(scene.choices.map(choice => choice.position)).size !== 3 ||
            new Set(scene.choices.map(choice => choice.label.trim())).size !== 3) return null;
        scenes.push({ partKey: part.partKey, title: part.title, sceneId: scene.sceneId,
          choices: scene.choices.map(choice => ({ position: choice.position, label: choice.label, routeKind: choice.routeKind }))
            .sort((a, b) => a.position - b.position) });
      }
      const sourceConsent = snapshot.consent;
      if (sourceConsent !== undefined && sourceConsent !== null &&
          (typeof sourceConsent.active !== "boolean" || !positive(sourceConsent.revision) ||
            sourceConsent.revision !== batch.consentRevision ||
            (sourceConsent.id !== undefined && sourceConsent.id !== batch.consentId) ||
            (batch.canReapprove && sourceConsent.active !== true))) return null;
      return { scenes, canReapprove: batch.canReapprove, releaseId: snapshot.releaseId,
        preparedScenes: review.preparedScenes, resetRequiredScenes: review.resetRequiredScenes,
        consentActive: sourceConsent?.active ?? null,
        body: { expectedManuscriptHash: review.expectedManuscriptHash, expectedApprovedFingerprint: review.expectedApprovedFingerprint,
          expectedProfilePinHash: review.expectedProfilePinHash, expectedReleaseChecksum: review.expectedReleaseChecksum,
          expectedConsentId: batch.consentId, expectedConsentRevision: batch.consentRevision, expectedBatchHash: batch.batchHash,
          choicesReviewed: true, currentConsentConfirmed: true } };
    } catch (_) { return null; }
  }
  function visible() { return !modal.hidden && !modal.classList.contains("is-hidden"); }
  function reset() {
    revision++;
    controller?.abort();
    controller = null;
    if (timer !== null) clearInterval(timer);
    timer = null;
    scope = null;
    busy = blocked = false;
    statusKey = null;
    reviewed.input.checked = consent.input.checked = false;
    reviewed.input.disabled = consent.input.disabled = approve.disabled = true;
    list.replaceChildren();
    count.textContent = notice.textContent = status.textContent = "";
    root.setAttribute("aria-busy", "false");
    root.hidden = true;
  }
  function current() {
    if (!scope) return false;
    if (!apiAvailable()) {
      if (visible() && scope.review?.status === "consent_changed") serviceFailure();
      else reset();
      return false;
    }
    const value = readData(scope.snapshot, scope.review, scope.active);
    const okay = visible() && !root.hidden && scope.review?.status === "consent_changed" && currentAuthor(scope.active) &&
      activeKeys.every(key => scope.sourceActive[key] === scope.active[key]) &&
      scope.sourceActive.identity?.ownerId === scope.active.identity.ownerId && scope.sourceActive.identity?.epoch === scope.active.identity.epoch &&
      JSON.stringify(value) === scope.seal;
    if (!okay) reset();
    return Boolean(okay);
  }
  function renderCopy() {
    title.textContent = t("title");
    notice.textContent = t("notice");
    count.textContent = scope?.data ? t("count", { count: scope.data.scenes.length }) : "";
    list.setAttribute("aria-label", t("title"));
    reviewed.text.textContent = t("reviewed");
    consent.text.textContent = t("consent");
    approve.textContent = t("approve");
    status.textContent = statusKey ? t(statusKey) : "";
    status.classList.toggle("is-danger", ["invalid", "unavailable", "apiUnavailable", "unconfirmed"].includes(statusKey));
    scope?.rows.forEach((row, index) => {
      row.title.textContent = t("scene", { number: index + 1, title: scope.data.scenes[index].title });
      row.routes.forEach((route, choiceIndex) => { route.textContent = t(scope.data.scenes[index].choices[choiceIndex].routeKind); });
    });
  }
  function controls() {
    const enabled = Boolean(apiAvailable() && scope?.data?.canReapprove && !blocked && !busy && !pending.has(scope.requestKey));
    reviewed.input.disabled = consent.input.disabled = !enabled;
    approve.disabled = !enabled || !reviewed.input.checked || !consent.input.checked;
    root.setAttribute("aria-busy", String(busy || Boolean(scope && pending.has(scope.requestKey))));
    renderCopy();
  }
  function serviceFailure() {
    reset();
    statusKey = "apiUnavailable";
    root.hidden = false;
    controls();
  }
  function show(snapshot, review, active) {
    if (review?.status !== "consent_changed" || !visible() || !validActive(active)) { reset(); return; }
    if (!apiAvailable()) { serviceFailure(); return; }
    if (!currentAuthor(active)) { reset(); return; }
    const data = readData(snapshot, review, active);
    const seal = JSON.stringify(data);
    if (scope && current() && scope.seal === seal && activeKeys.every(key => scope.active[key] === active[key]) &&
        scope.active.identity.ownerId === active.identity.ownerId && scope.active.identity.epoch === active.identity.epoch) {
      scope.snapshot = snapshot;
      scope.review = review;
      scope.sourceActive = active;
      controls();
      return;
    }
    reset();
    scope = { snapshot, review, sourceActive: active, active: { ...active, identity: { ...active.identity } }, data, seal, rows: [],
      requestKey: JSON.stringify([active.identity.ownerId, active.identity.epoch, active.workId, data?.releaseId, data?.body]) };
    root.hidden = false;
    if (!current()) return;
    statusKey = !data ? "invalid" : !data.canReapprove ? "unavailable" : null;
    for (const scene of data?.scenes || []) {
      const item = element("li", null, list);
      const heading = element("h4", null, item);
      const choices = element("ol", null, item);
      const routes = [];
      for (const choice of scene.choices) {
        const row = element("li", null, choices);
        row.value = choice.position;
        const label = element("span", null, row);
        label.className = "writer-choice-consent-label";
        label.textContent = choice.label;
        const route = element("span", null, row);
        route.className = "writer-choice-consent-route";
        routes.push(route);
      }
      scope.rows.push({ title: heading, routes });
    }
    timer = setInterval(current, 500);
    controls();
  }
  function live(captured, version) { return scope === captured && revision === version && current(); }
  function receipt(value, captured) {
    const keys = ["generationStarted", "idempotentReplay", "reapprovedScenes", "releaseId", "status"];
    return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).sort().join("|") === keys.join("|") && value.releaseId === captured.data.releaseId &&
      value.status === "current" && value.generationStarted === false && typeof value.idempotentReplay === "boolean" &&
      Number.isSafeInteger(value.reapprovedScenes) && (value.idempotentReplay ? value.reapprovedScenes === 0 :
        value.reapprovedScenes >= 1 && value.reapprovedScenes <= captured.data.scenes.length));
  }
  async function submit() {
    if (!current() || approve.disabled || busy || blocked || !scope.data?.canReapprove ||
        !reviewed.input.checked || !consent.input.checked || pending.has(scope.requestKey)) return;
    const captured = scope;
    const version = revision;
    let submitted = false;
    busy = true;
    controls();
    try {
      if (typeof window.confirm !== "function" || !window.confirm(t("confirm", { count: captured.data.scenes.length }))) return;
      if (!live(captured, version) || !reviewed.input.checked || !consent.input.checked) return;
      pending.add(captured.requestKey);
      submitted = true;
      controller = new AbortController();
      statusKey = "saving";
      controls();
      const response = await window.LuminaCreatorStudioApi.fetch(
        `/api/v1/me/creator-studio/stories/${encodeURIComponent(captured.active.workId)}/linear-draft/releases/${encodeURIComponent(captured.data.releaseId)}/reapprove-choices`,
        { method: "POST", identity: { ...captured.active.identity }, signal: controller.signal, _retried: true, body: { ...captured.data.body } });
      if (!live(captured, version)) return;
      const value = await response.json();
      if (!live(captured, version)) return;
      if (response.ok !== true || !receipt(value, captured)) throw new Error("Unconfirmed approval");
      blocked = true;
      statusKey = "approved";
      reviewed.input.checked = consent.input.checked = false;
      controls();
      window.dispatchEvent(new CustomEvent("lumina:story-choice-consent-reviewed", {
        detail: { workId: captured.active.workId, releaseId: captured.data.releaseId }
      }));
    } catch (_) {
      if (live(captured, version)) {
        blocked = true;
        statusKey = "unconfirmed";
        reviewed.input.checked = consent.input.checked = false;
      }
    } finally {
      if (submitted) pending.delete(captured.requestKey);
      if (scope === captured && revision === version) { busy = false; controller = null; }
      if (current()) controls();
    }
  }
  reviewed.input.addEventListener("change", () => { if (current()) controls(); });
  consent.input.addEventListener("change", () => { if (current()) controls(); });
  approve.addEventListener("click", submit);
  window.addEventListener("lumina:localechange", () => {
    if (current() || (!root.hidden && statusKey === "apiUnavailable")) renderCopy();
  });
  window.addEventListener("lumina:auth-expired", reset);
  window.addEventListener("lumina:authchange", current);
  window.addEventListener("pagehide", reset);
  window.addEventListener("focus", current);
  document.addEventListener("input", current);
  document.addEventListener("change", current);
  if (typeof MutationObserver !== "undefined") new MutationObserver(() => {
    if (!visible()) reset();
  }).observe(modal, { attributes: true, attributeFilter: ["class", "hidden"] });
  window.LuminaCreatorChoiceConsentReview = { show, reset };
  reset();
})();
