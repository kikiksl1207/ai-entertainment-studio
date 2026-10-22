(function () {
  "use strict";
  const ui = window.LuminaContentRightsUI;
  const api = window.LuminaCreatorStudioApi;
  const state = document.getElementById("contentRightsState");
  const list = document.getElementById("contentRightsList");
  let contracts = [];
  let acceptedDisplay = null;
  let activeLoad = null;

  function setText(id, value) { const node = document.getElementById(id); if (node) node.textContent = value; }
  function localizedMedia(value) { return String(value || "").replace(/_/g, " "); }
  function row(label, value) { return `<div><dt>${ui.esc(label)}</dt><dd>${ui.esc(value)}</dd></div>`; }

  function retireStaleDisplay() {
    const display = acceptedDisplay;
    if (!display) return;
    let current = false;
    try { current = api?.isCurrent?.(display.identity) === true; } catch (_) {}
    if (current || acceptedDisplay !== display) return;
    acceptedDisplay = null;
    contracts = [];
    if (list) list.innerHTML = "";
  }

  function render() {
    retireStaleDisplay();
    setText("contentRightsNavLabel", ui.t("nav"));
    setText("contentRightsTitle", ui.t("title"));
    setText("contentRightsIntro", ui.t("intro"));
    setText("contentRightsRefresh", ui.t("refresh"));
    const pending = document.getElementById("contentRightsPendingNotice");
    if (pending) pending.innerHTML = `<strong>${ui.esc(ui.t("pendingTitle"))}</strong><span>${ui.esc(ui.t("pendingBody"))}</span>`;
    const legacy = document.getElementById("legacySettlementIsolation");
    if (legacy) legacy.innerHTML = `<strong>${ui.esc(ui.t("legacyTitle"))}</strong><span>${ui.esc(ui.t("legacyBody"))}</span>`;
    if (!list) return;
    if (!contracts.length) { list.innerHTML = `<p class="content-rights-empty">${ui.esc(ui.t("empty"))}</p>`; return; }
    list.innerHTML = contracts.map((contract) => `<article class="content-rights-contract">
      <header><div><span>${ui.esc(contract.workType.toUpperCase())}</span><h3>${ui.esc(ui.t("contract"))} ${ui.esc(contract.id)}</h3></div><code>${ui.esc(contract.workId)}</code></header>
      <div class="content-rights-versions">${contract.versions.slice().sort((a, b) => b.revision - a.revision).map((version) => `<section class="content-rights-version">
        <div class="content-rights-version-title"><strong>${ui.esc(ui.t("revision"))} ${ui.esc(version.revision)}</strong><span>${ui.esc(ui.t(version.approvalState || "draft"))}</span></div>
        <dl>${row(ui.t(version.role), version.agencyIdentifier || ui.t(version.role))}${row(ui.t("ownShare"), ui.percent(version.ownBps))}${row(ui.t("contentVersion"), version.contentVersionId)}${row(ui.t("exclusivity"), ui.t(version.exclusivity))}${row(ui.t("media"), version.media.map(localizedMedia).join(", "))}${row(ui.t("regions"), version.regions.join(", "))}${row(ui.t("period"), `${ui.date(version.startsAt)} - ${version.endsAt ? ui.date(version.endsAt) : "-"}`)}${row(ui.t("effective"), ui.date(version.effectiveFrom))}${row(ui.t("rights"), `${ui.t("sale")}: ${ui.t(version.saleAllowed ? "yes" : "no")} · ${ui.t("ai")}: ${ui.t(version.aiTransformationAllowed ? "yes" : "no")} · ${ui.t("reuse")}: ${ui.t(version.generatedResultReuseAllowed ? "yes" : "no")}`)}${row(ui.t("policies"), ui.t("unresolved"))}</dl>
      </section>`).join("")}</div>
    </article>`).join("");
  }

  function currentLoad(request) {
    try { const current = api.isCurrent(request.identity); return current === true && activeLoad === request; }
    catch (_) { return false; }
  }

  async function load() {
    if (!api || !state || !list || typeof api.identity !== "function" || typeof api.isCurrent !== "function") return;
    const request = { identity: null };
    activeLoad = request;
    try {
      request.identity = api.identity();
      retireStaleDisplay();
      if (!currentLoad(request)) return;
      state.textContent = ui.t("loading");
      if (!currentLoad(request)) return;
      const response = await api.fetch("/api/v1/me/creator-studio/content-rights-contracts", { identity: request.identity });
      if (!currentLoad(request)) return;
      if (!response?.ok) {
        state.textContent = response?.status === 403 ? ui.t("forbidden") : ui.t("error");
        contracts = [];
        acceptedDisplay = null;
        render();
        return;
      }
      const data = await response.json();
      if (!currentLoad(request)) return;
      const userId = api.currentUser()?.id;
      if (!currentLoad(request)) return;
      contracts = (data?.items || []).map((item) => ui.partyView(item, userId)).filter(Boolean);
      acceptedDisplay = { identity: request.identity };
      state.textContent = contracts.length ? "" : ui.t("empty");
      render();
    } catch (_) {
      if (!currentLoad(request)) return;
      contracts = [];
      acceptedDisplay = null;
      state.textContent = ui.t("error");
      render();
    }
  }

  document.getElementById("contentRightsRefresh")?.addEventListener("click", load);
  window.addEventListener("lumina:localechange", render);
  window.addEventListener("storage", retireStaleDisplay);
  window.addEventListener("lumina:authchange", retireStaleDisplay);
  window.addEventListener("focus", retireStaleDisplay);
  window.LuminaCreatorContentRights = { load };
  render();
  if (document.getElementById("content-rights")?.classList.contains("is-active")) load();
})();
