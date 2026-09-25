(function initCreatorStoryFinalization() {
  "use strict";
  const api = window.LuminaCreatorStudioApi;
  const analysis = window.LuminaCreatorAnalysis;
  const entry = document.getElementById("writerFinalEntry");
  if (!api || !analysis || !entry) return;
  const root = "/api/v1/me/creator-studio";
  const modal = document.getElementById("writerFinalModal");
  const parts = document.getElementById("writerFinalParts");
  const issues = document.getElementById("writerFinalIssues");
  const state = document.getElementById("writerFinalState");
  const entryState = document.getElementById("writerFinalEntryState");
  const prepare = document.getElementById("writerFinalPrepare");
  const checks = ["Reviewed", "Rights", "Ai", "Warnings"].map(name => document.getElementById("writerFinal" + name));
  let snapshot = null;
  let active = null;
  let busy = false;

  function current() {
    const completed = analysis.completed();
    return Boolean(completed && active && completed.manuscriptVersionId === active.manuscriptVersionId &&
      completed.workId === active.workId && api.isCurrent(active.identity));
  }
  function updateEntry() {
    const completed = analysis.completed();
    entry.hidden = !completed;
    if (active && (!completed || completed.manuscriptVersionId !== active.manuscriptVersionId ||
        completed.workId !== active.workId || !api.isCurrent(active.identity))) {
      if (!busy) close();
      active = null;
      snapshot = null;
      entryState.textContent = "";
    }
  }
  async function request(path, options = {}) {
    if (!current()) throw new Error("원고 또는 계정이 변경되었습니다.");
    const response = await api.fetch(root + path, { ...options, identity: active.identity });
    const data = await response.json().catch(() => null);
    if (!current()) throw new Error("원고 또는 계정이 변경되었습니다.");
    if (!response.ok) throw new Error(data?.code || data?.error?.code || data?.message || "요청을 완료하지 못했습니다.");
    return data;
  }
  function routePath(suffix = "") {
    return `/stories/${encodeURIComponent(active.workId)}/linear-draft${suffix}`;
  }
  function close() { if (!busy) modal.classList.add("is-hidden"); }
  function setState(message, error = false) {
    state.textContent = message;
    entryState.textContent = message;
    state.classList.toggle("is-danger", error);
    entryState.classList.toggle("is-danger", error);
  }
  function renderParts() {
    parts.replaceChildren();
    issues.replaceChildren();
    (snapshot.issues || []).forEach(issue => {
      const item = document.createElement("p");
      item.className = issue.severity === "critical" ? "is-danger" : "";
      item.textContent = `${issue.severity === "critical" ? "차단" : "주의"}: ${issue.summary}`;
      issues.append(item);
    });
    document.getElementById("writerFinalWarningsLabel").hidden =
      !(snapshot.issues || []).some(issue => issue.severity === "warning");
    snapshot.parts.forEach((part, index) => {
      const item = document.createElement("section");
      item.className = "writer-final-part";
      const heading = document.createElement("h3");
      heading.textContent = `${index + 1}. ${part.title}`;
      const excerpt = document.createElement("blockquote");
      excerpt.textContent = part.endingExcerpt;
      const destination = document.createElement("p");
      destination.textContent = part.nextPartTitle ? `원작 경로: ${part.nextPartTitle}` : "원작 경로: 작가가 쓴 엔딩";
      const label = document.createElement("label");
      label.textContent = "1번 선택 문구";
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 120;
      input.required = true;
      input.dataset.partKey = part.partKey;
      input.value = snapshot.scenes[index]?.originalLabel || "";
      input.setAttribute("aria-label", `${part.title} 원작 경로 선택 문구`);
      label.append(input);
      item.append(heading, excerpt, destination, label);
      parts.append(item);
    });
  }
  async function open() {
    if (busy) return;
    const completed = analysis.completed();
    if (!completed) return;
    active = completed;
    modal.classList.remove("is-hidden");
    setState("원고와 검토 상태를 확인하고 있습니다.");
    prepare.disabled = true;
    parts.replaceChildren();
    try {
      snapshot = await request(routePath(`/${encodeURIComponent(active.manuscriptVersionId)}`));
      if (snapshot.manuscriptVersionId !== active.manuscriptVersionId ||
          snapshot.analysisJobId !== active.analysisJobId || !Array.isArray(snapshot.parts) || !snapshot.parts.length) {
        throw new Error("현재 원고의 분석 결과를 확인할 수 없습니다.");
      }
      renderParts();
      checks.forEach(check => { check.checked = false; });
      setState(snapshot.issuesTruncated ? "분석 경고가 너무 많아 이 화면에서 모두 확인할 수 없습니다. 운영 검토가 필요합니다." :
        (snapshot.issues || []).some(issue => issue.severity === "critical")
          ? "심각한 설정 충돌이 남아 있습니다. 분석 내용을 수정한 뒤 다시 검토해 주세요." :
        snapshot.ready ? "선택지 3개가 모두 준비되어 있습니다. 이 원고는 아직 비공개입니다." :
          "원고의 원래 다음 경로를 확인하고 선택 문구를 입력해 주세요.");
    } catch (error) { snapshot = null; setState(error.message, true); }
    finally { prepare.disabled = !snapshot || snapshot.issuesTruncated ||
      (snapshot.issues || []).some(issue => issue.severity === "critical"); }
  }
  async function finalize() {
    if (busy || !snapshot || !current()) return;
    const originalRoutes = [...parts.querySelectorAll("input[data-part-key]")].map(input => ({
      partKey: input.dataset.partKey, label: input.value.trim()
    }));
    if (snapshot.issuesTruncated || (snapshot.issues || []).some(issue => issue.severity === "critical") ||
        originalRoutes.length !== snapshot.parts.length || originalRoutes.some(item => !item.label) ||
        !checks.slice(0, 3).every(check => check.checked) ||
        ((snapshot.issues || []).some(issue => issue.severity === "warning") && !checks[3].checked)) {
      setState("모든 원작 선택 문구와 검토·권리·AI 승인 항목을 확인해 주세요.", true);
      return;
    }
    busy = true;
    prepare.disabled = true;
    try {
      if (!snapshot.review || snapshot.review.state !== "submitted") {
        setState("작가의 최종 검토를 기록하고 있습니다.");
        let review = await request(`/stories/${encodeURIComponent(active.workId)}/reviews`, {
          method: "POST", body: { manuscriptVersionId: active.manuscriptVersionId, analysisJobId: active.analysisJobId }
        });
        const steps = ["analysis_ready", "summary_review", "proposal_review", "continuity_review"];
        const targets = ["summary_review", "proposal_review", "continuity_review", "final_confirmation"];
        while (steps.includes(review.state)) {
          const next = targets[steps.indexOf(review.state)];
          review = await request(`/reviews/${encodeURIComponent(review.reviewId)}/transition`, {
            method: "POST", body: { toState: next, expectedRevision: review.revision,
              ...(next === "final_confirmation" ? { decisions: { warningAcknowledged: true,
                originalRoutesReviewed: true }, finalSummary: { partCount: snapshot.parts.length,
                manuscriptHash: snapshot.manuscriptHash } } : {}) }
          });
        }
        if (!["final_confirmation", "submission_failed", "submitted"].includes(review.state)) {
          throw new Error("작가 최종 검토를 완료할 수 없습니다.");
        }
        if (review.state !== "submitted") {
          await request(`/reviews/${encodeURIComponent(review.reviewId)}/submit`, { method: "POST",
            headers: { "Idempotency-Key": `studio-linear-final-${active.manuscriptVersionId}` } });
        }
      }
      if (!snapshot.consent?.active) {
        setState("원고 권리와 AI 분기 승인을 저장하고 있습니다.");
        await request(`/stories/${encodeURIComponent(active.workId)}/style-consent`, { method: "PUT",
          body: { manuscriptVersionId: active.manuscriptVersionId, rightsConfirmed: true,
            aiBranchAllowed: true, translationAllowed: false, imageTransformationAllowed: false,
            allowedLocales: ["ko"], allowedRegions: ["KR"], startsAt: new Date().toISOString(),
            ...(snapshot.consent ? { expectedRevision: snapshot.consent.revision } : {}) } });
      }
      setState("원고를 비공개 장면으로 정리하고 있습니다.");
      const result = await request(routePath("/materialize"), { method: "POST",
        body: { manuscriptVersionId: active.manuscriptVersionId, expectedManuscriptHash: snapshot.manuscriptHash,
          originalRoutesReviewed: true, originalRoutes } });
      for (let index = 0; index < result.scenes.length; index++) {
        const scene = result.scenes[index];
        if (scene.choiceCount === 3) continue;
        if (scene.choiceCount !== 1) throw new Error("선택지 상태가 달라졌습니다. 다시 확인해 주세요.");
        setState(`AI 선택지 준비 중: ${index + 1} / ${result.scenes.length}`);
        await request(`/stories/${encodeURIComponent(active.workId)}/releases/${encodeURIComponent(result.releaseId)}` +
          `/scenes/${encodeURIComponent(scene.sceneId)}/prepare-choices`, { method: "POST" });
      }
      setState("선택지와 원고를 최종 검증하고 있습니다.");
      await request(routePath(`/releases/${encodeURIComponent(result.releaseId)}/finish`), { method: "POST" });
      snapshot = await request(routePath(`/${encodeURIComponent(active.manuscriptVersionId)}`));
      setState("모든 파트에 선택지 3개가 준비되었습니다. 공개 전 운영 검토가 남아 있습니다.");
    } catch (error) {
      setState(`${error.message} 준비된 파트는 보존됩니다. 다시 열어 이어서 진행해 주세요.`, true);
      try { snapshot = await request(routePath(`/${encodeURIComponent(active.manuscriptVersionId)}`)); }
      catch (_) { /* Keep the failure visible until the author retries. */ }
    } finally { busy = false; prepare.disabled = false; }
  }
  document.getElementById("writerFinalOpen").addEventListener("click", open);
  document.getElementById("writerFinalClose").addEventListener("click", close);
  document.getElementById("writerFinalCancel").addEventListener("click", close);
  prepare.addEventListener("click", finalize);
  modal.addEventListener("click", event => { if (event.target === modal) close(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
  window.addEventListener("lumina:auth-expired", () => { if (!busy) close(); active = null; snapshot = null; updateEntry(); });
  setInterval(updateEntry, 1000);
  updateEntry();
})();
