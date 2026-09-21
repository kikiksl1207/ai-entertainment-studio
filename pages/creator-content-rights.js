(function () {
  "use strict";
  const ui = window.LuminaContentRightsUI;
  const api = window.LuminaCreatorStudioApi;
  const state = document.getElementById("contentRightsState");
  const list = document.getElementById("contentRightsList");
  let contracts = [];

  function setText(id, value) { const node = document.getElementById(id); if (node) node.textContent = value; }
  function localizedMedia(value) { return String(value || "").replace(/_/g, " "); }
  function row(label, value) { return `<div><dt>${ui.esc(label)}</dt><dd>${ui.esc(value)}</dd></div>`; }

  function render() {
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

  async function load() {
    if (!api || !state || !list) return;
    state.textContent = ui.t("loading");
    try {
      const response = await api.fetch("/api/v1/me/creator-studio/content-rights-contracts");
      if (!response?.ok) {
        state.textContent = response?.status === 403 ? ui.t("forbidden") : ui.t("error");
        contracts = [];
        render();
        return;
      }
      const data = await response.json();
      const userId = api.currentUser()?.id;
      contracts = (data?.items || []).map((item) => ui.partyView(item, userId)).filter(Boolean);
      state.textContent = contracts.length ? "" : ui.t("empty");
      render();
    } catch (_) {
      contracts = [];
      state.textContent = ui.t("error");
      render();
    }
  }

  document.getElementById("contentRightsRefresh")?.addEventListener("click", load);
  window.addEventListener("lumina:localechange", render);
  window.LuminaCreatorContentRights = { load };
  render();
  if (document.getElementById("content-rights")?.classList.contains("is-active")) load();
})();
