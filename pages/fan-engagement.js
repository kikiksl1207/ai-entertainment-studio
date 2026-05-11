(function () {
  "use strict";

  const apiBase = "https://api.lumina-stage.com";
  const homeMissionEndpoint = "/api/v1/fan-engagement/missions?surface=home&scope=today&take=3";
  const fallbackCopy = window.LuminaFanEngagementCopy || {};
  const neutral = fallbackCopy.neutral || {};
  const submitCopy = fallbackCopy.submit || {};
  const copyPack = fallbackCopy.copyPackV1 || {};

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

  function hasAuthToken() {
    try {
      const auth = JSON.parse(localStorage.getItem("lumina_auth") || "null");
      return Boolean(auth?.accessToken);
    } catch (_) {
      return false;
    }
  }

  function missionUiState(mission) {
    const status = mission?.participation?.status || mission?.status || "";
    if (["accepted", "completed", "submitted"].includes(status)) return "completed";
    if (mission?.action?.requiresAuth && !hasAuthToken()) return "login_required";
    if (["inactive", "archived", "expired", "closed"].includes(mission?.status)) return "error";
    return "default";
  }

  function missionStateCopy(mission, uiState, ctaFallback) {
    const defaultCta = ctaFallback || submitCopy.cta || neutral.cta || "참여하기";
    const map = {
      default: {
        cta: defaultCta,
        status: participationLabel(mission?.participation)
      },
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
          <input type="text" maxlength="50" disabled placeholder="한 줄 제안은 곧 열릴 예정이에요" />
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
      id: raw.id || raw.missionId || raw.slug || "",
      slug: raw.slug || "",
      missionType: raw.missionType || raw.type || "",
      artist: raw.artist && typeof raw.artist === "object" ? raw.artist : {},
      copy: raw.copy && typeof raw.copy === "object" ? raw.copy : {},
      status: raw.status || "",
      participation: raw.participation && typeof raw.participation === "object" ? raw.participation : {},
      rewardPreview: raw.rewardPreview && typeof raw.rewardPreview === "object" ? raw.rewardPreview : {},
      action: raw.action && typeof raw.action === "object" ? raw.action : {},
      options: Array.isArray(raw.options) ? raw.options : []
    };
  }

  function normalizeMissionResponse(data) {
    const items = Array.isArray(data?.items) ? data.items : [];
    return items.map(normalizeMission).filter(Boolean).slice(0, 3);
  }

  async function loadHomeMissions() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);
    try {
      const res = await fetch(apiBase + homeMissionEndpoint, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      if (!res.ok) throw new Error("fan-engagement-missions-unavailable");
      const data = await res.json();
      return normalizeMissionResponse(data);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function renderStateMessage(root, message, state) {
    root.dataset.state = state;
    root.innerHTML = `<div class="fan-mission-empty" data-state="${escapeHtml(state)}">${escapeHtml(message)}</div>`;
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
        <button class="fan-mission-cta" type="button" disabled>${escapeHtml(stateCopy.cta)}</button>
      </article>
    `;
  }

  function renderMissionList(root, missions, state) {
    root.dataset.state = state;
    root.innerHTML = missions.map(renderMissionCard).join("");
  }

  async function renderHomeMissionTeaser() {
    const root = document.getElementById("homeMissionTeaser");
    if (!root) return;

    renderStateMessage(root, neutral.loading || "오늘의 팬 미션을 불러오고 있어요.", "loading");

    try {
      const missions = await loadHomeMissions();
      if (!missions.length) {
        renderStateMessage(root, neutral.empty || "오늘 참여할 팬 미션을 준비하고 있어요.", "empty");
        return;
      }
      renderMissionList(root, missions, "loaded");
    } catch (_) {
      const fallbackMissions = normalizeMissionResponse(homeMissionFixture);
      if (!fallbackMissions.length) {
        renderStateMessage(root, neutral.error || "미션 정보를 확인하고 있어요.", "error");
        return;
      }
      root.dataset.state = "fallback";
      root.innerHTML = `
        <div class="fan-mission-notice">${escapeHtml(neutral.error || "미션 정보를 불러오지 못해 준비된 예시를 먼저 보여드려요.")}</div>
        ${fallbackMissions.map(renderMissionCard).join("")}
      `;
    }
  }

  renderHomeMissionTeaser();
})();
