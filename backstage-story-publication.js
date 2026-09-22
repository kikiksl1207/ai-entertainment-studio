(function () {
  "use strict";

  const api = window.LuminaBackstageApi;
  const endpoint = "/api/v1/admin/api/v1/backstage/story-publication/submissions";
  const knownStories = [
    {
      key: "imjin",
      title: "임진왜란",
      checksums: ["34e2f00f1c375ca5a5af6733f74287224f3d63213a0981e4bc3655b6ed7db125"]
    },
    {
      key: "norse",
      title: "북유럽신화",
      checksums: [
        "74462e693982cbb72733b3db465e435c008309dbcb76c603b908ed1369cb37f8",
        "f6482c710acbc7b63f98783f3ca7f06ebc37d22f5566deb51e719f438eae6bc5"
      ]
    }
  ];
  const state = { items: [], loading: false, loaded: false, promotingId: null, uploadingKey: null };

  const list = document.getElementById("storyPublicationSubmissionList");
  const statusCards = document.getElementById("storyPublicationStatusCards");
  const status = document.getElementById("storyPublicationState");
  const badge = document.getElementById("storyPublicationCountBadge");
  const refreshButton = document.getElementById("storyPublicationRefreshButton");
  const sectionLink = document.querySelector('.sidebar-nav a[href="#story-publication"]');
  const dashboard = document.getElementById("backstageDashboardView");
  const dashboardMain = document.querySelector(".dashboard-main");
  const uploadForms = [...document.querySelectorAll("[data-story-upload-form]")];

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizedChecksum(value) {
    const checksum = typeof value === "string" ? value.trim().toLowerCase() : "";
    return /^[a-f0-9]{64}$/.test(checksum) ? checksum : "";
  }

  function identify(item) {
    const uploaded = new Set((Array.isArray(item?.files) ? item.files : [])
      .filter((file) => file?.category === "manuscript")
      .map((file) => normalizedChecksum(file?.checksumSha256))
      .filter(Boolean));
    const matches = knownStories.filter((story) => story.checksums.every((checksum) => uploaded.has(checksum)));
    if (matches.length !== 1 || (item?.detectedStoryKey && item.detectedStoryKey !== matches[0].key)) {
      return { readiness: "blocked", story: null };
    }
    const story = matches[0];
    return { readiness: story ? "ready" : "blocked", story };
  }

  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return "-";
    if (bytes < 1024) return `${bytes.toLocaleString("ko-KR")} B`;
    const units = ["KB", "MB", "GB"];
    let size = bytes / 1024;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${size.toLocaleString("ko-KR", { maximumFractionDigits: 1 })} ${units[unit]}`;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
  }

  function shortChecksum(value) {
    const checksum = normalizedChecksum(value);
    return checksum ? checksum.slice(0, 12) : "-";
  }

  function statusLabel(value) {
    const labels = {
      received: "접수됨",
      processing: "확인 중",
      ready: "준비됨",
      promoted: "승격 완료",
      published: "공개 완료",
      rejected: "반려",
      failed: "실패"
    };
    return labels[value] || value || "상태 미확인";
  }

  function statusClass(value) {
    if (value === "promoted") return "is-approved";
    if (value === "rejected" || value === "failed") return "is-blocked";
    if (value === "processing") return "is-review";
    return "is-pending";
  }

  function storyState(story) {
    const candidates = state.items
      .filter((item) => identify(item).story?.key === story.key)
      .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));
    const promoted = candidates.find((item) => Boolean(item.promotedWorkId) || item.status === "promoted");
    if (promoted) return { label: "승격 완료", className: "is-approved", detail: "StoryWork 연결 완료" };
    if (candidates.length) return { label: "승격 준비", className: "is-review", detail: "정확한 원고 SHA 확인" };
    return { label: "접수 없음", className: "is-pending", detail: "일치하는 운영 업로드 없음" };
  }

  function renderStoryStatus() {
    if (!statusCards) return;
    statusCards.innerHTML = knownStories.map((story) => {
      const current = storyState(story);
      return `<article class="story-publication-status-item">
        <div><span>대상 작품</span><h3>${escapeHtml(story.title)}</h3></div>
        <div class="story-publication-status-result">
          <span class="status-badge ${current.className}">${escapeHtml(current.label)}</span>
          <small>${escapeHtml(current.detail)}</small>
        </div>
      </article>`;
    }).join("");
  }

  function fileHtml(file) {
    return `<li>
      <span>${escapeHtml(file?.category || "file")} · ${escapeHtml(file?.extension || "-")}</span>
      <span>${escapeHtml(formatBytes(file?.fileSizeBytes))}</span>
      <code title="체크섬 앞 12자리">${escapeHtml(shortChecksum(file?.checksumSha256))}</code>
    </li>`;
  }

  function submissionHtml(item) {
    const identification = identify(item);
    const story = identification.story;
    const promoted = Boolean(item?.promotedWorkId) || item?.status === "promoted";
    const canConfirm = identification.readiness === "ready" && !promoted;
    const busy = state.promotingId === item?.id;
    const files = Array.isArray(item?.files) ? item.files : [];
    const identificationLabel = story ? `${story.title} 원고 일치` : "알려진 최종 원고와 불일치";
    const identificationClass = story ? "is-approved" : "is-blocked";
    // Rendering resets confirmations, so promotion always starts disabled.
    const disabled = " disabled";
    return `<article class="story-submission-card" data-submission-id="${escapeHtml(item?.id)}" data-story-key="${escapeHtml(story?.key || "")}">
      <header class="story-submission-head">
        <div class="story-submission-heading">
          <span class="status-badge ${statusClass(item?.status)}">${escapeHtml(statusLabel(item?.status))}</span>
          <h3>${escapeHtml(item?.title || "제목 없음")}</h3>
          <small>${escapeHtml(formatDate(item?.createdAt))}</small>
        </div>
        <span class="story-identification ${identificationClass}">${escapeHtml(identificationLabel)}</span>
      </header>
      <dl class="story-submission-facts">
        <div><dt>언어</dt><dd>${escapeHtml(item?.originalLocale || "-")}</dd></div>
        <div><dt>원천 분류</dt><dd>${escapeHtml(item?.sourceClass || "-")}</dd></div>
        <div><dt>전체 크기</dt><dd>${escapeHtml(formatBytes(item?.totalBytes))}</dd></div>
        <div><dt>승격 상태</dt><dd>${promoted ? "StoryWork 연결 완료" : "미승격"}</dd></div>
      </dl>
      <div class="story-submission-files">
        <strong>접수 파일</strong>
        <ul>${files.length ? files.map(fileHtml).join("") : "<li>파일 정보 없음</li>"}</ul>
      </div>
      <fieldset class="story-publication-confirmations"${canConfirm ? "" : " disabled"}>
        <legend>공개 전 최종 확인</legend>
        <label><input type="checkbox" data-story-confirmation="manuscript" /> 최종 원고가 맞음을 확인했습니다.</label>
        <label><input type="checkbox" data-story-confirmation="rights" /> 공개에 필요한 권리를 확인했습니다.</label>
        <label><input type="checkbox" data-story-confirmation="release" /> 공개 릴리스 진행을 확인했습니다.</label>
      </fieldset>
      <div class="story-submission-action">
        <p class="form-status" data-story-submission-status role="status" aria-live="polite">${story ? "세 항목을 직접 확인하면 승격할 수 있습니다." : "정확한 원고 SHA가 식별되지 않아 승격할 수 없습니다."}</p>
        <button class="primary-action story-promote-button" type="button" data-story-promote${disabled}>${busy ? "승격 중..." : promoted ? "승격 완료" : "StoryWork/Release로 승격"}</button>
      </div>
    </article>`;
  }

  function render() {
    if (!list) return;
    if (state.loading && !state.loaded) {
      list.innerHTML = '<p class="story-publication-empty">접수 목록을 불러오는 중입니다.</p>';
    } else if (!state.items.length) {
      list.innerHTML = '<p class="story-publication-empty">표시할 운영 업로드 접수가 없습니다.</p>';
    } else {
      list.innerHTML = state.items.map(submissionHtml).join("");
    }
    if (badge) badge.textContent = String(state.items.filter((item) => !item.promotedWorkId && item.status !== "promoted").length);
    renderStoryStatus();
  }

  function setStatus(message, type) {
    if (!status) return;
    status.textContent = message || "";
    status.className = `form-status${type ? ` is-${type}` : ""}`;
  }

  async function load(options) {
    if (!api || !list || state.loading) return;
    if (state.loaded && !options?.force) return;
    state.loading = true;
    setStatus("접수 상태를 확인하고 있습니다.");
    render();
    try {
      const response = await api.fetch(endpoint, { auth: true });
      if (!response || !Array.isArray(response.items)) throw new Error("접수 목록 응답 형식이 올바르지 않습니다.");
      state.items = response.items;
      state.loaded = true;
      setStatus(`${state.items.length.toLocaleString("ko-KR")}건을 확인했습니다.`, "success");
    } catch (error) {
      state.items = [];
      state.loaded = false;
      setStatus(error?.status === 403 ? "스토리 공개 관리 권한이 없습니다." : (error?.message || "접수 목록을 불러오지 못했습니다."), "error");
    } finally {
      state.loading = false;
      render();
    }
  }

  async function upload(form) {
    if (!api || state.uploadingKey) return;
    const storyKey = form.dataset.storyUploadForm;
    const story = knownStories.find((candidate) => candidate.key === storyKey);
    const input = form.querySelector('input[type="file"]');
    const inlineStatus = form.querySelector("[data-story-upload-status]");
    const button = form.querySelector('button[type="submit"]');
    const expectedCount = storyKey === "norse" ? 2 : 1;
    if (!story || !input || input.files.length !== expectedCount) {
      if (inlineStatus) {
        inlineStatus.textContent = `${expectedCount}개 파일을 선택해 주세요.`;
        inlineStatus.className = "form-status is-error";
      }
      return;
    }

    state.uploadingKey = storyKey;
    button.disabled = true;
    button.textContent = "등록 중...";
    button.setAttribute("aria-busy", "true");
    if (inlineStatus) {
      inlineStatus.textContent = "파일 체크섬을 확인하고 안전하게 접수하고 있습니다.";
      inlineStatus.className = "form-status";
    }
    try {
      await api.fetch(endpoint, {
        method: "POST",
        auth: true,
        body: new FormData(form)
      });
      form.reset();
      if (inlineStatus) {
        inlineStatus.textContent = `${story.title} 최종본을 접수했습니다.`;
        inlineStatus.className = "form-status is-success";
      }
      state.loaded = false;
      await load({ force: true });
    } catch (error) {
      if (inlineStatus) {
        inlineStatus.textContent = error?.message || "최종본 접수에 실패했습니다.";
        inlineStatus.className = "form-status is-error";
      }
    } finally {
      state.uploadingKey = null;
      button.disabled = false;
      button.textContent = "접수 등록";
      button.removeAttribute("aria-busy");
    }
  }

  function updatePromotionButton(card) {
    const button = card?.querySelector("[data-story-promote]");
    if (!button) return;
    const item = state.items.find((candidate) => String(candidate.id) === card.dataset.submissionId);
    const ready = identify(item).readiness === "ready" && !item?.promotedWorkId && item?.status !== "promoted";
    const confirmations = [...card.querySelectorAll("[data-story-confirmation]")];
    button.disabled = !ready || confirmations.length !== 3 || confirmations.some((input) => !input.checked) || Boolean(state.promotingId);
  }

  async function promote(button) {
    const card = button.closest("[data-submission-id]");
    const item = state.items.find((candidate) => String(candidate.id) === card?.dataset.submissionId);
    const identification = identify(item);
    const confirmations = [...(card?.querySelectorAll("[data-story-confirmation]") || [])];
    if (!item || identification.readiness !== "ready" || !identification.story || confirmations.length !== 3 ||
        confirmations.some((input) => !input.checked) || item.promotedWorkId || item.status === "promoted") return;

    state.promotingId = String(item.id);
    const inlineStatus = card.querySelector("[data-story-submission-status]");
    button.disabled = true;
    button.textContent = "승격 중...";
    button.setAttribute("aria-busy", "true");
    if (inlineStatus) inlineStatus.textContent = "확인된 접수를 승격하고 있습니다.";
    try {
      await api.fetch(`${endpoint}/${encodeURIComponent(item.id)}/promote`, {
        method: "POST",
        auth: true,
        body: {
          storyKey: identification.story.key,
          finalManuscriptConfirmed: true,
          rightsConfirmed: true,
          publicReleaseConfirmed: true
        }
      });
      setStatus(`${identification.story.title} 접수를 승격했습니다.`, "success");
      state.loaded = false;
      await load({ force: true });
    } catch (error) {
      if (inlineStatus) {
        inlineStatus.textContent = error?.message || "승격 요청을 처리하지 못했습니다.";
        inlineStatus.className = "form-status is-error";
      }
      button.disabled = false;
      button.textContent = "StoryWork/Release로 승격";
      button.removeAttribute("aria-busy");
    } finally {
      state.promotingId = null;
      updatePromotionButton(card);
    }
  }

  list?.addEventListener("change", (event) => {
    if (event.target.matches("[data-story-confirmation]")) updatePromotionButton(event.target.closest("[data-submission-id]"));
  });
  list?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-story-promote]");
    if (button) promote(button);
  });
  refreshButton?.addEventListener("click", () => load({ force: true }));
  uploadForms.forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      upload(form);
    });
  });
  sectionLink?.addEventListener("click", () => {
    window.setTimeout(() => {
      if (dashboardMain?.dataset.activeSection === "story-publication") load();
    }, 0);
  });

  if (dashboardMain) {
    new MutationObserver(() => {
      if (!dashboard?.classList.contains("is-hidden") && dashboardMain.dataset.activeSection === "story-publication") load();
    }).observe(dashboardMain, { attributes: true, attributeFilter: ["data-active-section"] });
  }
  if (dashboard) {
    new MutationObserver(() => {
      if (!dashboard.classList.contains("is-hidden") && dashboardMain?.dataset.activeSection === "story-publication") load();
    }).observe(dashboard, { attributes: true, attributeFilter: ["class"] });
  }

  render();
})();
