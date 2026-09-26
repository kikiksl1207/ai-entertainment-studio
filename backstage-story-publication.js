(function () {
  "use strict";

  const api = window.LuminaBackstageApi;
  const publicationEndpoint = "/admin/api/v1/backstage/story-publication";
  const endpoint = `${publicationEndpoint}/submissions`;
  const knownStories = [
    {
      key: "imjin",
      title: "임진왜란",
      slug: "records-of-the-burning-sea-imjin-war",
      checksums: ["34e2f00f1c375ca5a5af6733f74287224f3d63213a0981e4bc3655b6ed7db125"],
      aiActivationAvailable: true
    },
    {
      key: "norse",
      title: "북유럽신화",
      slug: "norse-myth-loki-crossroads",
      checksums: [
        "74462e693982cbb72733b3db465e435c008309dbcb76c603b908ed1369cb37f8",
        "f6482c710acbc7b63f98783f3ca7f06ebc37d22f5566deb51e719f438eae6bc5"
      ],
      aiActivationAvailable: true
    },
    {
      key: "monster",
      title: "내 이름을 먹지 않은 괴물",
      slug: "the-monster-that-did-not-eat-my-name",
      checksums: [
        "e5c3e0719995380e2544062a83dceb43c4811ff7c9029ca81b15ba4a3c1b4bff",
        "ba2763caa77bb52bd56a216b1852b2be9241314019015624a65ab128df25e033"
      ],
      aiActivationAvailable: true,
      visualIdentityManaged: true
    },
    {
      key: "rebellion",
      title: "우리는 서로의 몸에 반역을 썼다",
      slug: "we-wrote-rebellion-on-each-others-bodies",
      checksums: [
        "9c855d771b9e2d89ef8b36b7a445b0fa62bf854738bb2d78becb12284f16ecff",
        "fb1ecc405c2471035fdfc85fec17f4e4d883334e2928d898eec988188ec1a5c3"
      ],
      aiActivationAvailable: true,
      visualIdentityManaged: true
    },
    {
      key: "inheritor",
      title: "살인자는 죽은 자의 능력을 계승한다",
      slug: "the-killer-inherits-the-dead",
      checksums: [
        "3f8243a8e5f973c9aa21aa06b5b7aa94ea9717b1bd53629f71f6805b74d1dfaf",
        "c948fd717e358eb4dd4a6822df95ba206455d108f2781ecb3f85fc6fc0474326"
      ],
      aiActivationAvailable: true,
      visualIdentityManaged: true
    }
  ];
  const state = { items: [], publishedWorks: [], aiStatuses: {}, visualStatuses: {}, choiceStatuses: {}, loading: false, loaded: false, promotingId: null, uploadingKey: null, activatingKey: null, replacingKey: null, preparingChoices: false };

  function matchesPublishedStory(work, story) {
    if (!work || !story || work.status !== "published") return false;
    return story.key === "inheritor"
      ? work.slug?.startsWith(`${story.slug}-`)
      : work.slug === story.slug;
  }

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
    if (state.publishedWorks.some((work) => matchesPublishedStory(work, story))) {
      const ai = state.aiStatuses[story.key];
      if (story.aiActivationAvailable && (!ai || ai.status === "unavailable")) {
        return { published: true, label: "원고 공개 / AI 분기 확인 필요", className: "is-review", detail: "원고는 독자 화면에 공개 중" };
      }
      if (story.aiActivationAvailable && (ai.status !== "active" || ai.active !== true)) {
        return { published: true, label: "원고 공개 / AI 분기 미활성", className: "is-review", detail: "원고는 독자 화면에 공개 중" };
      }
      if (story.aiActivationAvailable) {
        return { published: true, label: "원고 공개 / AI 생성 활성", className: "is-approved", detail: "분기 장면은 독자 선택 후 생성" };
      }
      return { published: true, label: "공개 완료", className: "is-approved", detail: "독자 화면에 공개 중" };
    }
    const candidates = state.items
      .filter((item) => identify(item).story?.key === story.key)
      .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));
    const promoted = candidates.find((item) => Boolean(item.promotedWorkId) || item.status === "promoted");
    if (promoted) return { label: "승격 완료", className: "is-approved", detail: "StoryWork 연결 완료" };
    if (candidates.length) return { label: "승격 준비", className: "is-review", detail: "정확한 원고 SHA 확인" };
    return { label: "접수 없음", className: "is-pending", detail: "일치하는 운영 업로드 없음" };
  }

  function fixedVisualControls(story, visual) {
    const busy = state.replacingKey === story.key;
    const unavailable = visual?.status === "unavailable";
    const readyCount = Number(visual?.readyCount || 0);
    const staleCount = Number(visual?.staleCount || 0);
    const label = unavailable ? "확인 필요" : staleCount > 0 ? `${staleCount.toLocaleString("ko-KR")}장 교체 필요` : readyCount > 0 ? "표지 기준 일치" : "생성된 장면 없음";
    const className = unavailable || staleCount > 0 ? "is-review" : "is-approved";
    const description = unavailable
      ? "기존 그림 상태를 불러오지 못했습니다."
      : staleCount > 0
        ? "표지와 같은 화풍·인물 기준으로 남은 옛 그림을 순서대로 모두 교체합니다."
        : readyCount > 0
          ? "현재 생성된 장면 그림이 최신 작품 기준과 일치합니다."
          : "독자가 장면에 도달하면 작품 기준에 맞춰 그림을 생성합니다.";
    const staleItems = Array.isArray(visual?.items) ? visual.items : [];
    const assetBase = String(window.LUMINA_API_BASE || "https://api.lumina-stage.com").replace(/\/$/, "");
    return `<section class="story-ai-activation story-visual-consistency" data-story-visual-card="${escapeHtml(story.key)}">
      <div><strong>장면 그림 일관성</strong><span class="status-badge ${className}">${escapeHtml(label)}</span></div>
      <small>${escapeHtml(description)}</small>
      ${staleItems.length ? `<div class="story-visual-review-list">${staleItems.map((item) => {
        const assetId = /^[a-f0-9-]{36}$/i.test(item.assetId || "") ? item.assetId : "";
        return `<div class="story-visual-review-row">
          ${assetId ? `<img loading="lazy" src="${escapeHtml(assetBase)}/api/v1/story-visual-assets/${escapeHtml(assetId)}" alt="교체 전 장면 그림" />` : ""}
          <code>${escapeHtml(item.sourceSceneKey || "")}</code>
          <button type="button" class="story-visual-review-button" data-story-visual-replace="${escapeHtml(story.key)}" data-story-visual-scene="${escapeHtml(item.sourceSceneKey || "")}" ${busy ? "disabled" : ""}>이 그림 교체</button>
        </div>`;
      }).join("")}</div>` : ""}
      ${staleCount > 0 ? `<button type="button" class="primary-action story-visual-replace-button" data-story-visual-replace="${escapeHtml(story.key)}" ${busy ? "disabled" : ""}>${busy ? "교체 중..." : `남은 ${staleCount.toLocaleString("ko-KR")}장 전체 교체`}</button>` : ""}
      <p class="form-status" data-story-visual-status role="status" aria-live="polite"></p>
    </section>`;
  }

  function renderStoryStatus() {
    if (!statusCards) return;
    statusCards.innerHTML = knownStories.map((story) => {
      const current = storyState(story);
      const published = current.published === true;
      const ai = state.aiStatuses[story.key];
      const aiActive = ai?.status === "active" && ai.active === true;
      const aiUnavailable = !ai || ai.status === "unavailable";
      const busy = state.activatingKey === story.key;
      const fixedChoicePreparation = (story.key === "monster" || story.key === "rebellion") ? ai?.choicePreparation : null;
      const fixedChoicesPending = fixedChoicePreparation && fixedChoicePreparation.ready !== true;
      const fixedChoicesStaged = fixedChoicePreparation?.phase === "awaiting_promotion";
      const visual = state.visualStatuses[story.key];
      const choiceStatus = state.choiceStatuses[story.key];
      const choicesReady = story.key !== "inheritor" || choiceStatus?.status === "ready";
      const choiceControls = story.key === "inheritor" && published ? `<section class="story-ai-activation" data-story-choice-card>
        <div><strong>파트별 선택지</strong><span class="status-badge ${choicesReady ? "is-approved" : "is-review"}">${choicesReady ? "준비 완료" : "준비 필요"}</span></div>
        <small>${choiceStatus?.totalParts ? `${Number(choiceStatus.preparedParts || 0).toLocaleString("ko-KR")} / ${Number(choiceStatus.totalParts).toLocaleString("ko-KR")}파트에 선택지 3개 준비` : "선택지 상태를 확인하고 있습니다."}</small>
        ${choiceStatus?.slug ? `<a class="story-preview-link" href="/story-stage?slug=${encodeURIComponent(choiceStatus.slug)}" target="_blank" rel="noopener noreferrer">독자 화면 확인</a>` : ""}
        ${!choicesReady ? `<button type="button" class="primary-action" data-story-prepare-choices ${state.preparingChoices ? "disabled" : ""}>${state.preparingChoices ? "준비 중..." : "남은 선택지 준비"}</button>` : ""}
        <p class="form-status" data-story-choice-status role="status" aria-live="polite"></p>
      </section>` : "";
      return `<article class="story-publication-status-item">
        <div class="story-publication-status-title"><span>대상 작품</span><h3>${escapeHtml(story.title)}</h3></div>
        <div class="story-publication-status-result">
          <span class="status-badge ${current.className}">${escapeHtml(current.label)}</span>
          <small>${escapeHtml(current.detail)}</small>
        </div>
        ${choiceControls}
        ${published && story.aiActivationAvailable ? `<section class="story-ai-activation" data-story-ai-card="${escapeHtml(story.key)}">
          <div><strong>AI 분기 생성</strong><span class="status-badge ${aiActive ? "is-approved" : "is-review"}">${aiActive ? "활성" : aiUnavailable ? "확인 필요" : "비활성"}</span></div>
          ${aiActive ? `<small>독자가 선택하면 새 장면을 생성합니다. 분기 장면이 미리 생성된 상태는 아닙니다.</small>` : ""}
          ${fixedChoicePreparation ? `<small>${Number(fixedChoicePreparation.preparedParts || 0).toLocaleString("ko-KR")} / ${Number(fixedChoicePreparation.totalParts || 0).toLocaleString("ko-KR")}파트 선택지 준비${fixedChoicesPending ? " · 기존 선택지는 독자에게 계속 공개 중" : ""}</small>` : ""}
          <fieldset class="story-ai-confirmations" ${busy ? "disabled" : ""}>
            <legend>${aiActive ? "설정 갱신 확인" : "활성화 전 확인"}</legend>
            <label><input type="checkbox" data-story-ai-confirm /> 원고 기반 AI 분기 생성을 승인했습니다.</label>
            <label><input type="checkbox" data-story-ai-confirm /> 작가 문체 참고를 승인했습니다.</label>
            <label><input type="checkbox" data-story-ai-confirm /> 검수된 동일 결과 재사용을 승인했습니다.</label>
            <label><input type="checkbox" data-story-ai-confirm /> 장면 이미지 변환을 승인했습니다.</label>
          </fieldset>
          <button type="button" class="primary-action story-ai-activate-button" data-story-ai-activate="${escapeHtml(story.key)}" disabled>${busy ? "설정 중..." : fixedChoicesStaged ? "준비된 선택지 적용" : fixedChoicesPending ? "다음 최대 8파트 준비" : aiActive ? "AI 설정 갱신" : "AI 분기 활성화"}</button>${!choicesReady ? "<small>선택지 3개 준비가 끝나면 활성화할 수 있습니다.</small>" : ""}
          <p class="form-status" data-story-ai-status role="status" aria-live="polite"></p>
        </section>${story.visualIdentityManaged ? fixedVisualControls(story, visual) : ""}` : published ? `<div class="story-fixed-release-controls"><section class="story-ai-activation"><div><strong>독자 공개 방식</strong><span class="status-badge is-approved">고정 메인 루트</span></div><small>작가 최종 원고 순서대로 공개되며 시스템의 다음 장 이동만 제공합니다.</small></section>${story.visualIdentityManaged ? fixedVisualControls(story, visual) : ""}</div>` : ""}
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
      state.publishedWorks = Array.isArray(response.publishedWorks) ? response.publishedWorks : [];
      const [aiStatuses, visualStatuses] = await Promise.all([Promise.all(knownStories.filter((story) => story.aiActivationAvailable).map(async (story) => {
        try {
          return [story.key, await api.fetch(`${publicationEndpoint}/published/${encodeURIComponent(story.key)}/ai-status`, { auth: true })];
        } catch {
          return [story.key, { active: false, status: "unavailable" }];
        }
      })), Promise.all(knownStories.filter((story) => story.visualIdentityManaged).map(async (story) => {
        const work = state.publishedWorks.find((candidate) => matchesPublishedStory(candidate, story));
        if (!work?.id) return [story.key, { status: "unavailable", readyCount: 0, staleCount: 0, items: [] }];
        try {
          return [story.key, await api.fetch(`/admin/api/v1/story-visuals/${encodeURIComponent(work.id)}/replacement-status`, { auth: true })];
        } catch {
          return [story.key, { status: "unavailable", readyCount: 0, staleCount: 0, items: [] }];
        }
      }))]);
      state.aiStatuses = Object.fromEntries(aiStatuses);
      state.visualStatuses = Object.fromEntries(visualStatuses);
      if (state.publishedWorks.some((work) => matchesPublishedStory(work, knownStories.find((story) => story.key === "inheritor")))) {
        try {
          state.choiceStatuses.inheritor = await api.fetch(`${publicationEndpoint}/published/inheritor/choice-status`, { auth: true });
        } catch {
          state.choiceStatuses.inheritor = { status: "unavailable" };
        }
      }
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
    const expectedCount = storyKey === "imjin" ? 1 : 2;
    const validFileCount = storyKey === "norse"
      ? input && (input.files.length === 1 || input.files.length === 2)
      : input && input.files.length === expectedCount;
    if (!story || !validFileCount) {
      if (inlineStatus) {
        inlineStatus.textContent = storyKey === "norse"
          ? "원본 JSON 2개 또는 승인 압축 묶음 1개를 선택해 주세요."
          : storyKey === "imjin"
            ? "승인 최종 원고 MD 1개를 선택해 주세요."
            : "독자 공개 원고와 장면 이미지 프롬프트 MD 2개를 함께 선택해 주세요.";
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
      const confirmations = {
        storyKey,
        finalManuscriptConfirmed: true,
        rightsConfirmed: true,
        publicReleaseConfirmed: true
      };
      const sourceFile = input.files[0];
      const useChunkedUpload = storyKey === "norse" && input.files.length === 1 && sourceFile.size > 512 * 1024;
      let result;
      if (useChunkedUpload) {
        result = await api.fetch(`${endpoint}/publish-approved/start`, {
          method: "POST",
          auth: true,
          body: confirmations
        });
        if (result?.status === "uploading") {
          const chunkSize = 512 * 1024;
          const totalChunks = Math.ceil(sourceFile.size / chunkSize);
          for (let position = 0; position < totalChunks; position += 1) {
            if (inlineStatus) {
              inlineStatus.textContent = `승인 원고를 안전하게 나눠 전송하고 있습니다. ${position + 1}/${totalChunks}`;
            }
            const chunkPayload = new FormData();
            const start = position * chunkSize;
            const chunk = sourceFile.slice(start, Math.min(start + chunkSize, sourceFile.size));
            chunkPayload.append("chunk", chunk, `${sourceFile.name}.part-${position + 1}`);
            result = await api.fetch(
              `${endpoint}/jobs/${encodeURIComponent(result.jobId)}/source-chunks/${position}`,
              {
                method: "POST",
                auth: true,
                headers: { "X-Total-Chunks": String(totalChunks) },
                body: chunkPayload
              }
            );
          }
          if (inlineStatus) inlineStatus.textContent = "승인 원고를 재조립하고 원본 체크섬을 확인하고 있습니다.";
          result = await api.fetch(
            `${endpoint}/jobs/${encodeURIComponent(result.jobId)}/prepare`,
            { method: "POST", auth: true }
          );
        }
      } else {
        const payload = new FormData();
        [...input.files].forEach((file) => payload.append("manuscripts", file));
        payload.append("storyKey", storyKey);
        payload.append("finalManuscriptConfirmed", "true");
        payload.append("rightsConfirmed", "true");
        payload.append("publicReleaseConfirmed", "true");
        result = await api.fetch(`${endpoint}/publish-approved`, {
          method: "POST",
          auth: true,
          body: payload
        });
      }
      const phaseLabels = {
        queued: "공개 데이터를 준비하고 있습니다.",
        preparing_choices: "원고를 분석해 파트별 선택지를 준비하고 있습니다.",
        structuring: "파트와 장면 뼈대를 만들고 있습니다.",
        materializing: "본문, 선택지, 이미지 프롬프트를 넣고 있습니다.",
        finalizing: "독자 공개 상태를 최종 확인하고 있습니다."
      };
      for (let step = 0; result?.status !== "published" && step < 200; step += 1) {
        if (!result?.jobId || result.status === "failed") {
          throw new Error(result?.errorCode || "공개 작업을 이어갈 수 없습니다.");
        }
        if (inlineStatus) {
          const progress = Number.isFinite(Number(result.processedParts)) && Number(result.totalParts) > 0
            ? ` ${Number(result.processedParts).toLocaleString("ko-KR")}/${Number(result.totalParts).toLocaleString("ko-KR")}`
            : "";
          inlineStatus.textContent = `${phaseLabels[result.status] || "공개 작업을 진행하고 있습니다."}${progress}`;
        }
        result = await api.fetch(`${endpoint}/jobs/${encodeURIComponent(result.jobId)}/process`, {
          method: "POST",
          auth: true
        });
      }
      if (result?.status !== "published") throw new Error("공개 작업 단계가 예상보다 많습니다.");
      form.reset();
      if (inlineStatus) {
        inlineStatus.textContent = `${story.title} 최종본을 공개했습니다.`;
        inlineStatus.className = "form-status is-success";
        if (storyKey === "inheritor" && result.work?.slug) {
          const link = document.createElement("a");
          link.href = `/story-stage?slug=${encodeURIComponent(result.work.slug)}`;
          link.textContent = "전용 링크 열기";
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          inlineStatus.append(" ", link);
        }
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
      button.textContent = storyKey === "inheritor" ? "링크 테스트 공개" : "확인 후 바로 공개";
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
      let result = await api.fetch(`${endpoint}/${encodeURIComponent(item.id)}/promote`, {
        method: "POST",
        auth: true,
        body: {
          storyKey: identification.story.key,
          finalManuscriptConfirmed: true,
          rightsConfirmed: true,
          publicReleaseConfirmed: true
        }
      });
      for (let step = 0; result?.jobId && result.status !== "published" && step < 200; step += 1) {
        if (result.status === "failed") throw new Error(result.errorCode || "공개 작업이 중단됐습니다.");
        if (inlineStatus) inlineStatus.textContent = result.status === "preparing_choices"
          ? `원고에 맞는 선택지를 준비하고 있습니다. ${Number(result.processedParts || 0).toLocaleString("ko-KR")} / ${Number(result.totalParts || 0).toLocaleString("ko-KR")}`
          : `원고와 선택지를 공개하고 있습니다. ${Number(result.processedParts || 0).toLocaleString("ko-KR")} / ${Number(result.totalParts || 0).toLocaleString("ko-KR")}`;
        result = await api.fetch(`${endpoint}/jobs/${encodeURIComponent(result.jobId)}/process`, {
          method: "POST", auth: true
        });
      }
      if (result?.jobId && result.status !== "published") throw new Error("공개 작업이 끝나지 않았습니다. 다시 눌러 이어서 진행해 주세요.");
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

  function updateAiActivationButton(card) {
    const button = card?.querySelector("[data-story-ai-activate]");
    if (!button) return;
    const confirmations = [...card.querySelectorAll("[data-story-ai-confirm]")];
    const inheritorNotReady = card?.dataset.storyAiCard === "inheritor" && state.choiceStatuses.inheritor?.status !== "ready";
    button.disabled = Boolean(state.activatingKey) || inheritorNotReady || confirmations.length !== 4 || confirmations.some((input) => !input.checked);
  }

  async function prepareInheritorChoices(button) {
    if (state.preparingChoices) return;
    state.preparingChoices = true;
    const card = button.closest("[data-story-choice-card]");
    const inlineStatus = card?.querySelector("[data-story-choice-status]");
    button.disabled = true;
    button.textContent = "준비 중...";
    try {
      let result = state.choiceStatuses.inheritor;
      for (let step = 0; result?.status !== "ready" && step < 40; step += 1) {
        result = await api.fetch(`${publicationEndpoint}/published/inheritor/prepare-choices`, {
          method: "POST", auth: true
        });
        state.choiceStatuses.inheritor = result;
        if (inlineStatus) inlineStatus.textContent = `${Number(result.preparedParts || 0).toLocaleString("ko-KR")} / ${Number(result.totalParts || 0).toLocaleString("ko-KR")}파트 준비`;
      }
      if (result?.status !== "ready") throw new Error("선택지 준비가 중단됐습니다. 다시 눌러 이어서 진행해 주세요.");
      state.loaded = false;
      await load({ force: true });
      setStatus("모든 파트의 선택지 3개가 준비됐습니다.", "success");
    } catch (error) {
      if (inlineStatus) {
        const reason = error?.body?.error?.details?.reason;
        inlineStatus.textContent = `${error?.message || "선택지 준비에 실패했습니다. 다시 시도하면 이어서 진행합니다."}${reason ? ` (${reason})` : ""}`;
        inlineStatus.className = "form-status is-error";
      }
      button.disabled = false;
      button.textContent = "남은 선택지 준비";
    } finally {
      state.preparingChoices = false;
    }
  }

  async function activateAi(button) {
    const storyKey = button.dataset.storyAiActivate;
    const wasActive = state.aiStatuses[storyKey]?.active === true;
    const card = button.closest("[data-story-ai-card]");
    const inlineStatus = card?.querySelector("[data-story-ai-status]");
    const confirmations = [...(card?.querySelectorAll("[data-story-ai-confirm]") || [])];
    if (!knownStories.some((story) => story.key === storyKey) || confirmations.length !== 4 || confirmations.some((input) => !input.checked) || state.activatingKey) return;
    state.activatingKey = storyKey;
    button.disabled = true;
    button.textContent = "활성화 중...";
    if (inlineStatus) inlineStatus.textContent = "문체 표본, 이용 승인, AI 생성 설정을 연결하고 있습니다.";
    try {
      const result = await api.fetch(`${publicationEndpoint}/published/${encodeURIComponent(storyKey)}/activate-ai`, {
        method: "POST",
        auth: true,
        body: {
          aiBranchGenerationConfirmed: true,
          authorStyleReferenceConfirmed: true,
          generatedResultReuseConfirmed: true,
          imageTransformationConfirmed: true
        }
      });
      const preparing = result?.status === "preparing_choices" && typeof result.active === "boolean";
      const prepared = Number(result?.preparedParts);
      const total = Number(result?.totalParts);
      if (preparing && (!Number.isInteger(prepared) || !Number.isInteger(total) || prepared < 0 || prepared > total ||
        (prepared === total) !== (result.phase === "awaiting_promotion"))) {
        throw new Error("선택지 준비 진행률을 확인하지 못했습니다.");
      }
      if (!preparing && (result?.status !== "active" || result.active !== true)) {
        throw new Error("AI 활성화 결과를 확인하지 못했습니다.");
      }
      state.activatingKey = null;
      state.loaded = false;
      await load({ force: true });
      if (!state.loaded) throw new Error("작업 결과를 받았지만 최신 상태를 다시 확인하지 못했습니다.");
      const title = knownStories.find((story) => story.key === storyKey).title;
      setStatus(preparing
        ? `${title}: ${prepared.toLocaleString("ko-KR")} / ${total.toLocaleString("ko-KR")}파트 준비. ${result.phase === "awaiting_promotion" ? "다음 승인에서 모든 선택지를 한 번에 적용합니다." : "다음 승인에서 이어집니다."}${result.active ? " 기존 AI 활성화는 유지됩니다." : ""}`
        : `${title} AI ${wasActive ? "설정을 갱신" : "분기를 활성화"}했습니다.`, preparing ? "" : "success");
    } catch (error) {
      if (inlineStatus) {
        inlineStatus.textContent = error?.message || "AI 분기를 활성화하지 못했습니다.";
        inlineStatus.className = "form-status is-error";
      }
      button.textContent = wasActive ? "AI 설정 갱신" : "AI 분기 활성화";
      button.disabled = false;
    } finally {
      state.activatingKey = null;
      updateAiActivationButton(card);
    }
  }

  async function replaceStoryVisual(button) {
    const storyKey = button.dataset.storyVisualReplace;
    const story = knownStories.find((candidate) => candidate.key === storyKey && candidate.visualIdentityManaged);
    const visual = state.visualStatuses[storyKey];
    const staleItems = Array.isArray(visual?.items) ? visual.items : [];
    const selectedKey = button.dataset.storyVisualScene;
    const items = selectedKey ? staleItems.filter((item) => item.sourceSceneKey === selectedKey) : staleItems;
    const work = state.publishedWorks.find((candidate) => matchesPublishedStory(candidate, story));
    const card = button.closest("[data-story-visual-card]");
    const inlineStatus = card?.querySelector("[data-story-visual-status]");
    if (!story || !work?.id || !items.length || !visual?.releaseId || !visual?.releaseChecksum || state.replacingKey) return;
    state.replacingKey = storyKey;
    button.disabled = true;
    button.textContent = `0 / ${items.length} 교체 중`;
    if (inlineStatus) inlineStatus.textContent = selectedKey ? "선택한 장면 그림을 새 기준으로 만들고 있습니다." : "표지와 같은 화풍·인물 기준으로 남은 장면 그림을 모두 다시 만들고 있습니다.";
    let completed = 0;
    try {
      for (const item of items) {
        const result = await api.fetch(`/admin/api/v1/story-visuals/${encodeURIComponent(work.id)}/replace-stale`, {
          method: "POST",
          auth: true,
          body: {
            releaseId: visual.releaseId,
            releaseChecksum: visual.releaseChecksum,
            sourceSceneKey: item.sourceSceneKey
          }
        });
        if (result?.status !== "ready") {
          const reasons = {
            generation_disabled: "장면 이미지 생성 설정이 꺼져 있습니다.",
            beta_generation_limit_reached: "현재 테스트 이미지 생성 한도에 도달했습니다.",
            provider_configuration_missing: "이미지 생성 연결 설정을 확인해 주세요."
          };
          throw new Error(reasons[result?.reason] || "장면 그림 교체가 완료되지 않았습니다.");
        }
        completed += 1;
        button.textContent = `${completed} / ${items.length} 교체 중`;
        if (inlineStatus) inlineStatus.textContent = `${completed}장 완료 · ${items.length - completed}장 남음`;
      }
      state.replacingKey = null;
      state.loaded = false;
      await load({ force: true });
      setStatus(`${story.title} 장면 그림 ${completed}장을 새 기준으로 모두 교체했습니다.`, "success");
    } catch (error) {
      if (inlineStatus) {
        inlineStatus.textContent = `${completed}장 교체 후 중단 · ${error?.message || "장면 그림을 교체하지 못했습니다."}`;
        inlineStatus.className = "form-status is-error";
      }
      button.disabled = false;
      button.textContent = `남은 ${Math.max(0, items.length - completed).toLocaleString("ko-KR")}장 다시 교체`;
    } finally {
      state.replacingKey = null;
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
  statusCards?.addEventListener("change", (event) => {
    if (event.target.matches("[data-story-ai-confirm]")) updateAiActivationButton(event.target.closest("[data-story-ai-card]"));
  });
  statusCards?.addEventListener("click", (event) => {
    const choiceButton = event.target.closest("[data-story-prepare-choices]");
    if (choiceButton) return prepareInheritorChoices(choiceButton);
    const aiButton = event.target.closest("[data-story-ai-activate]");
    if (aiButton) return activateAi(aiButton);
    const visualButton = event.target.closest("[data-story-visual-replace]");
    if (visualButton) replaceStoryVisual(visualButton);
  });
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
