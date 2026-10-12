(function () {
  "use strict";

  const apiBase = "https://api.lumina-stage.com";
  const homeMissionEndpoint = "/api/v1/fan-engagement/missions?surface=home&scope=today&take=3";
  const fallbackCopy = window.LuminaFanEngagementCopy || {};
  const neutral = fallbackCopy.neutral || {};
  const submitCopy = fallbackCopy.submit || {};
  const copyPack = fallbackCopy.copyPackV1 || {};
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const intents = new Map();
  let missionRoot = null, missions = [], viewer = null, loading = false;
  let readFlight = null, submitFlight = null, revision = 0;
  let pageReady = document.readyState !== "loading";
  const homeMissionFixture = {
    generatedAt: "2026-05-10T00:00:00.000Z",
    locale: "ko",
    surface: "home",
    items: [
      {
        id: "mock-daily-signal",
        slug: "daily-signal",
        missionType: "daily_signal",
        artist: {
          id: "mock-yoon-serin",
          slug: "yoon-serin",
          displayName: "윤세린"
        },
        copy: {
          titleKey: "fanMission.dailySignal.title",
          descriptionKey: "fanMission.dailySignal.description",
          ctaKey: "fanMission.dailySignal.cta",
          labels: {
            ko: {
              title: "오늘의 응원 미션",
              description: "윤세린에게 오늘의 응원 신호를 보내주세요.",
              cta: "응원하기"
            }
          }
        },
        status: "active",
        participation: {
          status: "not_started",
          remainingCount: 1
        },
        rewardPreview: {
          points: 5,
          cashLike: false
        },
        action: {
          type: "mission_participation",
          requiresAuth: true
        }
      },
      {
        id: "mock-concept-vote",
        slug: "daily-concept-vote",
        missionType: "vote_concept",
        artist: {
          id: "mock-han-seoyul",
          slug: "han-seoyul",
          displayName: "한서율"
        },
        copy: {
          titleKey: "fanMission.dailyConceptVote.title",
          descriptionKey: "fanMission.dailyConceptVote.description",
          ctaKey: "fanMission.dailyConceptVote.cta"
        },
        status: "active",
        participation: {
          status: "not_started",
          remainingCount: 1
        },
        rewardPreview: {
          points: 5,
          cashLike: false
        },
        action: {
          type: "concept_vote",
          requiresAuth: true
        }
      },
      {
        id: "mock-one-line-proposal",
        slug: "one-line-proposal",
        missionType: "fan_proposal",
        artist: {
          id: "mock-park-doa",
          slug: "park-doa",
          displayName: "박도아"
        },
        copy: {
          titleKey: "fanMission.oneLineProposal.title",
          descriptionKey: "fanMission.oneLineProposal.description",
          ctaKey: "fanMission.oneLineProposal.cta"
        },
        status: "pending",
        participation: {
          status: "submitted",
          remainingCount: 0
        },
        rewardPreview: {
          points: 5,
          cashLike: false
        },
        action: {
          type: "fan_proposal",
          requiresAuth: true
        }
      }
    ],
    summary: {
      availableCount: 2,
      completedTodayCount: 0
    },
    policy: {
      rewardsAreCashLike: false,
      pointsTransferable: false
    }
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function hasKoreanText(value) {
    return /[가-힣]/.test(String(value || ""));
  }

  function safeLocalizedLabel(value) {
    const text = String(value || "").trim();
    return hasKoreanText(text) ? text : "";
  }

  function labelFromKey(key, fallback) {
    if (!key) return fallback;
    return fallbackCopy.labelsByKey?.[key] || fallback;
  }

  function copyLabel(copy, labelName, keyName, fallback) {
    const localized = safeLocalizedLabel(copy?.labels?.ko?.[labelName]);
    if (localized) return localized;
    return labelFromKey(copy?.[keyName], fallback);
  }

  function missionStatusLabel(status) {
    return fallbackCopy.status?.[status] || neutral.status || "진행 중";
  }

  function missionTypeLabel(type) {
    return fallbackCopy.missionType?.[type] || neutral.missionType || "팬 참여";
  }

  function participationLabel(participation) {
    const status = participation?.status;
    if (status === "not_started") return fallbackCopy.labelsByKey?.["fanMission.participation.notStarted"] || neutral.remaining || "참여 가능";
    if (status === "accepted") return fallbackCopy.labelsByKey?.["fanMission.participation.accepted"] || "참여 완료";
    if (status === "submitted") return fallbackCopy.labelsByKey?.["fanMission.participation.submitted"] || "확인 중";
    return neutral.status || "확인 중";
  }

  function rewardLabel(rewardPreview) {
    const points = Number(rewardPreview?.points || 0);
    if (points > 0) return `${neutral.reward || "팬 포인트"} +${points}`;
    return neutral.reward || "팬 포인트";
  }

  function authSnapshot() {
    try {
      const auth = typeof getAuth === "function" ? getAuth() : null;
      const id = auth?.user?.id || auth?.user?.userId;
      const token = auth?.accessToken;
      return uuid.test(id || "") && typeof token === "string" && token && token === token.trim() && !/[\r\n]/.test(token)
        ? { id: id.toLowerCase(), token } : null;
    } catch (_) {
      return null;
    }
  }

  function sameAuth(expected) {
    const current = authSnapshot();
    return expected === null ? current === null : !!current && current.id === expected.id && current.token === expected.token;
  }

  function intentName(owner, mission) {
    return owner.id + ":" + mission.id;
  }

  function missionIntent(mission) {
    return viewer ? intents.get(intentName(viewer, mission)) : null;
  }

  function participationEndpoint(mission) {
    const action = mission?.action, hint = action?.bodyHint;
    const endpoint = "/api/v1/fan-engagement/missions/" + mission?.id + "/participations";
    return uuid.test(mission?.id || "") && mission?.missionType === "daily_signal" &&
      ["daily", "once"].includes(mission?.resetPolicy) && action?.type === "mission_participation" &&
      action.method === "POST" && action.requiresAuth === true && action.endpoint === endpoint &&
      hint?.action === "complete" && hint.idempotencyKey === "client-generated-key" &&
      Object.keys(hint).length === 2 ? endpoint : null;
  }

  function eligibleMission(mission) {
    return !!participationEndpoint(mission) && mission.status === "active" &&
      mission.participation.status === "not_started" && mission.participation.remainingCount === 1;
  }

  function canParticipate(mission) {
    return !loading && !submitFlight && !!viewer && sameAuth(viewer) && eligibleMission(mission) &&
      missionIntent(mission)?.status !== "confirmed";
  }

  function missionUiState(mission) {
    const intent = missionIntent(mission), status = mission?.participation?.status;
    if (intent?.status === "pending") return "pending";
    if (["accepted", "completed", "submitted"].includes(status) && mission?.participation?.remainingCount === 0) return "completed";
    if (mission?.action?.requiresAuth && !authSnapshot()) return "login_required";
    if (intent?.status === "confirmed") return "confirming";
    if (intent?.status === "indeterminate") return "indeterminate";
    if (mission?.status !== "active" || (participationEndpoint(mission) && !eligibleMission(mission))) return "error";
    return "default";
  }

  function missionStateCopy(mission, uiState, ctaFallback) {
    const defaultCta = ctaFallback || submitCopy.cta || neutral.cta || "참여하기";
    const actionType = String(mission?.action?.type || mission?.missionType || "");
    const mutationLocked = ["mission_participation", "concept_vote", "vote_concept", "fan_proposal"].includes(actionType);
    const map = {
      default: {
        cta: eligibleMission(mission) ? defaultCta : mutationLocked ? "참여 준비 중" : defaultCta,
        status: eligibleMission(mission) ? participationLabel(mission?.participation) : mutationLocked ? "미리보기 상태 · 곧 참여할 수 있어요" : participationLabel(mission?.participation)
      },
      pending: { cta: "참여 중", status: "참여를 처리하고 있어요." },
      confirming: { cta: "확인 중", status: "최신 참여 상태를 확인하고 있어요." },
      indeterminate: { cta: "참여 결과 다시 확인", status: "처리 결과를 확인하지 못했어요." },
      completed: {
        cta: submitCopy.accepted || "참여 완료",
        status: mission?.participation?.status === "submitted"
          ? (fallbackCopy.labelsByKey?.["fanMission.participation.submitted"] || "확인 중")
          : (submitCopy.accepted || "참여 완료")
      },
      login_required: {
        cta: submitCopy.loginRequired || "로그인이 필요해요",
        status: (copyPack.loginRequired && copyPack.loginRequired[0]) || "로그인 후 참여할 수 있어요."
      },
      error: {
        cta: submitCopy.unavailable || "지금은 참여할 수 없는 미션이에요",
        status: submitCopy.networkError || "잠시 후 다시 시도해 주세요."
      }
    };
    return map[uiState] || map.default;
  }

  function missionOptions(mission) {
    const source = Array.isArray(mission?.options)
      ? mission.options
      : Array.isArray(mission?.action?.options)
        ? mission.action.options
        : [];
    const labels = source
      .map(option => safeLocalizedLabel(option?.label || option?.title || option?.name || option))
      .filter(Boolean)
      .slice(0, 4);
    if (labels.length) return labels;
    if (mission?.missionType === "vote_concept") return ["무대 의상", "화보 무드", "숏폼 콘셉트"];
    return [];
  }

  function renderMissionBody(mission, uiState) {
    if (mission?.missionType === "vote_concept") {
      const options = missionOptions(mission);
      return `
        <div class="fan-mission-options" aria-label="미션 선택지">
          ${options.map(option => `<button type="button" disabled>${escapeHtml(option)}</button>`).join("")}
        </div>
      `;
    }
    if (mission?.missionType === "fan_proposal") {
      return `
        <label class="fan-mission-suggest">
          <!-- #362 — "곧 열릴 예정" 카피 제거. 접수 가능한 제안 미션이 없는 상태로 분리하여 실서비스 톤 유지. -->
          <input type="text" maxlength="50" disabled placeholder="아직 접수 가능한 제안 미션이 없습니다." />
          <small>0 / 50</small>
        </label>
      `;
    }
    if (uiState === "completed") {
      return `<p class="fan-mission-inline-status">✓ ${escapeHtml(submitCopy.accepted || "참여 완료")}</p>`;
    }
    return "";
  }

  function normalizeMission(raw) {
    if (!raw || typeof raw !== "object") return null;
    return {
      id: typeof raw.id === "string" ? raw.id : "",
      slug: raw.slug || "",
      missionType: typeof raw.missionType === "string" ? raw.missionType : "",
      artist: raw.artist && typeof raw.artist === "object" ? raw.artist : {},
      copy: raw.copy && typeof raw.copy === "object" ? raw.copy : {},
      status: raw.status || "",
      resetPolicy: raw.resetPolicy,
      participation: raw.participation && typeof raw.participation === "object" ? raw.participation : {},
      rewardPreview: raw.rewardPreview && typeof raw.rewardPreview === "object" ? raw.rewardPreview : {},
      action: raw.action && typeof raw.action === "object" ? raw.action : {},
      options: Array.isArray(raw.options) ? raw.options : []
    };
  }

  function normalizeMissionResponse(data) {
    if (!Array.isArray(data?.items) || data.items.length > 3) throw new Error("fan-missions-invalid");
    const items = data.items.map(normalizeMission);
    if (items.some(item => !item) || new Set(items.map(item => item.id)).size !== items.length) throw new Error("fan-missions-invalid");
    return items;
  }

  async function readJson(response, maxBytes) {
    if (!response.body) throw new Error("fan-response-invalid");
    const reader = response.body.getReader(), chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) throw new Error("fan-response-too-large");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }

  function requestHeaders(owner) {
    return { Accept: "application/json", "Cache-Control": "no-store",
      ...(owner ? { Authorization: "Bearer " + owner.token } : {}) };
  }

  function refreshButton() {
    return `<div style="grid-column:1/-1"><button type="button" class="fan-mission-refresh" data-home-missions-refresh
      ${loading || submitFlight ? "disabled" : ""} aria-label="미션 새로고침" title="미션 새로고침"><span aria-hidden="true">&#8635;</span></button></div>`;
  }

  function renderStateMessage(root, message, state) {
    root.dataset.state = state;
    root.setAttribute("aria-busy", String(loading || !!submitFlight));
    root.innerHTML = `<div class="fan-mission-empty" role="status" data-state="${escapeHtml(state)}">${escapeHtml(message)}</div>` + refreshButton();
  }

  function renderMissionCard(mission) {
    const copy = mission?.copy || {};
    const title = copyLabel(copy, "title", "titleKey", neutral.title || "오늘의 팬 미션");
    const description = copyLabel(copy, "description", "descriptionKey", neutral.description || "아티스트에게 작은 응원 신호를 보내보세요.");
    const cta = copyLabel(copy, "cta", "ctaKey", neutral.cta || "참여하기");
    const artistName = safeLocalizedLabel(mission?.artist?.displayName) || "Lumina Stage";
    const status = missionStatusLabel(mission?.status);
    const type = missionTypeLabel(mission?.missionType);
    const reward = rewardLabel(mission?.rewardPreview);
    const uiState = missionUiState(mission);
    const stateCopy = missionStateCopy(mission, uiState, cta);
    const missionBody = renderMissionBody(mission, uiState);
    const enabled = canParticipate(mission);

    return `
      <article class="fan-mission-card is-${escapeHtml(uiState)}" data-mission-id="${escapeHtml(mission?.id)}" data-ui-state="${escapeHtml(uiState)}">
        <div class="fan-mission-card-head">
          <span class="fan-mission-type">${escapeHtml(type)}</span>
          <span class="fan-mission-status">${escapeHtml(status)}</span>
        </div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(description)}</p>
        ${missionBody}
        <div class="fan-mission-meta">
          <span>${escapeHtml(artistName)}</span>
          <span>${escapeHtml(stateCopy.status)}</span>
          <span>${escapeHtml(reward)}</span>
        </div>
        <button class="fan-mission-cta" type="button" data-mission-participate="${escapeHtml(mission.id)}"
          ${enabled ? "" : "disabled"} aria-disabled="${!enabled}" aria-busy="${uiState === "pending"}">${escapeHtml(stateCopy.cta)}</button>
      </article>
    `;
  }

  function renderMissionList(root, missions, state) {
    root.dataset.state = state;
    root.setAttribute("aria-busy", String(loading || !!submitFlight));
    root.innerHTML = missions.map(renderMissionCard).join("") + refreshButton();
  }

  async function renderHomeMissionTeaser() {
    const root = missionRoot;
    if (!pageReady || !root?.isConnected) return;
    const owner = authSnapshot(), ticket = ++revision, controller = new AbortController();
    readFlight?.abort(); readFlight = controller;
    loading = true; missions = []; viewer = null;
    renderStateMessage(root, neutral.loading || "오늘의 팬 미션을 불러오고 있어요.", "loading");
    const timeoutId = setTimeout(() => controller.abort(), 7000);
    const current = () => ticket === revision && sameAuth(owner) && root.isConnected && !controller.signal.aborted;
    const stale = () => {
      if (ticket !== revision || !root.isConnected) return;
      loading = false; missions = []; viewer = null;
      renderStateMessage(root, "로그인 상태가 바뀌었어요. 다시 확인해 주세요.", "error");
    };
    try {
      const url = apiBase + homeMissionEndpoint;
      const res = await fetch(url, { method: "GET", headers: requestHeaders(owner), credentials: "omit",
        redirect: "error", cache: "no-store", signal: controller.signal });
      if (!current()) { void res.body?.cancel().catch(() => {}); stale(); return; }
      if (!res.ok || res.url !== url) { void res.body?.cancel().catch(() => {}); throw new Error("fan-engagement-missions-unavailable"); }
      const data = await readJson(res, 262144);
      if (!current()) { stale(); return; }
      missions = normalizeMissionResponse(data); viewer = owner; loading = false;
      for (const mission of missions) {
        const intent = missionIntent(mission);
        if (!intent || intent.status === "pending") continue;
        if (mission.participation.status === "accepted" && mission.participation.remainingCount === 0) intent.status = "confirmed";
        else if (intent.status === "confirmed" && eligibleMission(mission)) intents.delete(intentName(owner, mission));
      }
      if (!missions.length) {
        renderStateMessage(root, neutral.empty || "오늘 참여할 팬 미션을 준비하고 있어요.", "empty");
        return;
      }
      renderMissionList(root, missions, "loaded");
    } catch (_) {
      if (ticket !== revision || !root.isConnected) return;
      if (!sameAuth(owner)) { stale(); return; }
      loading = false; missions = []; viewer = null;
      renderStateMessage(root, "미션 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.", "error");
    } finally {
      clearTimeout(timeoutId);
      if (readFlight === controller) readFlight = null;
    }
  }

  async function participate(mission) {
    if (!missionRoot?.isConnected || document.visibilityState === "hidden" || !canParticipate(mission)) return;
    const owner = viewer, name = intentName(owner, mission), endpoint = participationEndpoint(mission);
    let intent = intents.get(name);
    try {
      if (!intent) {
        const key = window.crypto.randomUUID();
        if (!uuid.test(key)) throw new Error("fan-key-invalid");
        intent = { key, status: "indeterminate" }; intents.set(name, intent);
      }
    } catch (_) {
      renderStateMessage(missionRoot, "참여 요청을 준비하지 못했어요. 다시 확인해 주세요.", "error");
      missions = []; viewer = null;
      return;
    }
    const controller = new AbortController(), flight = { owner, controller, intent };
    submitFlight = flight; intent.status = "pending";
    renderMissionList(missionRoot, missions, "loaded");
    const timeoutId = setTimeout(() => controller.abort(), 7000);
    const current = () => sameAuth(owner) && missionRoot.isConnected && !controller.signal.aborted;
    try {
      if (!current()) throw new Error("fan-auth-changed");
      const url = apiBase + endpoint;
      const res = await fetch(url, { method: "POST", headers: { ...requestHeaders(owner), "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete", idempotencyKey: intent.key }),
        credentials: "omit", redirect: "error", cache: "no-store", signal: controller.signal });
      if (!current()) { void res.body?.cancel().catch(() => {}); throw new Error("fan-auth-changed"); }
      if (!res.ok || res.url !== url) { void res.body?.cancel().catch(() => {}); throw new Error("fan-participation-unconfirmed"); }
      const receipt = await readJson(res, 65536);
      if (!current() || !uuid.test(receipt?.participation?.id || "") || receipt.participation.missionId !== mission.id ||
        receipt.participation.status !== "accepted" || typeof receipt.idempotentReplay !== "boolean") throw new Error("fan-participation-unconfirmed");
      intent.status = "confirmed";
    } catch (_) {
      // An uncertain result keeps this intent's key; only another user click may resend it.
      if (intent.status !== "confirmed") intent.status = "indeterminate";
    } finally {
      clearTimeout(timeoutId);
      if (submitFlight === flight) submitFlight = null;
      if (sameAuth(owner) && missionRoot.isConnected) await renderHomeMissionTeaser();
      else if (!loading && sameAuth(viewer) && missionRoot.isConnected) {
        if (missions.length) renderMissionList(missionRoot, missions, "loaded");
        else {
          const empty = missionRoot.dataset.state === "empty";
          renderStateMessage(missionRoot, empty ? neutral.empty || "오늘 참여할 팬 미션을 준비하고 있어요."
            : "미션 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.", empty ? "empty" : "error");
        }
      }
    }
  }

  missionRoot = document.getElementById("homeMissionTeaser");
  if (!missionRoot) return;
  missionRoot.addEventListener("click", event => {
    if (event.isTrusted !== true || !missionRoot.isConnected) return;
    const button = event.target.closest?.("[data-mission-participate], [data-home-missions-refresh]");
    if (!button || !missionRoot.contains(button) || button.disabled) return;
    event.preventDefault();
    if (button.hasAttribute("data-home-missions-refresh")) { if (!submitFlight) void renderHomeMissionTeaser(); return; }
    if (!sameAuth(viewer)) { authChanged(); return; }
    const mission = missions.find(item => item.id === button.dataset.missionParticipate);
    if (mission) void participate(mission);
  });
  function authChanged() {
    if (submitFlight && !sameAuth(submitFlight.owner)) {
      submitFlight.intent.status = "indeterminate"; submitFlight.controller.abort();
    }
    void renderHomeMissionTeaser();
  }
  ["lumina:authchange", "lumina:auth-expired"].forEach(name => window.addEventListener(name, authChanged));
  window.addEventListener("storage", event => { if (event.key === "lumina_auth" || event.key === null) authChanged(); });
  window.addEventListener("focus", () => { if (!submitFlight) void renderHomeMissionTeaser(); });
  if (pageReady) renderHomeMissionTeaser();
  else document.addEventListener("DOMContentLoaded", () => {
    pageReady = true;
    void renderHomeMissionTeaser();
  }, { once: true });
})();
