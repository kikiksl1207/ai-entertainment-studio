(function () {
  "use strict";

  const fallbackCopy = window.LuminaFanEngagementCopy || {};
  const neutral = fallbackCopy.neutral || {};

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

  function labelFromKey(key, fallback) {
    if (!key) return fallback;
    return fallbackCopy.labelsByKey?.[key] || fallback;
  }

  function copyLabel(copy, labelName, keyName, fallback) {
    const localized = copy?.labels?.ko?.[labelName];
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

  function renderMissionCard(mission) {
    const copy = mission?.copy || {};
    const title = copyLabel(copy, "title", "titleKey", neutral.title || "오늘의 팬 미션");
    const description = copyLabel(copy, "description", "descriptionKey", neutral.description || "아티스트에게 작은 응원 신호를 보내보세요.");
    const cta = copyLabel(copy, "cta", "ctaKey", neutral.cta || "참여하기");
    const artistName = mission?.artist?.displayName || "Lumina Stage";
    const status = missionStatusLabel(mission?.status);
    const type = missionTypeLabel(mission?.missionType);
    const participation = participationLabel(mission?.participation);
    const reward = rewardLabel(mission?.rewardPreview);

    return `
      <article class="fan-mission-card" data-mission-id="${escapeHtml(mission?.id)}">
        <div class="fan-mission-card-head">
          <span class="fan-mission-type">${escapeHtml(type)}</span>
          <span class="fan-mission-status">${escapeHtml(status)}</span>
        </div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(description)}</p>
        <div class="fan-mission-meta">
          <span>${escapeHtml(artistName)}</span>
          <span>${escapeHtml(participation)}</span>
          <span>${escapeHtml(reward)}</span>
        </div>
        <button class="fan-mission-cta" type="button" disabled>${escapeHtml(cta)}</button>
      </article>
    `;
  }

  function renderHomeMissionTeaser() {
    const root = document.getElementById("homeMissionTeaser");
    if (!root) return;
    const missions = Array.isArray(homeMissionFixture.items) ? homeMissionFixture.items.slice(0, 3) : [];
    if (!missions.length) {
      root.innerHTML = `<div class="fan-mission-empty">${escapeHtml(neutral.status || "확인 중")}</div>`;
      return;
    }
    root.innerHTML = missions.map(renderMissionCard).join("");
  }

  renderHomeMissionTeaser();
})();
