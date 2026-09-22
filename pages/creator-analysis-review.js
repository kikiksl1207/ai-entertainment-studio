(function initWriterAnalysis() {
  "use strict";
  const api = window.LuminaCreatorStudioApi;
  const manuscript = window.LuminaCreatorManuscript;
  const panel = document.getElementById("writerAnalysis");
  if (!api || !manuscript || !panel) return;
  const root = "/api/v1/me/creator-studio";
  const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  const locales = ["ko", "en", "ja", "zh-Hans", "zh-Hant"];
  const languageNames = { ko: "한국어", en: "English", ja: "日本語", "zh-Hans": "简体中文", "zh-Hant": "繁體中文" };
  const el = Object.fromEntries(["Version", "State", "Progress", "Counts", "Start", "Check", "Boundary", "Evidence", "Pages", "Previous", "Next", "PageCount"].map(name => [name, document.getElementById("writerAnalysis" + name)]));
  const discovery = document.getElementById("writerDiscovery");
  const de = Object.fromEntries(["State", "Refresh", "Versions", "Jobs", "VersionsPrevious", "VersionsNext", "JobsPrevious", "JobsNext"].map(name => [name, document.getElementById("writerDiscovery" + name)]));
  let discoveryScope = null;
  let discoveryEpoch = 0;
  let discoveryBusy = false;
  let discoveryPhase = "chooseVersion";
  let selectedVersion = null;
  let versions = listPage();
  let jobs = listPage();
  let viewOnly = false;
  let scope = null;
  let receipt = null;
  let job = null;
  let requestKey = null;
  let analysisId = null;
  let epoch = 0;
  let busy = false;
  let starting = false;
  let phase = "ready";
  let page = emptyPage();
  let history = [];
  let poll = null;
  let pollDelay = 2500;
  let renderedIds = [];
  let renderedCursor;
  let renderedEpoch = -1;
  const controllers = new Set();
  const discoveryControllers = new Set();

  function t(key, values = {}) {
    const value = window.luminaI18n.t("writerAnalysis." + key);
    return value.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
  }
  function emptyPage() { return { cursor: null, start: 0, rows: [], endCursor: null, hasMore: false, nextCursor: null }; }
  function listPage() { return { cursor: null, items: [], nextCursor: null, back: [] }; }
  function context() { return { ...manuscript.context(), identity: api.identity() }; }
  function sameContext(left, right) {
    return Boolean(left && right && left.workId === right.workId && left.sourceLocale === right.sourceLocale &&
      left.identity.ownerId === right.identity.ownerId && left.identity.epoch === right.identity.epoch);
  }
  function current(stamp = epoch) {
    if (stamp !== epoch || !scope) return false;
    const next = context();
    if (!api.isCurrent(scope.identity) || scope.workId !== next.workId || (!viewOnly && scope.sourceLocale !== next.sourceLocale)) { invalidate(); return false; }
    return true;
  }
  function stopRequests() {
    epoch++;
    controllers.forEach(controller => controller.abort());
    controllers.clear();
    clearTimeout(poll);
    poll = null;
    busy = false;
  }
  function clearDetail() {
    stopRequests();
    scope = null; receipt = null; job = null; analysisId = null; requestKey = null;
    starting = false; page = emptyPage(); history = [];
    panel.hidden = true;
    el.Evidence.replaceChildren();
    el.State.textContent = ""; el.Counts.textContent = ""; el.Version.textContent = "";
  }
  function invalidate() {
    clearDetail();
    discoveryControllers.forEach(controller => controller.abort()); discoveryControllers.clear();
    discoveryEpoch++; discoveryBusy = false; discoveryScope = null; selectedVersion = null;
    versions = listPage(); jobs = listPage();
    if (discovery) { discovery.hidden = true; de.Versions.replaceChildren(); de.Jobs.replaceChildren(); de.State.textContent = ""; }
  }
  function receiptKey() { return `lumina.writer.analysis:${scope.identity.ownerId}:${receipt.id}`; }
  function pointerKey() { return `lumina.writer.resume:${scope.identity.ownerId}:${scope.workId}:${scope.sourceLocale}`; }
  function remember() {
    // Store only scoped identifiers and the original request key, never source, quotes, or evidence.
    try {
      sessionStorage.setItem(receiptKey(), JSON.stringify({ requestKey, analysisId }));
      sessionStorage.setItem(pointerKey(), JSON.stringify({ manuscriptId: receipt.id }));
      return true;
    } catch (_) { return false; }
  }
  function savedRequest() {
    try {
      const value = JSON.parse(sessionStorage.getItem(receiptKey()) || "null");
      if (value && (!value.requestKey || /^[A-Za-z0-9_-]{8,200}$/.test(value.requestKey)) && (!value.analysisId || uuid.test(value.analysisId))) return value;
    } catch (_) {}
    return null;
  }
  function receive(value, discovered = false) {
    clearDetail(); viewOnly = discovered;
    if (!discovered) { selectedVersion = null; jobs = listPage(); renderDiscovery(); }
    scope = context();
    if (!scope.identity.ownerId || !uuid.test(value?.id || "") || value.workId !== scope.workId ||
        (!discovered && value.sourceLocale !== scope.sourceLocale) || !api.isCurrent(value.identity)) return invalidate();
    scope.sourceLocale = value.sourceLocale;
    receipt = { ...value };
    const saved = savedRequest();
    requestKey = saved?.requestKey || null;
    analysisId = discovered ? null : saved?.analysisId || null;
    phase = discovered ? "chooseAnalysis" : analysisId ? "loading" : requestKey ? "unknown" : "ready";
    render();
    if (analysisId) loadPage(null, 0);
  }
  function contextChanged() {
    const next = context();
    if (discovery && next.identity.ownerId && uuid.test(next.workId) &&
        (!discoveryScope || !api.isCurrent(discoveryScope.identity) || discoveryScope.workId !== next.workId)) {
      invalidate(); discoveryScope = next; renderDiscovery(); loadDiscovery("Versions");
      return;
    }
    if (viewOnly && scope?.workId === next.workId && api.isCurrent(scope.identity)) return;
    if (sameContext(scope, next)) return;
    invalidate();
    if (!next.identity.ownerId || !uuid.test(next.workId) || !locales.includes(next.sourceLocale)) return;
    const retained = manuscript.receipt();
    if (retained?.workId === next.workId && retained.sourceLocale === next.sourceLocale && api.isCurrent(retained.identity)) return receive(retained);
    if (document.getElementById("writerManuscriptBody")?.value) return;
    scope = next;
    try {
      const pointer = JSON.parse(sessionStorage.getItem(pointerKey()) || "null");
      if (!uuid.test(pointer?.manuscriptId || "")) return invalidate();
      receive({ id: pointer.manuscriptId, workId: next.workId, sourceLocale: next.sourceLocale, identity: next.identity });
    } catch (_) { invalidate(); }
  }
  async function request(path, options = {}, stamp = epoch, guard = current, identity = scope?.identity) {
    if (!guard(stamp)) throw new Error("stale");
    const controller = new AbortController();
    const pool = guard === current ? controllers : discoveryControllers;
    pool.add(controller);
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await api.fetch(root + path, { ...options, signal: controller.signal, identity });
      const data = await response.json().catch(() => null);
      if (!guard(stamp)) throw new Error("stale");
      if (!response.ok) throw Object.assign(new Error("request"), { status: response.status, code: data?.error?.code || data?.code || "",
        analysisJobId: data?.error?.details?.analysisJobId });
      return data;
    } finally { clearTimeout(timeout); pool.delete(controller); }
  }
  function currentDiscovery(stamp = discoveryEpoch) {
    if (stamp !== discoveryEpoch || !discoveryScope) return false;
    if (!api.isCurrent(discoveryScope.identity) || discoveryScope.workId !== context().workId) { invalidate(); return false; }
    return true;
  }
  function renderDiscovery() {
    if (!discovery) return;
    discovery.hidden = !discoveryScope;
    de.State.textContent = t(discoveryPhase);
    de.Refresh.disabled = discoveryBusy;
    for (const [kind, data] of [["Versions", versions], ["Jobs", jobs]]) {
      const chosen = kind === "Versions" ? selectedVersion?.id : analysisId;
      const options = [new Option(t(kind === "Versions" ? "chooseVersion" : "chooseAnalysis"), "")];
      data.items.forEach(item => options.push(new Option(kind === "Versions" ?
        t("version", { version: item.version, language: languageNames[item.locale] }) :
        t("analysisOption", { version: item.analysisVersion, status: t(item.kind === "structural_legacy" ? "structure" : "job" + item.status) }), item.id)));
      de[kind].replaceChildren(...options); de[kind].value = chosen || "";
      de[kind].disabled = discoveryBusy || !data.items.length;
      de[kind + "Previous"].disabled = discoveryBusy || !data.back.length;
      de[kind + "Next"].disabled = discoveryBusy || !data.nextCursor;
      for (const direction of ["Previous", "Next"]) {
        de[kind + direction].title = t(direction.toLowerCase());
        de[kind + direction].setAttribute("aria-label", t(direction.toLowerCase()) + " · " + t(kind === "Versions" ? "manuscriptVersion" : "existingAnalysis"));
      }
    }
  }
  async function loadDiscovery(kind, cursor = null, navigation = null) {
    if (!currentDiscovery() || discoveryBusy || (kind === "Jobs" && !selectedVersion)) return;
    const stamp = discoveryEpoch;
    const parent = kind === "Versions" ? discoveryScope.workId : selectedVersion.id;
    const previous = kind === "Versions" ? versions : jobs;
    discoveryBusy = true; discoveryPhase = "loading"; renderDiscovery();
    try {
      const query = new URLSearchParams({ limit: "12" }); if (cursor) query.set("cursor", cursor);
      const data = await request(kind === "Versions" ? `/stories/${parent}/manuscripts?${query}` : `/manuscripts/${parent}/analyses?${query}`,
        {}, stamp, currentDiscovery, discoveryScope.identity);
      const field = kind === "Versions" ? "version" : "analysisVersion";
      if ((kind === "Versions" ? data?.workId : data?.manuscriptVersionId) !== parent || !Array.isArray(data.items) || data.items.length > 12 ||
          typeof data.hasMore !== "boolean" || (data.hasMore ? !data.items.length || data.nextCursor !== data.items.at(-1).id : data.nextCursor !== null) ||
          new Set(data.items.map(item => item.id)).size !== data.items.length || data.items.some((item, index) =>
            !uuid.test(item.id) || item.id === cursor || !Number.isSafeInteger(item[field]) || item[field] < 1 ||
            (index && item[field] >= data.items[index - 1][field]) ||
            (navigation === "next" && previous.items.length && item[field] >= previous.items.at(-1)[field]) || (kind === "Versions" ?
              item.workId !== parent || !locales.includes(item.locale) || !/^[a-f0-9]{64}$/i.test(item.contentHash || "") :
              item.manuscriptVersionId !== parent || !["queued", "running", "completed", "failed"].includes(item.status) ||
              (item.kind === "semantic_extraction_v1" ? item.sourceLocale !== selectedVersion.locale || item.sourceContentHash !== selectedVersion.contentHash : item.kind !== "structural_legacy")))) throw new Error("discovery");
      const back = navigation === "next" ? [...previous.back, previous.cursor] : navigation === "previous" ? previous.back.slice(0, -1) : [];
      const next = { cursor, items: data.items, nextCursor: data.nextCursor, back };
      if (kind === "Versions") versions = next; else jobs = next;
      discoveryPhase = data.items.length ? kind === "Versions" ? "chooseVersion" : "chooseAnalysis" : kind === "Versions" ? "noVersions" : "noAnalyses";
    } catch (error) {
      if (!currentDiscovery(stamp)) return;
      if ([401, 403, 404].includes(error.status)) { invalidate(); return; }
      discoveryPhase = "loadFailed";
    } finally { if (currentDiscovery(stamp)) { discoveryBusy = false; renderDiscovery(); } }
  }
  function selectVersion() {
    if (discoveryBusy || !currentDiscovery()) return;
    const value = versions.items.find(item => item.id === de.Versions.value);
    discoveryEpoch++; jobs = listPage(); selectedVersion = value || null;
    clearDetail();
    if (value) {
      receive({ ...value, sourceLocale: value.locale, identity: discoveryScope.identity }, true);
      loadDiscovery("Jobs");
    } else renderDiscovery();
  }
  function openExisting(id) {
    if (!uuid.test(id || "") || !receipt || !current()) return;
    stopRequests(); starting = false; analysisId = id; job = null; page = emptyPage(); history = [];
    viewOnly = true; phase = "loading"; render();
    return loadPage(null, 0);
  }
  function validJob(value) {
    const semantic = value?.kind === "semantic_extraction_v1";
    return value && uuid.test(value.id) && value.manuscriptVersionId === receipt.id &&
      (!analysisId || value.id === analysisId) && ["queued", "running", "completed", "failed"].includes(value.status) &&
      (semantic ? value.sourceLocale === scope.sourceLocale && /^[0-9a-f]{64}$/i.test(value.sourceContentHash || "") &&
        (!receipt.contentHash || value.sourceContentHash === receipt.contentHash) : value.kind === "structural_legacy" &&
        (value.sourceLocale == null || value.sourceLocale === scope.sourceLocale) &&
        (value.sourceContentHash == null || !receipt.contentHash || value.sourceContentHash === receipt.contentHash)) &&
      Number.isSafeInteger(value.evidenceCount) && value.evidenceCount >= 0;
  }
  function acceptJob(value) {
    if (!validJob(value)) throw new Error("projection");
    job = value; analysisId = value.id; remember();
    if (value.kind !== "semantic_extraction_v1") phase = "structural";
    else if (value.status === "completed") phase = value.semanticCompleted && value.progress?.coverageComplete ? "completed" : "incomplete";
    else if (value.status === "failed") phase = value.budget?.usageUnobserved ? "failedUnknown" : "failed";
    else phase = value.status === "queued" ? "queued" : ["planning", "extracting", "finalizing"].includes(value.phase) ? value.phase : "queued";
  }
  function handleError(error, isStart = false) {
    if ([401, 403, 404].includes(error.status)) { invalidate(); return; }
    if (isStart && error.code === "ANALYSIS_VERSION_ALREADY_RESERVED") phase = "reserved";
    else if (isStart && error.code === "SEMANTIC_ANALYSIS_UNAVAILABLE") phase = "unavailable";
    else phase = isStart ? "unknown" : "loadFailed";
    render();
  }
  async function start() {
    if (!receipt || viewOnly || analysisId || busy || phase === "reserved" || !current()) return;
    clearTimeout(poll);
    if (!requestKey) requestKey = crypto.randomUUID();
    if (!remember()) { phase = "storageUnavailable"; render(); return; }
    const stamp = epoch;
    busy = true; starting = true; phase = "starting"; render();
    try {
      acceptJob(await request(`/manuscripts/${receipt.id}/analyses`, { method: "POST", headers: { "Idempotency-Key": requestKey } }, stamp));
      if (current(stamp)) { busy = false; starting = false; await loadPage(null, 0); }
    } catch (error) {
      if (current(stamp)) {
        if (error.status === 409 && error.code === "ANALYSIS_VERSION_ALREADY_RESERVED" && uuid.test(error.analysisJobId || "")) await openExisting(error.analysisJobId);
        else handleError(error, true);
      }
    }
    finally { if (current(stamp)) { busy = false; starting = false; render(); } }
  }
  function validEvidence(row) {
    if (!row || !uuid.test(row.id) || !["semantic_candidate", "structural_only", "structural_legacy"].includes(row.provenance)) return false;
    return row.provenance !== "semantic_candidate" || (row.interpretation === "model_inference" && row.factualTruthApproved === false &&
      row.sourceLocale === scope.sourceLocale && typeof row.title === "string" && row.title.length <= 120 &&
      typeof row.observation === "string" && row.observation.length <= 1200 && Array.isArray(row.citations) && row.citations.length > 0 && row.citations.length <= 4);
  }
  function validatePage(data, cursor) {
    if (!validJob(data?.job) || !Array.isArray(data.evidence) || data.evidence.length > 100 ||
        !data.evidence.every(validEvidence) || new Set(data.evidence.map(row => row.id)).size !== data.evidence.length ||
        typeof data.hasMore !== "boolean" || data.endCursor !== (data.evidence.at(-1)?.id || cursor) ||
        (data.hasMore ? !data.evidence.length || data.nextCursor !== data.endCursor : data.nextCursor !== null) ||
        data.evidence.some(row => row.id === cursor)) throw new Error("page");
    return data;
  }
  async function loadPage(cursor, startIndex, { append = false, pollOnly = false, navigation = null } = {}) {
    if (!analysisId || busy || !current()) return;
    clearTimeout(poll);
    const stamp = epoch;
    busy = true; renderControls();
    try {
      const query = cursor ? "?" + new URLSearchParams({ cursor }) : "";
      const data = validatePage(await request(`/analyses/${analysisId}${query}`, {}, stamp), cursor);
      if (!current(stamp)) return;
      acceptJob(data.job);
      if (!pollOnly) {
        const rows = append ? [...page.rows, ...data.evidence] : data.evidence;
        if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("duplicate evidence");
        const visible = rows.slice(0, 100);
        const more = rows.length > 100 || data.hasMore;
        if (navigation === "next") history.push({ cursor: page.cursor, start: page.start });
        if (navigation === "previous") history.pop();
        page = { cursor: append ? page.cursor : cursor, start: startIndex, rows: visible,
          endCursor: visible.at(-1)?.id || cursor, hasMore: more, nextCursor: more ? visible.at(-1)?.id : null };
      }
      pollDelay = 2500;
      render();
    } catch (error) { if (current(stamp)) { pollDelay = Math.min(pollDelay * 2, 15000); handleError(error); } }
    finally { if (current(stamp)) { busy = false; renderControls(); schedulePoll(); } }
  }
  function schedulePoll() {
    clearTimeout(poll);
    if (!current() || document.hidden || !["queued", "running"].includes(job?.status) || busy) return;
    poll = setTimeout(() => loadPage(page.endCursor, page.start, { append: !page.hasMore, pollOnly: page.hasMore }), pollDelay);
  }
  function renderControls() {
    panel.hidden = !receipt;
    el.Start.hidden = viewOnly || Boolean(job) || !["ready", "unavailable", "storageUnavailable"].includes(phase);
    el.Start.disabled = busy;
    el.Check.hidden = !analysisId && phase !== "unknown";
    el.Check.disabled = busy;
    el.Check.textContent = t(analysisId ? "check" : "checkRequest");
    el.Previous.disabled = busy || !history.length;
    el.Next.disabled = busy || !page.hasMore;
    el.Previous.title = t("previous"); el.Previous.setAttribute("aria-label", t("previous"));
    el.Next.title = t("next"); el.Next.setAttribute("aria-label", t("next"));
    el.Pages.setAttribute("aria-label", t("evidence"));
    el.Pages.hidden = !job || !page.rows.length;
  }
  function render() {
    if (!receipt) return;
    renderControls();
    el.Version.textContent = t(receipt.version ? "version" : "savedVersion", { version: receipt.version, language: languageNames[scope.sourceLocale] });
    el.State.textContent = t(phase);
    el.State.classList.toggle("is-danger", ["unknown", "failed", "failedUnknown", "unavailable", "loadFailed", "incomplete", "reserved", "storageUnavailable"].includes(phase));
    el.Boundary.hidden = !job;
    const counters = job?.progress;
    const total = counters?.totalParagraphs;
    const done = job?.phase === "planning" ? counters?.plannedParagraphs : counters?.completedParagraphs;
    el.Progress.hidden = !job || job.kind !== "semantic_extraction_v1";
    if (Number.isSafeInteger(total) && total > 0 && Number.isSafeInteger(done) && done >= 0 && done <= total) {
      el.Progress.max = total; el.Progress.value = done;
      el.Counts.textContent = t("counts", { done, total, evidence: job.evidenceCount });
    } else { el.Progress.removeAttribute("value"); el.Counts.textContent = ""; }
    el.Progress.setAttribute("aria-label", t("title"));
    el.PageCount.textContent = t("pageCount", { from: page.start + 1, to: page.start + page.rows.length, total: job?.evidenceCount || 0 });
    // Evidence is append-only on the server. Preserve open quotes and focus during status polling.
    if (renderedEpoch !== epoch || renderedCursor !== page.cursor || renderedIds.length > page.rows.length ||
        renderedIds.some((id, index) => id !== page.rows[index]?.id)) {
      el.Evidence.replaceChildren(); renderedIds = [];
    }
    el.Evidence.append(...page.rows.slice(renderedIds.length).map(evidenceElement));
    renderedIds = page.rows.map(row => row.id); renderedCursor = page.cursor; renderedEpoch = epoch;
  }
  function evidenceElement(row) {
    const item = document.createElement("article"); item.className = "writer-analysis-item";
    const heading = document.createElement("h3"); heading.textContent = row.title || t("structure");
    const text = document.createElement("p"); text.textContent = row.observation || t("structureNote");
    const provenance = document.createElement("p"); provenance.className = "writer-analysis-meta";
    provenance.textContent = t(row.provenance === "semantic_candidate" ? "inference" : "structure");
    item.append(heading, provenance, text);
    if (row.provenance === "semantic_candidate") {
      const button = document.createElement("button"); button.type = "button"; button.className = "secondary-action"; button.textContent = t("source");
      const quote = document.createElement("div"); quote.hidden = true;
      button.setAttribute("aria-expanded", "false");
      button.addEventListener("click", () => {
        if (!quote.hidden && !quote.dataset.failed) { quote.replaceChildren(); quote.hidden = true; button.setAttribute("aria-expanded", "false"); return; }
        loadQuote(row, quote, button);
      });
      item.append(button, quote);
    }
    return item;
  }
  async function loadQuote(row, target, button) {
    if (!current() || button.disabled) return;
    const stamp = epoch;
    delete target.dataset.failed;
    button.disabled = true; target.hidden = false; target.textContent = t("loading"); button.setAttribute("aria-expanded", "true");
    try {
      const data = await request(`/analyses/${analysisId}/evidence/${row.id}/source`, {}, stamp);
      if (!current(stamp) || !target.isConnected) return;
      if (data?.evidenceId !== row.id || data.manuscriptVersionId !== receipt.id || data.sourceLocale !== scope.sourceLocale ||
          !Array.isArray(data.citations) || data.citations.length !== row.citations.length || !data.citations.length || data.citations.length > 4) throw new Error("citation");
      const fragments = data.citations.map((citation, index) => {
        const expected = row.citations[index];
        if (!["partIndex", "partKey", "paragraphIndex", "start", "end", "quoteHash"].every(key => citation[key] === expected[key]) ||
            !Number.isSafeInteger(citation.partIndex) || !Number.isSafeInteger(citation.paragraphIndex) ||
            citation.partIndex < 0 || citation.paragraphIndex < 0 || !Number.isSafeInteger(citation.start) ||
            !Number.isSafeInteger(citation.end) || citation.start < 0 || citation.end <= citation.start ||
            !/^[a-f0-9]{64}$/.test(citation.quoteHash) || typeof citation.quote !== "string" ||
            citation.quote.length !== citation.end - citation.start || citation.quote.length > 512) throw new Error("citation");
        const fragment = document.createElement("div");
        const label = document.createElement("p"); label.className = "writer-analysis-meta";
        label.textContent = t("location", { part: citation.partIndex + 1, paragraph: citation.paragraphIndex + 1 });
        const quote = document.createElement("blockquote"); quote.textContent = citation.quote;
        fragment.append(label, quote); return fragment;
      });
      target.replaceChildren(...fragments);
    } catch (error) {
      if (current(stamp) && target.isConnected) {
        if ([401, 403, 404].includes(error.status)) { invalidate(); return; }
        target.textContent = t("quoteFailed"); target.dataset.failed = "true";
      }
    }
    finally { if (current(stamp) && target.isConnected) button.disabled = false; }
  }

  el.Start.addEventListener("click", start);
  if (discovery) {
    de.Refresh.addEventListener("click", () => loadDiscovery(selectedVersion ? "Jobs" : "Versions"));
    de.Versions.addEventListener("change", selectVersion);
    de.Jobs.addEventListener("change", () => {
      if (discoveryBusy || !currentDiscovery()) return;
      if (jobs.items.some(item => item.id === de.Jobs.value)) openExisting(de.Jobs.value);
      else if (selectedVersion) receive({ ...selectedVersion, sourceLocale: selectedVersion.locale, identity: discoveryScope.identity }, true);
    });
    for (const kind of ["Versions", "Jobs"]) for (const direction of ["Previous", "Next"]) {
      de[kind + direction].addEventListener("click", () => {
        const data = kind === "Versions" ? versions : jobs;
        if (direction === "Next" && data.nextCursor) loadDiscovery(kind, data.nextCursor, "next");
        if (direction === "Previous" && data.back.length) loadDiscovery(kind, data.back.at(-1), "previous");
      });
    }
  }
  el.Check.addEventListener("click", () => analysisId ? loadPage(page.cursor, page.start) : start());
  el.Next.addEventListener("click", () => {
    if (busy || !page.hasMore || !page.nextCursor || history.some(item => item.cursor === page.nextCursor)) return;
    loadPage(page.nextCursor, page.start + page.rows.length, { navigation: "next" });
  });
  el.Previous.addEventListener("click", () => {
    if (busy || !history.length) return;
    const previous = history.at(-1); loadPage(previous.cursor, previous.start, { navigation: "previous" });
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) clearTimeout(poll); else if (current()) schedulePoll(); });
  window.addEventListener("lumina:localechange", () => {
    discoveryControllers.forEach(controller => controller.abort()); discoveryControllers.clear();
    discoveryEpoch++; discoveryBusy = false; renderDiscovery();
    if (!receipt) return;
    const wasStarting = starting;
    stopRequests(); starting = false;
    if (wasStarting) phase = "unknown";
    render();
    if (job) loadPage(page.cursor, page.start);
  });
  window.addEventListener("storage", event => { if (["lumina_auth", "lumina.session", null].includes(event.key)) current(); });
  window.addEventListener("lumina:auth-expired", invalidate);
  window.addEventListener("pagehide", invalidate);
  window.addEventListener("focus", () => current());
  setInterval(() => { manuscript.checkOwner?.(); if (scope) current(); if (discoveryScope) currentDiscovery(); }, 1000);
  window.LuminaCreatorAnalysis = { receive, invalidate, contextChanged, draftChanged: () => { if (!viewOnly) clearDetail(); } };
  if (manuscript.receipt()) receive(manuscript.receipt()); else contextChanged();
})();
