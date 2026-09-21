(function () {
  "use strict";
  const ui = window.LuminaContentRightsUI;
  const api = window.LuminaBackstageApi;
  const form = document.getElementById("adminContentRightsForm");
  const list = document.getElementById("adminContentRightsList");
  const state = document.getElementById("adminContentRightsState");
  const formState = document.getElementById("adminContentRightsFormState");
  let contracts = [];

  function setText(id, value) { const node = document.getElementById(id); if (node) node.textContent = value; }
  function field(name) { return form?.elements?.namedItem(name); }
  function formatMedia(values) { return (values || []).map((value) => String(value).replace(/_/g, " ")).join(", "); }
  function row(label, value) { return `<div><dt>${ui.esc(label)}</dt><dd>${ui.esc(value)}</dd></div>`; }
  function localValue(value) {
    if (!value) return "";
    const date = new Date(value);
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function localize() {
    setText("adminContentRightsTitle", ui.t("adminTitle"));
    setText("adminContentRightsBoundary", ui.t("adminBoundary"));
    setText("adminContentRightsFormTitle", field("mode")?.value === "revise" ? ui.t("reviseDraft") : ui.t("newDraft"));
    setText("adminContentRightsSubmit", field("mode")?.value === "revise" ? ui.t("saveRevision") : ui.t("save"));
    setText("adminContentRightsListTitle", ui.t("history"));
    setText("adminContentRightsRefresh", ui.t("refresh"));
    setText("adminContentRightsReset", ui.t("newDraft"));
    setText("adminContentRightsPolicyBoundary", ui.t("policyBoundary"));
    const aliases = { contentVersionId: "contentVersion", saleAllowed: "sale", aiTransformationAllowed: "ai", generatedResultReuseAllowed: "reuse" };
    document.querySelectorAll("[data-rights-label]").forEach((node) => { node.textContent = ui.t(aliases[node.dataset.rightsLabel] || node.dataset.rightsLabel); });
    render();
  }

  function render() {
    if (!list) return;
    document.getElementById("contentRightsCountBadge").textContent = String(contracts.length);
    if (!contracts.length) { list.innerHTML = `<p class="content-rights-admin-empty">${ui.esc(ui.t("empty"))}</p>`; return; }
    const canWrite = api.canWriteContentRights();
    list.innerHTML = contracts.map((contract) => `<section class="content-rights-admin-contract">
      <header><div><span>${ui.esc(contract.workType?.toUpperCase())}</span><strong>${ui.esc(contract.id)}</strong><code>${ui.esc(contract.workId)}</code></div></header>
      <div class="content-rights-admin-versions">${(contract.versions || []).slice().sort((a, b) => b.revision - a.revision).map((version) => `<article>
        <div class="content-rights-version-title"><strong>${ui.esc(ui.t("revision"))} ${ui.esc(version.revision)}</strong><span>${ui.esc(ui.t(version.approvalState || "draft"))}</span></div>
        <dl>${row(ui.t("contentVersion"), version.contentVersionId)}${row(ui.t("exclusivity"), ui.t(version.exclusivity))}${row(ui.t("media"), formatMedia(version.media))}${row(ui.t("regions"), (version.regions || []).join(", "))}${row(ui.t("period"), `${ui.date(version.startsAt)} - ${version.endsAt ? ui.date(version.endsAt) : "-"}`)}${row(ui.t("rights"), `${ui.t("sale")}: ${ui.t(version.saleAllowed ? "yes" : "no")} · ${ui.t("ai")}: ${ui.t(version.aiTransformationAllowed ? "yes" : "no")} · ${ui.t("reuse")}: ${ui.t(version.generatedResultReuseAllowed ? "yes" : "no")}`)}${row(ui.t("allShares"), `${ui.t("author")}/${ui.t("rights_holder")}: ${ui.percent(version.shares?.authorRightsHolderBps)} · ${ui.t("sales_agency")}: ${ui.percent(version.shares?.salesAgencyBps)} · ${ui.t("companyShare")}: ${ui.percent(version.shares?.companyBps)}`)}${row(ui.t("internalCost"), ui.t("internalCostValue"))}${row(ui.t("policies"), ui.t("unresolved"))}</dl>
        ${canWrite ? `<button class="secondary-action rights-revise" type="button" data-contract-id="${ui.esc(contract.id)}" data-version-id="${ui.esc(version.id)}">${ui.esc(ui.t("prepareRevision"))}</button>` : ""}
      </article>`).join("")}</div>
      <div class="content-rights-admin-audits"><strong>${ui.esc(ui.t("history"))}</strong>${(contract.audits || []).map((audit) => `<span>${ui.esc(audit.action)} · ${ui.esc(ui.date(audit.createdAt))}</span>`).join("") || `<span>${ui.esc(ui.t("empty"))}</span>`}</div>
    </section>`).join("");
  }

  function reset() {
    form?.reset();
    if (!form) return;
    field("mode").value = "create";
    field("contractId").value = "";
    field("sourceVersionId").value = "";
    field("workId").disabled = false;
    field("workType").disabled = false;
    field("regions").value = "WORLDWIDE";
    field("salesAgencyShareBps").value = "0";
    formState.textContent = "";
    localize();
  }

  function prepare(contractId, versionId) {
    const contract = contracts.find((item) => item.id === contractId);
    const version = contract?.versions?.find((item) => item.id === versionId);
    if (!contract || !version || !form) return;
    const creator = (version.parties || []).find((party) => party.role === "author" || party.role === "rights_holder");
    const agency = (version.parties || []).find((party) => party.role === "sales_agency");
    field("mode").value = "revise"; field("contractId").value = contract.id; field("sourceVersionId").value = version.id;
    field("workType").value = contract.workType; field("workId").value = contract.workId; field("workId").disabled = true; field("workType").disabled = true;
    field("contentVersionId").value = version.contentVersionId; field("exclusivity").value = version.exclusivity; field("regions").value = (version.regions || []).join(", ");
    field("startsAt").value = localValue(version.startsAt); field("endsAt").value = localValue(version.endsAt); field("effectiveFrom").value = localValue(version.effectiveFrom);
    field("creatorRole").value = creator?.role || "author"; field("creatorUserId").value = creator?.userId || ""; field("authorRightsHolderShareBps").value = version.shares?.authorRightsHolderBps ?? "";
    field("agencyIdentifier").value = agency?.agencyIdentifier || ""; field("agencyUserId").value = agency?.userId || ""; field("salesAgencyShareBps").value = version.shares?.salesAgencyBps ?? 0;
    field("saleAllowed").checked = version.saleAllowed === true; field("aiTransformationAllowed").checked = version.aiTransformationAllowed === true; field("generatedResultReuseAllowed").checked = version.generatedResultReuseAllowed === true;
    form.querySelectorAll('input[name="media"]').forEach((input) => { input.checked = (version.media || []).includes(input.value); });
    localize(); form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function values() {
    const media = [...form.querySelectorAll('input[name="media"]:checked')].map((input) => input.value);
    return {
      workId: field("workId").value.trim(), contentVersionId: field("contentVersionId").value.trim(), exclusivity: field("exclusivity").value, media, regions: field("regions").value,
      startsAt: field("startsAt").value, endsAt: field("endsAt").value, effectiveFrom: field("effectiveFrom").value, creatorRole: field("creatorRole").value, creatorUserId: field("creatorUserId").value.trim(),
      authorRightsHolderShareBps: Number(field("authorRightsHolderShareBps").value), agencyIdentifier: field("agencyIdentifier").value.trim(), agencyUserId: field("agencyUserId").value.trim(), salesAgencyShareBps: Number(field("salesAgencyShareBps").value),
      saleAllowed: field("saleAllowed").checked, aiTransformationAllowed: field("aiTransformationAllowed").checked, generatedResultReuseAllowed: field("generatedResultReuseAllowed").checked
    };
  }

  async function submit(event) {
    event.preventDefault();
    if (!api.canWriteContentRights()) return;
    const button = document.getElementById("adminContentRightsSubmit");
    button.disabled = true; formState.textContent = ui.t("loading");
    try {
      const base = values();
      const config = ui.configuration(base);
      const revising = field("mode").value === "revise";
      const path = revising ? `/admin/api/v1/content-rights-contracts/${encodeURIComponent(field("contractId").value)}/revisions` : "/admin/api/v1/content-rights-contracts";
      const body = revising ? { sourceVersionId: field("sourceVersionId").value, ...config } : { workType: field("workType").value, workId: base.workId, ...config };
      await api.fetch(path, { method: "POST", auth: true, body });
      reset(); formState.textContent = ui.t("saved"); formState.className = "form-status is-success";
      await load();
    } catch (error) {
      formState.textContent = error?.message === "invalid" ? ui.t("invalid") : (error?.message || ui.t("error"));
      formState.className = "form-status is-error";
    } finally { button.disabled = false; }
  }

  async function load() {
    if (!api || !state || !list) return;
    state.textContent = ui.t("loading");
    try {
      const data = await api.fetch("/admin/api/v1/content-rights-contracts", { auth: true });
      contracts = Array.isArray(data?.items) ? data.items : [];
      state.textContent = contracts.length ? "" : ui.t("empty"); render();
    } catch (error) {
      contracts = []; state.textContent = error?.status === 403 ? ui.t("forbidden") : ui.t("error"); render();
    }
  }

  form?.addEventListener("submit", submit);
  document.getElementById("adminContentRightsReset")?.addEventListener("click", reset);
  document.getElementById("adminContentRightsRefresh")?.addEventListener("click", load);
  list?.addEventListener("click", (event) => { const button = event.target.closest(".rights-revise"); if (button) prepare(button.dataset.contractId, button.dataset.versionId); });
  window.addEventListener("lumina:localechange", localize);
  window.LuminaBackstageContentRights = { load };
  localize();
})();
