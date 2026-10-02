(function () {
  "use strict";

  const api = window.LuminaBackstageApi;
  const publicationEndpoint = "/admin/api/v1/backstage/story-publication";
  const endpoint = `${publicationEndpoint}/submissions`;
  const authorReviewMessage = "비공개 원고로 접수했습니다. 작가 스튜디오에서 원고 분석과 생성 기준 승인을 진행해 주세요.";
  const authorReviewLink = '<a class="story-preview-link" href="/creator-studio">작가 스튜디오 열기</a>';
  const knownStories = [
    {
      key: "imjin",
      title: "임진왜란",
      slug: "records-of-the-burning-sea-imjin-war",
      checksums: ["34e2f00f1c375ca5a5af6733f74287224f3d63213a0981e4bc3655b6ed7db125"],
      aiActivationAvailable: true,
      visualIdentityManaged: true
    },
    {
      key: "norse",
      title: "북유럽신화",
      slug: "norse-myth-loki-crossroads",
      checksums: [
        "74462e693982cbb72733b3db465e435c008309dbcb76c603b908ed1369cb37f8",
        "f6482c710acbc7b63f98783f3ca7f06ebc37d22f5566deb51e719f438eae6bc5"
      ],
      aiActivationAvailable: true,
      visualIdentityManaged: true
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
  const state = { items: [], publishedWorks: [], aiStatuses: {}, visualStatuses: {}, choiceStatuses: {}, choiceCoverage: {}, choiceFeedback: null, choiceTarget: null, choiceSelectionRequired: false, choiceTargetRevision: 0, choiceTargetState: "unselected", choiceTargetMessage: "선택지를 준비할 공개 작품을 선택해 주세요.", inheritorReads: {}, inheritorReadSequence: 0, inheritorConfirmationRevision: 0, inheritorFeedback: {}, fixedReads: {}, fixedReadSequence: 0, fixedAiReviewRevision: 0, fixedAiFeedback: {}, fixedVisualReads: {}, fixedVisualReadSequence: 0, fixedVisualFeedback: {}, catalogRevision: 0, catalogVerified: false, loading: false, loaded: false, promotingId: null, uploadingKey: null, activatingKey: null, replacingKey: null, preparingChoices: false, reviewingBatchId: null };
  const choiceContextRequiredMessage = "이전 작업의 정확한 파트·장면과 생성 기준이 저장되어 있지 않습니다. 옛 작업 범위를 먼저 확인해야 복구 검토와 생성 재시도를 진행할 수 있습니다.";

  function choiceBatchBlocked(batch) {
    return batch?.reviewContextReady === false || ["in_progress", "review_required"].includes(batch?.status);
  }

  function receiveChoiceStatus(value) {
    const batch = state.choiceStatuses.inheritor?.preparationBatch;
    state.choiceStatuses.inheritor = value?.status === "unavailable" && batch?.reviewContextReady === false
      ? { ...value, preparationBatch: batch } : value;
  }

  function choiceErrorCode(error) { return error?.body?.error?.code || error?.body?.code || error?.code; }

  function choicePartLabel(key) {
    const value = String(key ?? "");
    return /^part-\d+$/.test(value) ? value.slice(5) : value;
  }

  function choiceErrorMessage(error, fallback) {
    const messages = {
      STORY_CHOICE_PREPARATION_CONTEXT_REQUIRED: choiceContextRequiredMessage,
      STORY_CHOICE_PREPARATION_CONTEXT_CHANGED: "저장된 작업 범위나 생성 기준이 현재 원고·승인 설정과 달라졌습니다. 현재 원고와 승인된 생성 설정을 확인하고 작업 상태를 다시 확인해 주세요.",
      STORY_CHOICE_PREPARATION_SOURCE_CHANGED: "작업 당시의 원고와 현재 원고가 다릅니다. 원고 변경 내용과 작업 범위를 확인해 주세요.",
      STORY_CHOICE_PREPARATION_SETTINGS_CHANGED: "작업 당시의 생성 설정과 현재 승인된 설정이 다릅니다. 승인된 생성 설정과 작업 범위를 확인해 주세요.",
      STORY_CHOICE_PREPARATION_RETRY_UNAVAILABLE: "이 작업은 현재 생성 재시도가 허용되지 않습니다. 제공자 응답·청구 내역과 작업 상태를 먼저 확인해 주세요."
    };
    const aliases = {
      STORY_PUBLICATION_CHOICE_SOURCE_CHANGED: "STORY_CHOICE_PREPARATION_SOURCE_CHANGED",
      STORY_PUBLICATION_CHOICE_SETTINGS_CHANGED: "STORY_CHOICE_PREPARATION_SETTINGS_CHANGED"
    };
    const code = choiceErrorCode(error);
    const message = messages[aliases[code] || code];
    return message ? `${message} 제공자 응답·청구 확인은 생성 재시도와 별개입니다. 유료 재시도는 별도로 요청해야 합니다.` : error?.message || fallback;
  }

  function recordChoiceError(error, message) {
    state.choiceFeedback = message;
    const batch = state.choiceStatuses.inheritor?.preparationBatch;
    if (batch && choiceErrorCode(error) === "STORY_CHOICE_PREPARATION_CONTEXT_REQUIRED") {
      batch.reviewContextReady = false;
      batch.partKeys = [];
    }
  }

  function matchesPublishedStory(work, story) {
    if (!work || !story || work.status !== "published") return false;
    return story.key === "inheritor"
      ? work.slug?.startsWith(`${story.slug}-`)
      : work.slug === story.slug;
  }

  function inheritorWorks() {
    return state.publishedWorks.filter((work) => matchesPublishedStory(work, knownStories.find((story) => story.key === "inheritor")));
  }

  function inheritorScopeUnconfirmed(storyKey) {
    return storyKey === "inheritor" && !choiceTargetReady();
  }

  function inheritorMutationBusy() {
    return Boolean(state.preparingChoices || state.reviewingBatchId || state.activatingKey || state.replacingKey);
  }

  function inheritorReadsPending() {
    return Object.values(state.inheritorReads).some((read) => read.status === "loading");
  }

  function choiceUuid(value) {
    return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
  }

  function sameChoiceId(left, right) {
    return String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase();
  }

  function clearChoiceRead(nextState, message, preserveFeedback = false) {
    state.choiceTargetRevision += 1;
    state.choiceTargetState = nextState;
    state.choiceTargetMessage = message;
    delete state.choiceStatuses.inheritor;
    delete state.aiStatuses.inheritor;
    delete state.choiceCoverage.inheritor;
    delete state.visualStatuses.inheritor;
    state.inheritorReads = {};
    state.inheritorFeedback = {};
    if (!preserveFeedback) state.choiceFeedback = null;
  }

  function newChoiceTarget(work, allowLegacy) {
    if (!work || typeof work.id !== "string" || !work.id) return null;
    const scoped = choiceUuid(work.id) && choiceUuid(work.activeReleaseId);
    if (!scoped && !(allowLegacy && work.activeReleaseId == null)) return null;
    return { catalogId: work.id, catalogSlug: work.slug, catalogReleaseId: work.activeReleaseId ?? null,
      workId: scoped ? work.id : null, releaseId: scoped ? work.activeReleaseId : null, lastStatus: null };
  }

  function choiceTargetWork(target = state.choiceTarget) {
    if (!target) return null;
    const matches = inheritorWorks().filter((work) => sameChoiceId(work.id, target?.catalogId));
    return matches.length === 1 ? matches[0] : null;
  }

  function choiceTargetStillCurrent(target, revision) {
    const work = choiceTargetWork(target);
    return Boolean(state.catalogVerified && !target?.requiresSelection && state.choiceTarget === target && state.choiceTargetRevision === revision &&
      work && sameChoiceId(work.activeReleaseId, target.catalogReleaseId) &&
      (inheritorWorks().length <= 1 || (choiceUuid(target.workId) && choiceUuid(target.releaseId))));
  }

  function choiceTargetReady() {
    return !state.loading && state.choiceTargetState === "ready" &&
      choiceTargetStillCurrent(state.choiceTarget, state.choiceTargetRevision);
  }

  const inheritorCollections = { ai: "aiStatuses", coverage: "choiceCoverage", visual: "visualStatuses" };

  function matchesTargetPair(value, target) {
    if (target.workId) return choiceUuid(value?.workId) && choiceUuid(value?.releaseId) &&
      sameChoiceId(value.workId, target.workId) && sameChoiceId(value.releaseId, target.releaseId);
    return value?.workId == null && value?.releaseId == null && inheritorWorks().length === 1;
  }

  function validInheritorStatus(kind, value, target) {
    if (!value || value.status === "unavailable") return false;
    if (kind === "visual") {
      const identityMatches = target.workId ? matchesTargetPair(value, target) :
        choiceUuid(target.catalogId) && sameChoiceId(value.workId, target.catalogId) && choiceUuid(value.releaseId);
      return identityMatches && validVisualStatus(value);
    }
    if (!matchesTargetPair(value, target)) return false;
    if (kind === "ai") return ["active", "inactive"].includes(value.status) &&
      typeof value.active === "boolean" && value.active === (value.status === "active");
    const count = (number) => Number.isSafeInteger(number) && number >= 0;
    const distribution = ["zero", "one", "two", "threeValid", "otherOrInvalid"].map((key) => value.distribution?.[key]);
    return value.status === "ready" && count(value.totalScenes) && count(value.totalParts) && count(value.partsWithoutScenes) &&
      value.partsWithoutScenes <= value.totalParts && value.totalScenes >= value.totalParts - value.partsWithoutScenes &&
      (value.totalParts !== value.partsWithoutScenes || value.totalScenes === 0) && distribution.every(count) &&
      distribution.reduce((sum, number) => sum + number, 0) === value.totalScenes &&
      count(value.routeIssues?.duplicateImmediateTargets) && count(value.routeIssues?.invalidDirectTargets);
  }

  function validVisualStatus(value) {
    const items = value?.items;
    return value && (value.status == null || value.status === "ready") &&
      typeof value.releaseChecksum === "string" && /^[a-f0-9]{64}$/i.test(value.releaseChecksum) &&
      Number.isSafeInteger(value.readyCount) && Number.isSafeInteger(value.staleCount) && value.readyCount >= 0 &&
      value.staleCount >= 0 && value.staleCount <= value.readyCount && Array.isArray(items) && items.length <= 80 &&
      items.length === value.staleCount && items.every((item) => typeof item?.sourceSceneKey === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(item.sourceSceneKey)) &&
      new Set(items.map((item) => item.sourceSceneKey)).size === items.length;
  }

  function fixedVisualSource(storyKey) {
    const story = knownStories.find((item) => item.key === storyKey && item.key !== "inheritor");
    const works = state.publishedWorks.filter((item) => matchesPublishedStory(item, story));
    const work = works.length === 1 ? works[0] : null;
    return work && choiceUuid(work.id) && choiceUuid(work.activeReleaseId)
      ? { workId: work.id, releaseId: work.activeReleaseId } : null;
  }

  function fixedVisualSourceCurrent(storyKey, expected) {
    const current = fixedVisualSource(storyKey);
    return state.catalogVerified && expected && current && sameChoiceId(current.workId, expected.workId) &&
      sameChoiceId(current.releaseId, expected.releaseId) && state.catalogRevision === expected.revision;
  }

  function validFixedPreparation(value) {
    const count = (number) => Number.isSafeInteger(number) && number >= 0;
    return value && count(value.totalParts) && value.totalParts > 0 && count(value.preparedParts) &&
      count(value.remainingParts) && value.preparedParts + value.remainingParts === value.totalParts &&
      typeof value.ready === "boolean" && (value.ready
        ? value.phase === "ready" && value.remainingParts === 0
        : value.phase === (value.remainingParts === 0 ? "awaiting_promotion" : "preparing"));
  }

  function fixedStatusVerified(storyKey, kind) {
    const read = state.fixedReads[storyKey]?.[kind];
    const collection = inheritorCollections[kind];
    return ["ai", "coverage"].includes(kind) && !state.loading && read?.status === "verified" &&
      fixedVisualSourceCurrent(storyKey, read) && read.value === state[collection][storyKey] &&
      validInheritorStatus(kind, read.value, read) && (kind !== "ai" ||
        !["monster", "rebellion"].includes(storyKey) || validFixedPreparation(read.value.choicePreparation));
  }

  function markFixedStatusUnknown(storyKey, kind, message) {
    state[inheritorCollections[kind]][storyKey] = { status: "unavailable" };
    if (state.fixedReads[storyKey]?.[kind]) state.fixedReads[storyKey][kind].status = "unknown";
    if (kind === "ai") state.fixedAiFeedback[storyKey] = message;
  }

  async function readFixedStatus(storyKey, kind) {
    if (!["ai", "coverage"].includes(kind)) return null;
    const source = fixedVisualSource(storyKey);
    const read = { ...source, revision: state.catalogRevision, sequence: ++state.fixedReadSequence,
      status: "loading", value: null };
    state.fixedReads[storyKey] ||= {};
    state.fixedReads[storyKey][kind] = read;
    state[inheritorCollections[kind]][storyKey] = { status: "unavailable" };
    if (kind === "ai") delete state.fixedAiFeedback[storyKey];
    try {
      if (!source) throw new Error("Unconfirmed source");
      const query = new URLSearchParams(source);
      const value = await api.fetch(`${publicationEndpoint}/published/${encodeURIComponent(storyKey)}/${kind === "ai" ? "ai-status" : "choice-coverage"}?${query}`, { auth: true });
      if (!fixedVisualSourceCurrent(storyKey, read) || state.fixedReads[storyKey]?.[kind] !== read) return null;
      if (!validInheritorStatus(kind, value, read) || (kind === "ai" &&
        ["monster", "rebellion"].includes(storyKey) && !validFixedPreparation(value.choicePreparation))) {
        throw new Error("Unconfirmed status");
      }
      read.status = "verified";
      read.value = value;
      state[inheritorCollections[kind]][storyKey] = value;
      return value;
    } catch {
      if (state.fixedReads[storyKey]?.[kind] === read && fixedVisualSourceCurrent(storyKey, read)) {
        markFixedStatusUnknown(storyKey, kind, "작품·공개 버전의 AI 상태를 확인하지 못했습니다. 새로고침 후 확인해 주세요.");
      } else if (state.fixedReads[storyKey]?.[kind] === read) read.status = "unknown";
      return null;
    }
  }

  function completeChoiceCoverage(value) {
    return value?.status === "ready" && value.totalParts > 0 && value.partsWithoutScenes === 0 &&
      value.distribution.threeValid === value.totalScenes && value.routeIssues.duplicateImmediateTargets === 0 &&
      value.routeIssues.invalidDirectTargets === 0;
  }

  function fixedAiReady(storyKey) {
    if (!fixedStatusVerified(storyKey, "ai") || !fixedStatusVerified(storyKey, "coverage")) return false;
    const coverage = state.choiceCoverage[storyKey];
    const preparation = state.aiStatuses[storyKey].choicePreparation;
    if (["monster", "rebellion"].includes(storyKey) && preparation.totalParts !== coverage.totalParts) return false;
    return completeChoiceCoverage(coverage) || (["monster", "rebellion"].includes(storyKey) &&
      coverage.totalParts > 0 && preparation.ready === false);
  }

  function fixedAiCardCurrent(card, storyKey) {
    return card?.dataset.storyAiCard === storyKey &&
      card.dataset.storyTargetRevision === String(state.catalogRevision) &&
      card.dataset.storyAiReview === String(state.fixedAiReviewRevision) &&
      card.dataset.storyAiRead === String(state.fixedReads[storyKey]?.ai?.sequence) &&
      card.dataset.storyCoverageRead === String(state.fixedReads[storyKey]?.coverage?.sequence);
  }

  function fixedVisualVerified(storyKey) {
    const read = state.fixedVisualReads[storyKey];
    return !state.loading && read?.status === "verified" && fixedVisualSourceCurrent(storyKey, read) &&
      read.value === state.visualStatuses[storyKey] && matchesTargetPair(read.value, read) && validVisualStatus(read.value);
  }

  function markFixedVisualUnknown(storyKey, message) {
    state.visualStatuses[storyKey] = { status: "unavailable" };
    if (state.fixedVisualReads[storyKey]) state.fixedVisualReads[storyKey].status = "unknown";
    state.fixedVisualFeedback[storyKey] = message;
  }

  async function readFixedVisualStatus(storyKey) {
    const source = fixedVisualSource(storyKey);
    const read = { ...source, revision: state.catalogRevision, sequence: ++state.fixedVisualReadSequence,
      status: "loading", value: null };
    state.fixedVisualReads[storyKey] = read;
    state.visualStatuses[storyKey] = { status: "unavailable" };
    delete state.fixedVisualFeedback[storyKey];
    try {
      if (!source) throw new Error("Unconfirmed source");
      const value = await api.fetch(`/admin/api/v1/story-visuals/${encodeURIComponent(source.workId)}/replacement-status`, { auth: true });
      if (!fixedVisualSourceCurrent(storyKey, read) || state.fixedVisualReads[storyKey] !== read) return null;
      if (!matchesTargetPair(value, read) || !validVisualStatus(value)) throw new Error("Unconfirmed visual status");
      read.status = "verified";
      read.value = value;
      state.visualStatuses[storyKey] = value;
      return value;
    } catch {
      if (state.fixedVisualReads[storyKey] === read) {
        markFixedVisualUnknown(storyKey, "작품·공개 버전의 그림 상태를 확인하지 못했습니다. 새로고침 후 확인해 주세요.");
      }
      return null;
    }
  }

  function inheritorStatusVerified(kind) {
    const read = state.inheritorReads[kind];
    return choiceTargetReady() && read?.status === "verified" && read.target === state.choiceTarget &&
      read.revision === state.choiceTargetRevision && read.value === state[inheritorCollections[kind]].inheritor &&
      validInheritorStatus(kind, read.value, read.target);
  }

  function markInheritorUnknown(kind, message) {
    state[inheritorCollections[kind]].inheritor = { status: "unavailable" };
    if (state.inheritorReads[kind]) state.inheritorReads[kind].status = "unknown";
    state.inheritorFeedback[kind] = message;
  }

  async function readInheritorStatus(kind, target, revision) {
    if (!choiceTargetStillCurrent(target, revision)) return null;
    const read = { target, revision, sequence: ++state.inheritorReadSequence, status: "loading", value: null };
    state.inheritorReads[kind] = read;
    state[inheritorCollections[kind]].inheritor = { status: "unavailable" };
    delete state.inheritorFeedback[kind];
    const query = target.workId ? `?${new URLSearchParams({ workId: target.workId, releaseId: target.releaseId })}` : "";
    const workId = target.workId || target.catalogId;
    const url = kind === "visual" ? `/admin/api/v1/story-visuals/${encodeURIComponent(workId)}/replacement-status` :
      `${publicationEndpoint}/published/inheritor/${kind === "ai" ? "ai-status" : "choice-coverage"}${query}`;
    try {
      if (kind === "visual" && !choiceUuid(workId)) throw new Error("Unknown work ID");
      const value = await api.fetch(url, { auth: true });
      if (!choiceTargetStillCurrent(target, revision) || state.inheritorReads[kind] !== read) return null;
      if (!validInheritorStatus(kind, value, target)) throw new Error("Unverified target status");
      if (kind === "visual" && !target.workId) {
        target.workId = value.workId;
        target.releaseId = value.releaseId;
      }
      read.status = "verified";
      read.value = value;
      state[inheritorCollections[kind]].inheritor = value;
      return value;
    } catch {
      if (choiceTargetStillCurrent(target, revision) && state.inheritorReads[kind] === read) {
        markInheritorUnknown(kind, "선택한 작품·릴리스의 상태를 확인하지 못했습니다. 새로고침 후 확인해 주세요.");
      }
      return null;
    }
  }

  async function readInheritorStatuses(target, revision) {
    const hadPair = Boolean(target.workId);
    await Promise.all(["ai", "coverage", "visual"].map((kind) => readInheritorStatus(kind, target, revision)));
    // A legacy visual read can establish the pair; re-read the other statuses with that exact pair.
    if (!hadPair && target.workId && choiceTargetStillCurrent(target, revision)) {
      await Promise.all(["ai", "coverage"].map((kind) => readInheritorStatus(kind, target, revision)));
    }
  }

  function inheritorAiReady() {
    return !inheritorReadsPending() && inheritorStatusVerified("ai") && inheritorStatusVerified("coverage") &&
      state.choiceStatuses.inheritor?.status === "ready";
  }

  function inheritorVisualReady() {
    return !inheritorReadsPending() && inheritorStatusVerified("visual");
  }

  function inheritorActionSnapshot() {
    const target = state.choiceTarget;
    return { target, revision: state.choiceTargetRevision, workId: target.workId, releaseId: target.releaseId };
  }

  function inheritorActionCurrent(snapshot) {
    return choiceTargetStillCurrent(snapshot.target, snapshot.revision) &&
      sameChoiceId(snapshot.workId, snapshot.target.workId) && sameChoiceId(snapshot.releaseId, snapshot.target.releaseId);
  }

  function reconcileChoiceTarget() {
    const works = inheritorWorks();
    const target = state.choiceTarget;
    if (target) {
      const work = choiceTargetWork(target);
      if (target.requiresSelection || !work ||
        !sameChoiceId(work.activeReleaseId, target.catalogReleaseId) ||
        (works.length > 1 && !target.workId)) {
        target.requiresSelection = true;
        clearChoiceRead("changed", "공개 작품 또는 릴리스가 변경되었습니다. 대상을 다시 선택한 뒤 상태를 확인해 주세요.");
        return false;
      }
      return true;
    }
    if (works.length === 1 && !state.choiceSelectionRequired) state.choiceTarget = newChoiceTarget(works[0], true);
    if (!state.choiceTarget) {
      clearChoiceRead("unselected", works.length === 1 && !state.choiceSelectionRequired
        ? "작품과 공개 릴리스 ID를 확인할 수 없어 생성할 수 없습니다. 목록을 다시 확인해 주세요."
        : "선택지를 준비할 공개 작품을 직접 선택해 주세요. 선택만으로 생성이 시작되지는 않습니다.");
      return false;
    }
    return true;
  }

  function choiceTargetFailure(message) {
    const error = new Error(message);
    error.choiceTargetInvalid = true;
    return error;
  }

  function receiveTargetChoiceStatus(value, target, revision) {
    if (!choiceTargetStillCurrent(target, revision)) return false;
    const hasPair = value?.workId != null || value?.releaseId != null;
    if (hasPair) {
      if (!choiceUuid(value.workId) || !choiceUuid(value.releaseId) ||
        (target.workId && (!sameChoiceId(value.workId, target.workId) || !sameChoiceId(value.releaseId, target.releaseId))) ||
        (!target.workId && choiceUuid(target.catalogId) && !sameChoiceId(value.workId, target.catalogId))) {
        throw choiceTargetFailure("조회 결과의 작품·릴리스가 선택한 대상과 다릅니다. 대상을 다시 선택해 확인해 주세요.");
      }
    } else if (target.workId) {
      throw choiceTargetFailure("조회 결과에서 선택한 작품·릴리스를 확인하지 못했습니다. 생성하지 않고 상태를 다시 확인해 주세요.");
    }
    if (!["ready", "preparing_choices"].includes(value?.status) ||
      !Number.isInteger(value.preparedParts) || !Number.isInteger(value.totalParts) ||
      value.preparedParts < 0 || value.totalParts < 0 || value.preparedParts > value.totalParts) {
      throw choiceTargetFailure("선택지 상태를 확인하지 못했습니다. 목록 새로고침 또는 대상 재선택 후 확인해 주세요.");
    }
    if (hasPair && !target.workId) {
      target.workId = value.workId;
      target.releaseId = value.releaseId;
    }
    receiveChoiceStatus(value);
    target.lastStatus = state.choiceStatuses.inheritor;
    state.choiceTargetState = "ready";
    state.choiceTargetMessage = target.workId ? "확인한 작품과 공개 릴리스에만 선택지를 준비합니다." :
      "단일 작품의 기존 조회 방식입니다. 서버가 작품·릴리스를 알려주면 이후 요청에 고정합니다.";
    return true;
  }

  async function readChoiceTargetStatus(preserveFeedback = false) {
    const target = state.choiceTarget;
    if (!target) return;
    clearChoiceRead("loading", "선택한 작품의 선택지 상태를 확인하고 있습니다.", preserveFeedback);
    const revision = state.choiceTargetRevision;
    const query = target.workId ? `?${new URLSearchParams({ workId: target.workId, releaseId: target.releaseId })}` : "";
    renderStoryStatus();
    try {
      const value = await api.fetch(`${publicationEndpoint}/published/inheritor/choice-status${query}`, { auth: true });
      if (receiveTargetChoiceStatus(value, target, revision)) await readInheritorStatuses(target, revision);
    } catch (error) {
      if (!choiceTargetStillCurrent(target, revision)) return;
      state.choiceTargetState = "error";
      state.choiceTargetMessage = error?.choiceTargetInvalid ? error.message :
        "선택한 작품의 상태를 불러오지 못했습니다. 새로고침 또는 대상 재선택 후 확인해 주세요. 생성은 차단되어 있습니다.";
      if (target.lastStatus?.preparationBatch?.reviewContextReady === false) {
        receiveChoiceStatus({ status: "unavailable", preparationBatch: target.lastStatus.preparationBatch });
      }
    } finally {
      if (state.choiceTarget === target && state.choiceTargetRevision === revision) renderStoryStatus();
    }
  }

  async function selectChoiceTarget(workId) {
    if (!state.catalogVerified || state.loading || inheritorMutationBusy()) return;
    state.choiceSelectionRequired = true;
    const works = inheritorWorks();
    const matches = works.filter((work) => sameChoiceId(work.id, workId));
    const next = matches.length === 1 ? newChoiceTarget(matches[0], works.length === 1) : null;
    const previous = state.choiceTarget;
    if (next && previous && sameChoiceId(next.catalogId, previous.catalogId) &&
      sameChoiceId(next.catalogReleaseId, previous.catalogReleaseId)) {
      next.workId = previous.workId;
      next.releaseId = previous.releaseId;
    }
    state.choiceTarget = next;
    clearChoiceRead("unselected", next ? "선택한 작품의 상태를 확인합니다." :
      "작품과 공개 릴리스 ID를 확인할 수 있는 대상을 선택해 주세요. 생성은 시작되지 않았습니다.");
    renderStoryStatus();
    if (next) await readChoiceTargetStatus();
  }

  function choiceTargetControls() {
    const works = inheritorWorks();
    const target = state.choiceTarget;
    const selectedId = state.choiceTargetState === "changed" ? "" : target?.catalogId;
    return `<label class="story-choice-target-label">선택지 대상 작품
      <select data-story-choice-target ${state.loading || inheritorMutationBusy() ? "disabled" : ""}>
        <option value="" ${!selectedId ? "selected" : ""}>작품을 선택해 주세요</option>
        ${works.map((candidate, index) => {
          const suffix = candidate.slug.slice("the-killer-inherits-the-dead-".length);
          const label = `작품 ${index + 1} · ${suffix.slice(0, 20)}${suffix.length > 20 ? "..." : ""}`;
          return `<option value="${escapeHtml(candidate.id)}" ${sameChoiceId(selectedId, candidate.id) ? "selected" : ""} ${newChoiceTarget(candidate, works.length === 1) ? "" : "disabled"}>${escapeHtml(label)}</option>`;
        }).join("")}
      </select>
    </label>
    ${target ? `<dl class="story-choice-target-facts">
      <dt>${state.choiceTargetState === "changed" ? "이전 대상 주소" : "작품 주소"}</dt><dd>${escapeHtml(target.catalogSlug || target.catalogId)}</dd>
      <dt>작품 ID</dt><dd>${escapeHtml(target.workId || target.catalogId)}</dd>
      <dt>공개 릴리스 ID</dt><dd>${escapeHtml(target.releaseId || "기존 단일 작품 방식 · 릴리스 ID 미확인")}</dd>
    </dl>` : ""}
    <small data-story-choice-target-state role="status" aria-live="polite">${escapeHtml(state.choiceTargetMessage)}</small>`;
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
      awaiting_author_review: "작가 검토 대기",
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
    if (value === "processing" || value === "awaiting_author_review") return "is-review";
    return "is-pending";
  }

  function storyState(story) {
    if (state.publishedWorks.some((work) => matchesPublishedStory(work, story))) {
      const verified = story.key === "inheritor" ? inheritorStatusVerified("ai") : fixedStatusVerified(story.key, "ai");
      const ai = verified ? state.aiStatuses[story.key] : null;
      if (story.aiActivationAvailable && (!ai || ai.status === "unavailable")) {
        return { published: true, label: "원고 공개 / AI 분기 확인 필요", className: "is-review", detail: "원고는 독자 화면에 공개 중" };
      }
      if (story.aiActivationAvailable && (ai.status !== "active" || ai.active !== true)) {
        return { published: true, label: "원고 공개 / AI 분기 미활성", className: "is-review", detail: "원고는 독자 화면에 공개 중" };
      }
      if (story.aiActivationAvailable) {
        if (ai.choicePreparation?.ready === false) {
          return { published: true, label: "원고 공개 / 선택지 준비 중", className: "is-review", detail: "AI 생성은 활성 상태지만 모든 파트의 선택지가 준비되지는 않았습니다." };
        }
        return { published: true, label: "원고 공개 / AI 생성 활성", className: "is-approved", detail: "분기 장면은 독자 선택 후 생성" };
      }
      return { published: true, label: "공개 완료", className: "is-approved", detail: "독자 화면에 공개 중" };
    }
    const candidates = state.items
      .filter((item) => identify(item).story?.key === story.key)
      .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));
    if (candidates.some((item) => item.status === "awaiting_author_review")) {
      return { label: "비공개 원고 / 작가 검토 대기", className: "is-review", detail: "작가 스튜디오에서 원고 분석과 생성 기준 승인이 필요합니다." };
    }
    const promoted = candidates.find((item) => Boolean(item.promotedWorkId) || item.status === "promoted");
    if (promoted) return { label: "승격 완료", className: "is-approved", detail: "StoryWork 연결 완료" };
    if (candidates.length) return { label: "승격 준비", className: "is-review", detail: "정확한 원고 SHA 확인" };
    return { label: "접수 없음", className: "is-pending", detail: "일치하는 운영 업로드 없음" };
  }

  function fixedVisualControls(story, visual) {
    const verified = story.key === "inheritor" ? inheritorStatusVerified("visual") : fixedVisualVerified(story.key);
    const feedback = story.key === "inheritor" ? state.inheritorFeedback.visual : state.fixedVisualFeedback[story.key];
    if (!verified) return `<section class="story-ai-activation" data-story-visual-card="${escapeHtml(story.key)}">
      <div><strong>장면 그림 일관성</strong><span class="status-badge is-review">대상별 확인 필요</span></div>
      <small>선택한 작품·릴리스의 그림 상태와 교체 대상을 확인하기 전에는 그림을 교체할 수 없습니다.</small>
      <p class="form-status${feedback ? " is-error" : ""}" data-story-visual-status role="status" aria-live="polite">${escapeHtml(feedback || "")}</p>
    </section>`;
    const busy = inheritorMutationBusy() || (story.key === "inheritor" && !inheritorVisualReady());
    const read = story.key === "inheritor" ? state.inheritorReads.visual : state.fixedVisualReads[story.key];
    const targetAttributes = `data-story-target-revision="${story.key === "inheritor" ? state.choiceTargetRevision : state.catalogRevision}" data-story-visual-read="${read.sequence}"`;
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
          <button type="button" class="story-visual-review-button" data-story-visual-replace="${escapeHtml(story.key)}" data-story-visual-scene="${escapeHtml(item.sourceSceneKey || "")}" ${targetAttributes} ${busy ? "disabled" : ""}>이 그림 교체</button>
        </div>`;
      }).join("")}</div>` : ""}
      ${staleCount > 0 ? `<button type="button" class="primary-action story-visual-replace-button" data-story-visual-replace="${escapeHtml(story.key)}" ${targetAttributes} ${busy ? "disabled" : ""}>${state.replacingKey === story.key ? "교체 중..." : `남은 ${staleCount.toLocaleString("ko-KR")}장 전체 교체`}</button>` : ""}
      <p class="form-status" data-story-visual-status role="status" aria-live="polite"></p>
    </section>`;
  }

  function renderStoryStatus() {
    if (refreshButton) refreshButton.disabled = state.loading || inheritorMutationBusy();
    if (!statusCards) return;
    state.inheritorConfirmationRevision += 1;
    state.fixedAiReviewRevision += 1;
    statusCards.innerHTML = knownStories.map((story) => {
      const current = storyState(story);
      const published = current.published === true;
      const aiVerified = story.key === "inheritor" ? inheritorStatusVerified("ai") : fixedStatusVerified(story.key, "ai");
      const coverageVerified = story.key === "inheritor" ? inheritorStatusVerified("coverage") : fixedStatusVerified(story.key, "coverage");
      const scopeUnconfirmed = !aiVerified || !coverageVerified;
      const ai = aiVerified ? state.aiStatuses[story.key] : null;
      const aiActive = ai?.status === "active" && ai.active === true;
      const aiUnavailable = !ai || ai.status === "unavailable";
      const busy = inheritorMutationBusy();
      const fixedChoicePreparation = (story.key === "monster" || story.key === "rebellion") ? ai?.choicePreparation : null;
      const fixedChoicesPending = fixedChoicePreparation && fixedChoicePreparation.ready !== true;
      const fixedChoicesStaged = fixedChoicePreparation?.phase === "awaiting_promotion";
      const visual = state.visualStatuses[story.key];
      const choiceStatus = state.choiceStatuses[story.key];
      const coverage = coverageVerified ? state.choiceCoverage[story.key] : null;
      const distribution = coverage?.distribution;
      const coverageIncomplete = coverage?.status === "ready" && (
        Number(coverage.partsWithoutScenes || 0) > 0 ||
        Number(distribution?.zero || 0) + Number(distribution?.one || 0) +
          Number(distribution?.two || 0) + Number(distribution?.otherOrInvalid || 0) > 0 ||
        Number(coverage.routeIssues?.duplicateImmediateTargets || 0) > 0 ||
        Number(coverage.routeIssues?.invalidDirectTargets || 0) > 0);
      const coverageControls = published ? `<section class="story-ai-activation" data-story-choice-coverage="${escapeHtml(story.key)}">
        <div><strong>공개 장면 선택지 점검</strong><span class="status-badge ${coverageIncomplete || coverage?.status !== "ready" ? "is-review" : "is-approved"}">${coverage?.status === "too_large" ? "점검 한도 초과" : coverage?.status !== "ready" ? "확인 필요" : coverageIncomplete ? "미완료 장면 있음" : "전 장면 3개"}</span></div>
        <small>${coverage?.status === "ready"
          ? `전체 ${Number(coverage.totalScenes || 0).toLocaleString("ko-KR")}장면 · 선택지 3개 ${Number(distribution?.threeValid || 0).toLocaleString("ko-KR")} · 2개 ${Number(distribution?.two || 0).toLocaleString("ko-KR")} · 1개 ${Number(distribution?.one || 0).toLocaleString("ko-KR")} · 없음 ${Number(distribution?.zero || 0).toLocaleString("ko-KR")} · 형식 오류 ${Number(distribution?.otherOrInvalid || 0).toLocaleString("ko-KR")} · 장면 없는 파트 ${Number(coverage.partsWithoutScenes || 0).toLocaleString("ko-KR")}`
          : coverage?.status === "too_large" ? "작품이 자동 점검 상한을 넘어 별도 분석이 필요합니다." : scopeUnconfirmed ? "작품·릴리스별 공개 장면 선택지 점검은 아직 확인되지 않았습니다." : "공개 장면의 실제 선택지 개수를 불러오지 못했습니다."}</small>
        ${coverage?.status === "ready" && (Number(coverage.routeIssues?.duplicateImmediateTargets || 0) || Number(coverage.routeIssues?.invalidDirectTargets || 0))
          ? `<small>같은 다음 장면으로 바로 연결된 선택지: ${Number(coverage.routeIssues?.duplicateImmediateTargets || 0).toLocaleString("ko-KR")}장면 · 연결 대상 오류: ${Number(coverage.routeIssues?.invalidDirectTargets || 0).toLocaleString("ko-KR")}건</small>` : ""}
        ${coverage?.status === "ready" ? "<small>개수와 문구만 검사합니다. 선택 후 이야기가 달라지는지는 별도 검수가 필요합니다.</small>" : ""}
        ${coverageIncomplete && Array.isArray(coverage.incompleteExamples) && coverage.incompleteExamples.length
          ? `<small>확인 예시: ${escapeHtml(coverage.incompleteExamples.map((item) => `${item.partPosition}파트 ${item.sceneKey} (${item.choiceCount}개)`).join(" · "))}</small>` : ""}
      </section>` : "";
      const choicesReady = story.key !== "inheritor" || choiceStatus?.status === "ready";
      const choiceBatch = story.key === "inheritor" ? choiceStatus?.preparationBatch : null;
      const batchBlocked = choiceBatchBlocked(choiceBatch);
      const batchContextMissing = choiceBatch?.reviewContextReady === false;
      const batchUpdatedAt = Date.parse(choiceBatch?.updatedAt || "");
      const batchReviewable = choiceBatch?.status === "review_required" ||
        (choiceBatch?.status === "in_progress" && Number.isFinite(batchUpdatedAt) && Date.now() - batchUpdatedAt >= 10 * 60 * 1000);
      const choiceControls = story.key === "inheritor" && published ? `<section class="story-ai-activation" data-story-choice-card>
        <div><strong>파트별 선택지</strong><span class="status-badge ${choicesReady ? "is-approved" : "is-review"}">${choicesReady ? "준비 완료" : choiceTargetReady() ? "준비 필요" : "대상 확인 필요"}</span></div>
        ${choiceTargetControls()}
        ${choiceStatus?.totalParts ? `<small>${Number(choiceStatus.preparedParts || 0).toLocaleString("ko-KR")} / ${Number(choiceStatus.totalParts).toLocaleString("ko-KR")}파트에 선택지 3개 준비</small>` : ""}
        ${choiceStatus?.slug ? `<a class="story-preview-link" href="/story-stage?slug=${encodeURIComponent(choiceStatus.slug)}" target="_blank" rel="noopener noreferrer">독자 화면 확인</a>` : ""}
        ${Array.isArray(choiceBatch?.partKeys) && choiceBatch.partKeys.length ? `<small data-story-choice-scope>작업 파트: ${choiceBatch.partKeys.map(key => escapeHtml(choicePartLabel(key))).join(",<wbr>")}</small>` : ""}
        ${batchContextMissing ? `<small data-story-choice-context-warning>${choiceContextRequiredMessage} 제공자 응답·청구 내역 확인과 유료 생성 재시도는 별도입니다.</small>` : ""}
        ${batchBlocked ? `<small>${batchContextMissing ? "이전 작업 범위 확인 필요" : choiceBatch.status === "in_progress" ? "선택지 배치가 진행 중입니다. 잠시 후 상태를 다시 확인하세요." : "선택지 배치 결과 확인이 필요합니다. 제공자 응답·청구 내역을 확인한 뒤 운영자 검토로 복구하세요."} 작업 ID: ${escapeHtml(choiceBatch.id || "-")}</small>` : ""}
        ${batchReviewable && choiceBatch?.id ? `<div class="story-choice-review" data-story-choice-review="${escapeHtml(choiceBatch.id)}">
          <small>제공자 응답·청구 내역을 먼저 확인하세요. 재시도는 별도 요청이며 추가 비용이 발생할 수 있습니다.</small>
          <label>확인 기록<textarea data-story-choice-review-note minlength="12" maxlength="1000" rows="3" placeholder="제공자 기록과 재사용할 응답이 없는 이유를 남겨 주세요." ${batchContextMissing || !choiceTargetReady() || inheritorReadsPending() || busy ? "disabled" : ""}></textarea></label>
          <label><input type="checkbox" data-story-choice-review-confirm ${batchContextMissing || !choiceTargetReady() || inheritorReadsPending() || busy ? "disabled" : ""} /> 재사용할 생성 결과가 없음을 확인했습니다.</label>
          <button type="button" class="secondary-action" data-story-review-batch="${escapeHtml(choiceBatch.id)}" disabled>검토 기록 후 재시도 허용</button>
        </div>` : ""}
        ${!choicesReady ? `<small>한 번에 최대 8파트를 AI로 준비합니다. 요청마다 생성 비용이 발생할 수 있습니다.</small><button type="button" class="primary-action" data-story-prepare-choices ${busy || inheritorReadsPending() || batchBlocked || !choiceTargetReady() ? "disabled" : ""}>${state.preparingChoices ? "준비 중..." : "다음 최대 8파트 준비"}</button>` : ""}
        <p class="form-status${state.choiceFeedback ? " is-error" : ""}" data-story-choice-status role="status" aria-live="polite">${escapeHtml(state.choiceFeedback || "")}</p>
      </section>` : "";
      return `<article class="story-publication-status-item">
        <div class="story-publication-status-title"><span>대상 작품</span><h3>${escapeHtml(story.title)}</h3></div>
        <div class="story-publication-status-result">
          <span class="status-badge ${current.className}">${escapeHtml(current.label)}</span>
          <small>${escapeHtml(current.detail)}</small>
        </div>
        <div class="story-publication-controls">
        ${coverageControls}
        ${choiceControls}
        ${published && story.aiActivationAvailable ? `<section class="story-ai-activation" data-story-ai-card="${escapeHtml(story.key)}" ${story.key === "inheritor" ? `data-story-ai-review="${state.inheritorConfirmationRevision}"` : `data-story-ai-review="${state.fixedAiReviewRevision}" data-story-target-revision="${state.catalogRevision}" data-story-ai-read="${state.fixedReads[story.key]?.ai?.sequence || ""}" data-story-coverage-read="${state.fixedReads[story.key]?.coverage?.sequence || ""}"`}>
          <div><strong>AI 분기 생성</strong><span class="status-badge ${aiActive ? "is-approved" : "is-review"}">${aiActive ? "활성" : aiUnavailable ? "확인 필요" : "비활성"}</span></div>
          ${scopeUnconfirmed ? "<small>작품·릴리스별 AI 대상 확인 전에는 활성화와 설정 갱신을 진행할 수 없습니다. 선택지 준비와는 별도입니다.</small>" : ""}
          ${!scopeUnconfirmed && story.key !== "inheritor" && !fixedAiReady(story.key) ? "<small>현재 상태로는 AI 설정을 갱신할 수 없습니다. 파트별 선택지 3개와 준비 현황을 확인해 주세요.</small>" : ""}
          ${aiActive ? `<small>독자가 선택하면 새 장면을 생성합니다. 분기 장면이 미리 생성된 상태는 아닙니다.</small>` : ""}
          ${fixedChoicePreparation ? `<small>${Number(fixedChoicePreparation.preparedParts || 0).toLocaleString("ko-KR")} / ${Number(fixedChoicePreparation.totalParts || 0).toLocaleString("ko-KR")}파트 선택지 준비${fixedChoicesPending ? " · 기존 선택지는 독자에게 계속 공개 중" : ""}</small>` : ""}
          <fieldset class="story-ai-confirmations" ${state.loading || busy || scopeUnconfirmed || (story.key === "inheritor" ? !inheritorAiReady() : !fixedAiReady(story.key)) ? "disabled" : ""}>
            <legend>${aiActive ? "설정 갱신 확인" : "활성화 전 확인"}</legend>
            <label><input type="checkbox" data-story-ai-confirm /> 원고 기반 AI 분기 생성을 승인했습니다.</label>
            <label><input type="checkbox" data-story-ai-confirm /> 작가 문체 참고를 승인했습니다.</label>
            <label><input type="checkbox" data-story-ai-confirm /> 검수된 동일 결과 재사용을 승인했습니다.</label>
            <label><input type="checkbox" data-story-ai-confirm /> 장면 이미지 변환을 승인했습니다.</label>
          </fieldset>
          <button type="button" class="primary-action story-ai-activate-button" data-story-ai-activate="${escapeHtml(story.key)}" disabled>${busy ? "설정 중..." : fixedChoicesStaged ? "준비된 선택지 적용" : fixedChoicesPending ? "다음 최대 8파트 준비" : aiActive ? "AI 설정 갱신" : "AI 분기 활성화"}</button>${!choicesReady ? "<small>선택지 3개 준비가 끝나면 활성화할 수 있습니다.</small>" : ""}
          <p class="form-status${(story.key === "inheritor" ? state.inheritorFeedback.ai : state.fixedAiFeedback[story.key]) ? " is-error" : ""}" data-story-ai-status role="status" aria-live="polite">${escapeHtml((story.key === "inheritor" ? state.inheritorFeedback.ai : state.fixedAiFeedback[story.key]) || "")}</p>
        </section>${story.visualIdentityManaged ? fixedVisualControls(story, visual) : ""}` : published ? `<div class="story-fixed-release-controls"><section class="story-ai-activation"><div><strong>독자 공개 방식</strong><span class="status-badge is-approved">고정 메인 루트</span></div><small>작가 최종 원고 순서대로 공개되며 시스템의 다음 장 이동만 제공합니다.</small></section>${story.visualIdentityManaged ? fixedVisualControls(story, visual) : ""}</div>` : ""}
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
    const awaitingReview = item?.status === "awaiting_author_review";
    const promoted = Boolean(item?.promotedWorkId) || item?.status === "promoted";
    const canConfirm = identification.readiness === "ready" && !promoted && !awaitingReview;
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
        <div><dt>승격 상태</dt><dd>${awaitingReview ? "비공개 작품 연결 완료" : promoted ? "StoryWork 연결 완료" : "미승격"}</dd></div>
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
        <p class="form-status" data-story-submission-status role="status" aria-live="polite">${awaitingReview ? `${authorReviewMessage} ${authorReviewLink}` : story ? "세 항목을 직접 확인하면 승격할 수 있습니다." : "정확한 원고 SHA가 식별되지 않아 승격할 수 없습니다."}</p>
        <button class="primary-action story-promote-button" type="button" data-story-promote${disabled}>${busy ? "승격 중..." : awaitingReview ? "작가 검토 대기" : promoted ? "승격 완료" : "StoryWork/Release로 승격"}</button>
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

  function isAuthorReviewReceipt(result) {
    return result?.status === "awaiting_author_review" ||
      (result?.status === "promoted" && result.work?.status !== "published") ||
      (!result?.status && result?.work?.status === "draft");
  }

  function showAuthorReviewReceipt(result, inlineStatus) {
    const workId = result.workId ?? result.work?.id;
    const review = result.writerReview;
    if (typeof workId !== "string" || !workId.trim() ||
      typeof review?.manuscriptVersionId !== "string" || !review.manuscriptVersionId.trim() ||
      !normalizedChecksum(review.manuscriptHash) || review.analysisStarted !== false ||
      review.nextAction !== "analyze_and_approve" || result.releaseId != null ||
      result.work?.activeReleaseId != null || result.work?.status === "published") {
      throw new Error("비공개 원고 접수 결과를 확인하지 못했습니다. 작품과 원고 정보를 확인해 주세요.");
    }
    for (const target of new Set([inlineStatus, status])) {
      if (!target) continue;
      target.textContent = authorReviewMessage;
      target.className = "form-status";
      const link = document.createElement("a");
      link.href = "/creator-studio";
      link.textContent = "작가 스튜디오 열기";
      link.className = "story-preview-link";
      target.append(" ", link);
    }
    return workId;
  }

  async function load(options) {
    if (!api || !list || state.loading || (inheritorMutationBusy() && !options?.afterMutation)) return;
    if (state.loaded && !options?.force) return;
    state.loading = true;
    state.catalogVerified = false;
    state.catalogRevision += 1;
    state.fixedVisualReads = {};
    state.fixedVisualFeedback = {};
    state.fixedReads = {};
    state.fixedAiFeedback = {};
    state.aiStatuses = {};
    state.choiceCoverage = {};
    state.visualStatuses = {};
    clearChoiceRead("loading", "공개 작품과 릴리스 목록을 확인하고 있습니다.");
    setStatus("접수 상태를 확인하고 있습니다.");
    render();
    try {
      const response = await api.fetch(endpoint, { auth: true });
      if (!response || !Array.isArray(response.items)) throw new Error("접수 목록 응답 형식이 올바르지 않습니다.");
      state.items = response.items;
      state.publishedWorks = Array.isArray(response.publishedWorks) ? response.publishedWorks : [];
      state.catalogVerified = true;
      const readSelectedChoices = reconcileChoiceTarget();
      await Promise.all(knownStories.filter((story) => story.key !== "inheritor").map(async (story) => {
        await Promise.all([
          ...(story.aiActivationAvailable ? [readFixedStatus(story.key, "ai")] : []),
          ...(story.visualIdentityManaged ? [readFixedVisualStatus(story.key)] : []),
          readFixedStatus(story.key, "coverage")
        ]);
      }));
      state.aiStatuses.inheritor ||= { active: false, status: "unavailable" };
      state.visualStatuses.inheritor ||= { status: "unavailable" };
      state.choiceCoverage.inheritor ||= { status: "unavailable" };
      if (readSelectedChoices) await readChoiceTargetStatus();
      state.loaded = true;
      setStatus(`${state.items.length.toLocaleString("ko-KR")}건을 확인했습니다.`, "success");
    } catch (error) {
      state.items = [];
      state.loaded = false;
      state.catalogVerified = false;
      clearChoiceRead("error", "공개 작품 목록을 불러오지 못해 생성할 수 없습니다. 새로고침 후 대상을 확인해 주세요.");
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
      for (let step = 0; result?.status !== "published" && !isAuthorReviewReceipt(result) && step < 200; step += 1) {
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
      if (isAuthorReviewReceipt(result)) {
        showAuthorReviewReceipt(result, inlineStatus);
        form.reset();
        state.loaded = false;
        return;
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
      button.textContent = storyKey === "inheritor" ? "공개 테스트 등록" : "확인 후 바로 공개";
      button.removeAttribute("aria-busy");
    }
  }

  function updatePromotionButton(card) {
    const button = card?.querySelector("[data-story-promote]");
    if (!button) return;
    const item = state.items.find((candidate) => String(candidate.id) === card.dataset.submissionId);
    const ready = identify(item).readiness === "ready" && !item?.promotedWorkId && item?.status !== "promoted" && item?.status !== "awaiting_author_review";
    const confirmations = [...card.querySelectorAll("[data-story-confirmation]")];
    button.disabled = !ready || confirmations.length !== 3 || confirmations.some((input) => !input.checked) || Boolean(state.promotingId);
  }

  async function promote(button) {
    const card = button.closest("[data-submission-id]");
    const item = state.items.find((candidate) => String(candidate.id) === card?.dataset.submissionId);
    const identification = identify(item);
    const confirmations = [...(card?.querySelectorAll("[data-story-confirmation]") || [])];
    if (!item || identification.readiness !== "ready" || !identification.story || confirmations.length !== 3 ||
        confirmations.some((input) => !input.checked) || item.promotedWorkId || item.status === "promoted" ||
        item.status === "awaiting_author_review") return;

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
      for (let step = 0; result?.jobId && result.status !== "published" && !isAuthorReviewReceipt(result) && step < 200; step += 1) {
        if (result.status === "failed") throw new Error(result.errorCode || "공개 작업이 중단됐습니다.");
        if (inlineStatus) inlineStatus.textContent = result.status === "preparing_choices"
          ? `원고에 맞는 선택지를 준비하고 있습니다. ${Number(result.processedParts || 0).toLocaleString("ko-KR")} / ${Number(result.totalParts || 0).toLocaleString("ko-KR")}`
          : `원고와 선택지를 공개하고 있습니다. ${Number(result.processedParts || 0).toLocaleString("ko-KR")} / ${Number(result.totalParts || 0).toLocaleString("ko-KR")}`;
        result = await api.fetch(`${endpoint}/jobs/${encodeURIComponent(result.jobId)}/process`, {
          method: "POST", auth: true
        });
      }
      if (isAuthorReviewReceipt(result)) {
        item.promotedWorkId = showAuthorReviewReceipt(result, inlineStatus);
        item.status = "awaiting_author_review";
        state.loaded = false;
        renderStoryStatus();
        button.textContent = "작가 검토 대기";
        button.removeAttribute("aria-busy");
        return;
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
      if (item.status === "awaiting_author_review") render();
      updatePromotionButton(card);
    }
  }

  function updateAiActivationButton(card) {
    const button = card?.querySelector("[data-story-ai-activate]");
    if (!button) return;
    const confirmations = [...card.querySelectorAll("[data-story-ai-confirm]")];
    const inheritorNotReady = card?.dataset.storyAiCard === "inheritor" && (!inheritorAiReady() || inheritorMutationBusy() ||
      card.dataset.storyAiReview !== String(state.inheritorConfirmationRevision));
    const fixedNotReady = card?.dataset.storyAiCard !== "inheritor" &&
      (!fixedAiReady(card?.dataset.storyAiCard) || !fixedAiCardCurrent(card, button.dataset.storyAiActivate));
    button.disabled = state.loading || inheritorMutationBusy() || inheritorNotReady || fixedNotReady || confirmations.length !== 4 || confirmations.some((input) => !input.checked);
  }

  function updateChoiceReviewButton(review) {
    const button = review?.querySelector("[data-story-review-batch]");
    if (!button) return;
    const note = review.querySelector("[data-story-choice-review-note]")?.value.trim() || "";
    const confirmed = review.querySelector("[data-story-choice-review-confirm]")?.checked === true;
    button.disabled = inheritorMutationBusy() || inheritorReadsPending() || !choiceTargetReady() || button.dataset.storyReviewBatch !== state.choiceStatuses.inheritor?.preparationBatch?.id || state.choiceStatuses.inheritor?.preparationBatch?.reviewContextReady === false || !confirmed || note.length < 12 || note.length > 1000;
  }

  async function reviewInheritorChoiceBatch(button) {
    const review = button.closest("[data-story-choice-review]");
    const batchId = button.dataset.storyReviewBatch;
    const reviewNote = review?.querySelector("[data-story-choice-review-note]")?.value.trim() || "";
    if (inheritorMutationBusy() || inheritorReadsPending() || !choiceTargetReady() || state.choiceStatuses.inheritor?.preparationBatch?.reviewContextReady === false || !review?.querySelector("[data-story-choice-review-confirm]")?.checked ||
      reviewNote.length < 12 || reviewNote.length > 1000 || !batchId ||
      batchId !== state.choiceStatuses.inheritor?.preparationBatch?.id) return;
    const target = state.choiceTarget;
    const revision = state.choiceTargetRevision;
    state.reviewingBatchId = batchId;
    state.choiceFeedback = null;
    button.disabled = true;
    renderStoryStatus();
    try {
      const result = await api.fetch(`${publicationEndpoint}/published/inheritor/choice-batches/${encodeURIComponent(batchId)}/review`, {
        method: "POST", auth: true,
        body: { outcome: "no_reusable_response_confirmed", reviewNote }
      });
      if (!choiceTargetStillCurrent(target, revision)) return;
      if (!["completed", "retry_authorized"].includes(result?.status)) throw new Error("검토 결과를 확인하지 못했습니다.");
      state.loaded = false;
      await load({ force: true, afterMutation: true });
      if (!state.loaded || !choiceTargetReady()) return;
      setStatus(result.status === "completed" ? "저장된 선택지를 확인하고 배치를 완료로 정리했습니다." :
        "검토 기록을 저장했습니다. 다음 AI 배치는 별도로 요청해야 합니다.", "success");
    } catch (error) {
      if (!choiceTargetStillCurrent(target, revision)) return;
      const message = choiceErrorMessage(error, "배치 검토를 저장하지 못했습니다. 상태를 다시 확인해 주세요.");
      recordChoiceError(error, message);
      setStatus(message, "error");
      renderStoryStatus();
    } finally {
      state.reviewingBatchId = null;
      renderStoryStatus();
    }
  }

  async function prepareInheritorChoices(button) {
    if (inheritorMutationBusy() || inheritorReadsPending() || !choiceTargetReady() || state.choiceStatuses.inheritor?.status === "ready" || choiceBatchBlocked(state.choiceStatuses.inheritor?.preparationBatch)) return;
    const target = state.choiceTarget;
    const revision = state.choiceTargetRevision;
    state.preparingChoices = true;
    state.choiceFeedback = null;
    const card = button.closest("[data-story-choice-card]");
    const inlineStatus = card?.querySelector("[data-story-choice-status]");
    button.disabled = true;
    button.textContent = "준비 중...";
    renderStoryStatus();
    try {
      const result = await api.fetch(`${publicationEndpoint}/published/inheritor/prepare-choices`, {
        method: "POST", auth: true,
        ...(target.workId ? { body: { workId: target.workId, releaseId: target.releaseId } } : {})
      });
      if (!receiveTargetChoiceStatus(result, target, revision)) return;
      if (inlineStatus) inlineStatus.textContent = `${Number(result.preparedParts).toLocaleString("ko-KR")} / ${Number(result.totalParts).toLocaleString("ko-KR")}파트 준비`;
      state.loaded = false;
      await load({ force: true, afterMutation: true });
      if (!state.loaded || !choiceTargetReady()) return;
      setStatus(result.status === "ready" ? "모든 파트의 선택지 3개가 준비됐습니다." :
        `${Number(result.preparedParts).toLocaleString("ko-KR")} / ${Number(result.totalParts).toLocaleString("ko-KR")}파트 준비. 다음 배치는 별도로 실행하세요.`,
        result.status === "ready" ? "success" : "");
    } catch (error) {
      if (!choiceTargetStillCurrent(target, revision)) return;
      const message = choiceErrorMessage(error, "선택지 준비에 실패했습니다. 작업 상태를 확인해 주세요.");
      recordChoiceError(error, message);
      if (inlineStatus) {
        const reason = error?.body?.error?.details?.reason;
        inlineStatus.textContent = `${message}${reason ? ` (${reason})` : ""}`;
        inlineStatus.className = "form-status is-error";
      }
      setStatus(message, "error");
      if (error?.choiceTargetInvalid) {
        clearChoiceRead("error", error.message, true);
      } else {
        await readChoiceTargetStatus(true);
      }
      button.disabled = !choiceTargetReady() || choiceBatchBlocked(state.choiceStatuses.inheritor?.preparationBatch);
      button.textContent = "다음 최대 8파트 준비";
    } finally {
      state.preparingChoices = false;
      renderStoryStatus();
    }
  }

  async function activateInheritorAi(button) {
    const card = button.closest("[data-story-ai-card]");
    const confirmations = [...(card?.querySelectorAll("[data-story-ai-confirm]") || [])];
    if (inheritorMutationBusy() || !inheritorAiReady() ||
      card?.dataset.storyAiReview !== String(state.inheritorConfirmationRevision) ||
      confirmations.length !== 4 || confirmations.some((input) => !input.checked)) return;
    const snapshot = inheritorActionSnapshot();
    const read = state.inheritorReads.ai;
    const wasActive = read.value.active;
    state.activatingKey = "inheritor";
    delete state.inheritorFeedback.ai;
    renderStoryStatus();
    let refreshedAfterAction = false;
    try {
      const result = await api.fetch(`${publicationEndpoint}/published/inheritor/activate-ai`, {
        method: "POST", auth: true,
        body: {
          aiBranchGenerationConfirmed: true,
          authorStyleReferenceConfirmed: true,
          generatedResultReuseConfirmed: true,
          imageTransformationConfirmed: true,
          ...(snapshot.workId ? { workId: snapshot.workId, releaseId: snapshot.releaseId } : {})
        }
      });
      if (!inheritorActionCurrent(snapshot) || state.inheritorReads.ai !== read) return;
      if (!matchesTargetPair(result, snapshot.target) || result?.status !== "active" || result.active !== true) {
        throw new Error("AI 활성화 응답의 작품·릴리스와 완료 상태를 확인하지 못했습니다.");
      }
      read.value = result;
      state.aiStatuses.inheritor = result;
      state.loaded = false;
      refreshedAfterAction = true;
      await load({ force: true, afterMutation: true });
      if (state.choiceTarget !== snapshot.target || !sameChoiceId(snapshot.workId, snapshot.target.workId) ||
        !sameChoiceId(snapshot.releaseId, snapshot.target.releaseId) || !inheritorStatusVerified("ai")) return;
      if (state.aiStatuses.inheritor.active !== true) {
        throw new Error("활성화 응답을 받았지만 최신 AI 상태에서 활성화를 확인하지 못했습니다.");
      }
      setStatus(`선택한 작품의 AI ${wasActive ? "설정을 갱신" : "분기를 활성화"}했습니다.`, "success");
    } catch (error) {
      if (state.choiceTarget !== snapshot.target || !choiceTargetReady() ||
        (!refreshedAfterAction && (!inheritorActionCurrent(snapshot) || state.inheritorReads.ai !== read)) ||
        !sameChoiceId(snapshot.workId, snapshot.target.workId) || !sameChoiceId(snapshot.releaseId, snapshot.target.releaseId)) return;
      const message = choiceErrorCode(error) ? choiceErrorMessage(error, "AI 상태를 다시 확인해 주세요.") :
        "AI 활성화 결과를 확인하지 못했습니다. 제공자 응답·청구 내역을 확인한 뒤 상태를 새로 확인해 주세요. 자동으로 재시도하지 않습니다.";
      markInheritorUnknown("ai", message);
      setStatus(message, "error");
    } finally {
      state.activatingKey = null;
      renderStoryStatus();
    }
  }

  async function replaceInheritorVisual(button) {
    const visualRead = state.inheritorReads.visual;
    if (inheritorMutationBusy() || !inheritorVisualReady() ||
      button.dataset.storyTargetRevision !== String(state.choiceTargetRevision) ||
      button.dataset.storyVisualRead !== String(visualRead?.sequence)) return;
    const snapshot = inheritorActionSnapshot();
    const visual = visualRead.value;
    const selectedKey = button.dataset.storyVisualScene;
    const items = selectedKey ? visual.items.filter((item) => item.sourceSceneKey === selectedKey) : [...visual.items];
    if (!items.length) return;
    const checksum = visual.releaseChecksum;
    state.replacingKey = "inheritor";
    delete state.inheritorFeedback.visual;
    renderStoryStatus();
    let completed = 0;
    let refreshedAfterAction = false;
    try {
      for (const item of items) {
        if (!inheritorActionCurrent(snapshot)) return;
        const read = state.inheritorReads.visual;
        if (!inheritorStatusVerified("visual") || read.value.releaseChecksum !== checksum ||
          !read.value.items.some((candidate) => candidate.sourceSceneKey === item.sourceSceneKey)) {
          throw new Error("교체 대상이 변경되었습니다.");
        }
        const result = await api.fetch(`/admin/api/v1/story-visuals/${encodeURIComponent(snapshot.workId)}/replace-stale`, {
          method: "POST", auth: true,
          body: { releaseId: snapshot.releaseId, releaseChecksum: checksum, sourceSceneKey: item.sourceSceneKey }
        });
        if (!inheritorActionCurrent(snapshot) || state.inheritorReads.visual !== read) return;
        if (result?.status !== "ready" || !matchesTargetPair(result, snapshot.target) ||
          result.releaseChecksum !== checksum || result.sourceSceneKey !== item.sourceSceneKey) {
          throw new Error("그림 교체 응답의 대상과 완료 상태를 확인하지 못했습니다.");
        }
        completed += 1;
        if (completed < items.length) {
          const refreshed = await readInheritorStatus("visual", snapshot.target, snapshot.revision);
          if (!inheritorActionCurrent(snapshot)) return;
          if (!refreshed || refreshed.releaseChecksum !== checksum ||
            refreshed.items.some((candidate) => candidate.sourceSceneKey === item.sourceSceneKey)) {
            throw new Error("교체 후 최신 그림 상태를 확인하지 못했습니다.");
          }
        }
      }
      state.loaded = false;
      refreshedAfterAction = true;
      await load({ force: true, afterMutation: true });
      if (state.choiceTarget !== snapshot.target || !inheritorStatusVerified("visual") ||
        !sameChoiceId(snapshot.workId, snapshot.target.workId) || !sameChoiceId(snapshot.releaseId, snapshot.target.releaseId)) return;
      if (state.visualStatuses.inheritor.releaseChecksum !== checksum ||
        state.visualStatuses.inheritor.items.some((candidate) => items.some((item) => item.sourceSceneKey === candidate.sourceSceneKey))) {
        throw new Error("교체 응답을 받았지만 최신 그림 상태가 일치하지 않습니다.");
      }
      setStatus(`선택한 작품의 장면 그림 ${completed}장을 교체했습니다.`, "success");
    } catch {
      if (state.choiceTarget !== snapshot.target || !choiceTargetReady() ||
        (!refreshedAfterAction && !inheritorActionCurrent(snapshot)) ||
        !sameChoiceId(snapshot.workId, snapshot.target.workId) || !sameChoiceId(snapshot.releaseId, snapshot.target.releaseId)) return;
      const message = `${completed}장 교체 확인 후 중단했습니다. 대상 또는 요청 결과가 불확실해 추가 교체는 차단했습니다. 제공자 응답·청구 내역과 최신 상태를 확인해 주세요. 자동으로 재시도하지 않습니다.`;
      markInheritorUnknown("visual", message);
      setStatus(message, "error");
    } finally {
      state.replacingKey = null;
      renderStoryStatus();
    }
  }

  async function activateAi(button) {
    const storyKey = button.dataset.storyAiActivate;
    if (storyKey === "inheritor") return activateInheritorAi(button);
    const card = button.closest("[data-story-ai-card]");
    const confirmations = [...(card?.querySelectorAll("[data-story-ai-confirm]") || [])];
    if (inheritorMutationBusy() || !knownStories.some((story) => story.key === storyKey && story.aiActivationAvailable) ||
      !fixedAiReady(storyKey) || !fixedAiCardCurrent(card, storyKey) ||
      confirmations.length !== 4 || confirmations.some((input) => !input.checked)) return;
    const read = state.fixedReads[storyKey].ai;
    const coverageRead = state.fixedReads[storyKey].coverage;
    const snapshot = { workId: read.workId, releaseId: read.releaseId, revision: read.revision };
    const wasActive = read.value.active;
    state.activatingKey = storyKey;
    delete state.fixedAiFeedback[storyKey];
    renderStoryStatus();
    let refreshedAfterAction = false;
    try {
      const result = await api.fetch(`${publicationEndpoint}/published/${encodeURIComponent(storyKey)}/activate-ai`, {
        method: "POST",
        auth: true,
        body: {
          workId: snapshot.workId,
          releaseId: snapshot.releaseId,
          aiBranchGenerationConfirmed: true,
          authorStyleReferenceConfirmed: true,
          generatedResultReuseConfirmed: true,
          imageTransformationConfirmed: true
        }
      });
      if (!fixedVisualSourceCurrent(storyKey, snapshot) || state.fixedReads[storyKey]?.ai !== read ||
        state.fixedReads[storyKey]?.coverage !== coverageRead) return;
      if (!matchesTargetPair(result, snapshot)) throw new Error("Unconfirmed AI target");
      const preparing = result?.status === "preparing_choices";
      if (preparing && (!["monster", "rebellion"].includes(storyKey) || typeof result.active !== "boolean" ||
        !validFixedPreparation({ ...result, ready: false }))) throw new Error("Unconfirmed preparation result");
      if (!preparing && (result?.status !== "active" || result.active !== true)) {
        throw new Error("Unconfirmed AI result");
      }
      state.loaded = false;
      refreshedAfterAction = true;
      await load({ force: true, afterMutation: true });
      const current = fixedVisualSource(storyKey);
      if (!state.catalogVerified || !current || !sameChoiceId(current.workId, snapshot.workId) ||
        !sameChoiceId(current.releaseId, snapshot.releaseId)) return;
      if (!fixedStatusVerified(storyKey, "ai") || !fixedStatusVerified(storyKey, "coverage")) {
        throw new Error("Latest AI status is unknown");
      }
      const latest = state.aiStatuses[storyKey];
      if (preparing) {
        const progress = latest.choicePreparation;
        if (latest.active !== result.active || !progress || progress.ready ||
          ["totalParts", "preparedParts", "remainingParts", "phase"].some((key) => progress[key] !== result[key]) ||
          progress.totalParts !== state.choiceCoverage[storyKey].totalParts) {
          throw new Error("Latest preparation differs");
        }
      } else if (latest.active !== true || !fixedAiReady(storyKey) ||
        (["monster", "rebellion"].includes(storyKey) && latest.choicePreparation.ready !== true)) {
        throw new Error("Latest activation differs");
      }
      const title = knownStories.find((story) => story.key === storyKey).title;
      setStatus(preparing
        ? `${title}: ${result.preparedParts.toLocaleString("ko-KR")} / ${result.totalParts.toLocaleString("ko-KR")}파트 준비. ${result.phase === "awaiting_promotion" ? "다음 승인에서 모든 선택지를 한 번에 적용합니다." : "다음 승인에서 이어집니다."}${result.active ? " 기존 AI 활성화는 유지됩니다." : ""}`
        : `${title} AI ${wasActive ? "설정을 갱신" : "분기를 활성화"}했습니다.`, preparing ? "" : "success");
    } catch (error) {
      const current = fixedVisualSource(storyKey);
      if (!state.catalogVerified || !current || !sameChoiceId(current.workId, snapshot.workId) ||
        !sameChoiceId(current.releaseId, snapshot.releaseId) || (!refreshedAfterAction &&
          (!fixedVisualSourceCurrent(storyKey, snapshot) || state.fixedReads[storyKey]?.ai !== read ||
            state.fixedReads[storyKey]?.coverage !== coverageRead))) return;
      const message = choiceErrorCode(error) ? choiceErrorMessage(error, "AI 상태를 다시 확인해 주세요.") :
        "AI 처리 결과를 확인하지 못했습니다. 제공자 응답·청구 내역을 확인한 뒤 상태를 새로 확인해 주세요. 자동으로 재시도하지 않습니다.";
      markFixedStatusUnknown(storyKey, "ai", message);
      setStatus(message, "error");
    } finally {
      state.activatingKey = null;
      renderStoryStatus();
    }
  }

  async function replaceStoryVisual(button) {
    const storyKey = button.dataset.storyVisualReplace;
    if (storyKey === "inheritor") return replaceInheritorVisual(button);
    const story = knownStories.find((candidate) => candidate.key === storyKey && candidate.visualIdentityManaged);
    const initialRead = state.fixedVisualReads[storyKey];
    if (!story || inheritorMutationBusy() || !fixedVisualVerified(storyKey) ||
      button.dataset.storyTargetRevision !== String(state.catalogRevision) ||
      button.dataset.storyVisualRead !== String(initialRead.sequence)) return;
    const snapshot = { workId: initialRead.workId, releaseId: initialRead.releaseId, revision: initialRead.revision };
    const visual = initialRead.value;
    const staleItems = visual.items;
    const selectedKey = button.dataset.storyVisualScene;
    const items = selectedKey ? staleItems.filter((item) => item.sourceSceneKey === selectedKey) : [...staleItems];
    if (!items.length) return;
    const checksum = visual.releaseChecksum;
    state.replacingKey = storyKey;
    delete state.fixedVisualFeedback[storyKey];
    renderStoryStatus();
    let completed = 0;
    let refreshedAfterAction = false;
    try {
      for (const item of items) {
        if (!fixedVisualSourceCurrent(storyKey, snapshot)) return;
        const read = state.fixedVisualReads[storyKey];
        if (!fixedVisualVerified(storyKey) || read.value.releaseChecksum !== checksum ||
          !read.value.items.some((candidate) => candidate.sourceSceneKey === item.sourceSceneKey)) {
          throw new Error("Visual source changed");
        }
        const result = await api.fetch(`/admin/api/v1/story-visuals/${encodeURIComponent(snapshot.workId)}/replace-stale`, {
          method: "POST", auth: true,
          body: { releaseId: snapshot.releaseId, releaseChecksum: checksum, sourceSceneKey: item.sourceSceneKey }
        });
        if (!fixedVisualSourceCurrent(storyKey, snapshot) || state.fixedVisualReads[storyKey] !== read) return;
        if (result?.status !== "ready" || !matchesTargetPair(result, snapshot) ||
          result.releaseChecksum !== checksum || result.sourceSceneKey !== item.sourceSceneKey) {
          throw new Error("Unconfirmed replacement outcome");
        }
        completed += 1;
        if (completed < items.length) {
          const refreshed = await readFixedVisualStatus(storyKey);
          if (!fixedVisualSourceCurrent(storyKey, snapshot)) return;
          if (!refreshed || refreshed.releaseChecksum !== checksum ||
            refreshed.items.some((candidate) => candidate.sourceSceneKey === item.sourceSceneKey)) {
            throw new Error("Replacement status has not been confirmed");
          }
        }
      }
      state.loaded = false;
      refreshedAfterAction = true;
      await load({ force: true, afterMutation: true });
      const current = fixedVisualSource(storyKey);
      if (!fixedVisualVerified(storyKey) || !current || !sameChoiceId(current.workId, snapshot.workId) ||
        !sameChoiceId(current.releaseId, snapshot.releaseId)) return;
      if (state.visualStatuses[storyKey].releaseChecksum !== checksum ||
        state.visualStatuses[storyKey].items.some((candidate) => items.some((item) => item.sourceSceneKey === candidate.sourceSceneKey))) {
        throw new Error("Latest replacement status differs");
      }
      setStatus(`${story.title} 장면 그림 ${completed}장을 새 기준으로 교체했습니다.`, "success");
    } catch {
      const current = fixedVisualSource(storyKey);
      if (!state.catalogVerified || !current || !sameChoiceId(current.workId, snapshot.workId) ||
        !sameChoiceId(current.releaseId, snapshot.releaseId) ||
        (!refreshedAfterAction && !fixedVisualSourceCurrent(storyKey, snapshot))) return;
      const message = `${completed}장 교체 확인 후 중단했습니다. 대상 또는 요청 결과가 불확실해 추가 교체는 차단했습니다. 제공자 응답·청구 내역과 최신 상태를 확인해 주세요. 자동으로 재시도하지 않습니다.`;
      markFixedVisualUnknown(storyKey, message);
      setStatus(message, "error");
    } finally {
      state.replacingKey = null;
      renderStoryStatus();
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
    if (event.target.matches("[data-story-choice-target]")) return selectChoiceTarget(event.target.value);
    if (event.target.matches("[data-story-ai-confirm]")) updateAiActivationButton(event.target.closest("[data-story-ai-card]"));
    if (event.target.matches("[data-story-choice-review-confirm]")) updateChoiceReviewButton(event.target.closest("[data-story-choice-review]"));
  });
  statusCards?.addEventListener("input", (event) => {
    if (event.target.matches("[data-story-choice-review-note]")) updateChoiceReviewButton(event.target.closest("[data-story-choice-review]"));
  });
  statusCards?.addEventListener("click", (event) => {
    const reviewButton = event.target.closest("[data-story-review-batch]");
    if (reviewButton) return reviewInheritorChoiceBatch(reviewButton);
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
