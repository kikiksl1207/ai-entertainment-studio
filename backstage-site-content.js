// #323 — Backstage 사이트 문구 관리 화면 (CMS 어드민)
// API 계약은 #322 site-content controller. read/write 모두 super_admin 권한 필요.
// backstage.js의 backstageFetch / adminApiPath / getBackstageAuth를 재사용한다.
(function () {
  "use strict";

  if (typeof window === "undefined" || window.LuminaSiteContent) return;

  var ADMIN_PATH = "/backstage/site-content";
  var MAX = {
    contentKey: 160,
    title: 180,
    body: 5000,
    ctaLabel: 80,
    ctaHref: 500,
    contentJson: 20000,
  };
  var ALLOWED_HOSTS = ["lumina-stage.com", "www.lumina-stage.com"];
  var SAFE_KEY = /^[a-z0-9][a-z0-9._:\-]{1,158}[a-z0-9]$/;
  var SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/;
  var SAFE_LOCALE = /^[a-z]{2}(?:-[A-Z]{2})?$/;
  var HTML_LIKE = /<\s*\/?\s*[a-zA-Z][^>]*>/;
  var SCRIPT_LIKE = /(?:<\s*script\b|javascript:|data:text\/html)/i;

  var state = {
    filters: { status: "", pageKey: "", scope: "", characterSlug: "", modelSlug: "", locale: "ko-KR", search: "" },
    items: [],
    total: 0,
    selectedId: null,
    loading: false,
  };

  function dom(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    if (value == null) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function setStatus(text, tone) {
    var el = dom("siteContentFormStatus");
    if (!el) return;
    el.textContent = text || "";
    el.dataset.tone = tone || "neutral";
  }

  function setTotalNote(count) {
    var note = dom("siteContentTotalNote");
    if (note) note.textContent = "총 " + count + "건";
    var badge = dom("siteContentCountBadge");
    if (badge) badge.textContent = String(count);
  }

  function formatDate(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "—";
      return d.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
    } catch (_) {
      return "—";
    }
  }

  function statusBadgeHtml(status) {
    var label = status === "published" ? "발행됨" : status === "archived" ? "보관" : "초안";
    var cls = status === "published" ? "is-approved" : status === "archived" ? "is-review" : "is-pending";
    return '<span class="status-badge ' + cls + '">' + escapeHtml(label) + "</span>";
  }

  function buildQuery(filters) {
    var qs = [];
    Object.keys(filters).forEach(function (key) {
      var value = filters[key];
      if (value === undefined || value === null) return;
      var trimmed = typeof value === "string" ? value.trim() : value;
      if (trimmed === "" || trimmed === undefined) return;
      qs.push(encodeURIComponent(key) + "=" + encodeURIComponent(trimmed));
    });
    qs.push("take=100");
    return qs.length ? "?" + qs.join("&") : "";
  }

  function rowHtml(item) {
    var pageLabel = item.pageKey || (item.scope === "global" ? "전체" : "—");
    var slugLabel = item.characterSlug || item.modelSlug || "—";
    if (item.characterSlug && item.modelSlug) slugLabel = item.characterSlug + " · " + item.modelSlug;
    var titleLabel = item.title || (item.body ? item.body.slice(0, 40) : "(제목 없음)");
    return (
      '<tr data-site-content-id="' +
      escapeHtml(item.id) +
      '">' +
      "<td><code>" + escapeHtml(item.contentKey) + "</code><br/><small>" + escapeHtml(item.locale || "") + "</small></td>" +
      "<td>" + escapeHtml(pageLabel) + "</td>" +
      "<td>" + escapeHtml(item.scope || "—") + "</td>" +
      "<td>" + escapeHtml(slugLabel) + "</td>" +
      "<td>" + escapeHtml(titleLabel) + "</td>" +
      "<td>" + statusBadgeHtml(item.status) + "</td>" +
      "<td>" + escapeHtml(formatDate(item.updatedAt)) + "</td>" +
      '<td><button class="text-action" type="button" data-site-content-action="edit">상세</button></td>' +
      "</tr>"
    );
  }

  function renderList() {
    var tbody = dom("siteContentRows");
    if (!tbody) return;
    if (state.loading) {
      tbody.innerHTML = '<tr><td colspan="8" class="row-loading">불러오는 중…</td></tr>';
      return;
    }
    if (!state.items.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="row-empty">표시할 사이트 문구가 없습니다.</td></tr>';
      setTotalNote(0);
      return;
    }
    tbody.innerHTML = state.items.map(rowHtml).join("");
    setTotalNote(state.total || state.items.length);
  }

  function readFilters() {
    var form = dom("siteContentFilterForm");
    if (!form) return state.filters;
    var data = new FormData(form);
    var next = {
      status: state.filters.status || "",
      pageKey: (data.get("pageKey") || "").toString().trim(),
      scope: (data.get("scope") || "").toString().trim(),
      characterSlug: (data.get("characterSlug") || "").toString().trim(),
      modelSlug: (data.get("modelSlug") || "").toString().trim(),
      locale: (data.get("locale") || "ko-KR").toString().trim(),
      search: (data.get("search") || "").toString().trim(),
    };
    state.filters = next;
    return next;
  }

  function adminFetch(path, options) {
    if (typeof window.backstageFetch !== "function" || typeof window.adminApiPath !== "function") {
      throw new Error("Backstage 인증 헬퍼가 아직 준비되지 않았습니다.");
    }
    var opts = Object.assign({ auth: true }, options || {});
    return window.backstageFetch(window.adminApiPath(ADMIN_PATH + (path || "")), opts);
  }

  async function loadList() {
    if (state.loading) return;
    state.loading = true;
    renderList();
    try {
      var filters = readFilters();
      var res = await adminFetch(buildQuery(filters));
      state.items = Array.isArray(res?.items) ? res.items : [];
      state.total = res?.pagination?.total ?? state.items.length;
    } catch (error) {
      state.items = [];
      state.total = 0;
      setStatus("목록을 불러오지 못했습니다: " + (error?.message || ""), "error");
    } finally {
      state.loading = false;
      renderList();
    }
  }

  function openEditor(item) {
    var card = dom("siteContentEditorCard");
    var form = dom("siteContentForm");
    var titleEl = dom("siteContentEditorTitle");
    var metaEl = dom("siteContentEditorMeta");
    var audit = dom("siteContentAuditSection");
    if (!card || !form || !titleEl) return;
    card.classList.remove("is-hidden");
    setStatus("", "neutral");

    if (item) {
      state.selectedId = item.id;
      titleEl.textContent = "문구 수정 — " + item.contentKey;
      if (metaEl) {
        metaEl.textContent =
          "버전 " + (item.version ?? 0) +
          " · 상태 " + (item.status || "draft") +
          " · 수정자 " + (item.updatedByUserId || "—") +
          " · 수정일 " + formatDate(item.updatedAt);
      }
      form.elements.contentKey.value = item.contentKey || "";
      form.elements.contentKey.readOnly = true;
      form.elements.scope.value = item.scope || "global";
      form.elements.locale.value = item.locale || "ko-KR";
      form.elements.pageKey.value = item.pageKey || "";
      form.elements.characterSlug.value = item.characterSlug || "";
      form.elements.modelSlug.value = item.modelSlug || "";
      form.elements.title.value = item.title || "";
      form.elements.body.value = item.body || "";
      form.elements.ctaLabel.value = item.ctaLabel || "";
      form.elements.ctaHref.value = item.ctaHref || "";
      try {
        form.elements.content.value =
          item.content && typeof item.content === "object" && Object.keys(item.content).length
            ? JSON.stringify(item.content, null, 2)
            : "";
      } catch (_) {
        form.elements.content.value = "";
      }
      dom("siteContentPublishButton").disabled = item.status === "archived";
      dom("siteContentArchiveButton").disabled = item.status === "archived";
      loadAudit(item.id);
      if (audit) audit.hidden = false;
    } else {
      state.selectedId = null;
      titleEl.textContent = "새 문구 만들기";
      if (metaEl) metaEl.textContent = "발행 전 draft 상태로 저장되며, 발행 버튼으로만 published 상태가 됩니다.";
      form.reset();
      form.elements.contentKey.readOnly = false;
      form.elements.locale.value = state.filters.locale || "ko-KR";
      form.elements.scope.value = "global";
      dom("siteContentPublishButton").disabled = true;
      dom("siteContentArchiveButton").disabled = true;
      if (audit) {
        audit.hidden = true;
        var list = dom("siteContentAuditList");
        if (list) list.innerHTML = "";
      }
    }
    refreshCounters();
    refreshPreview();
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeEditor() {
    var card = dom("siteContentEditorCard");
    if (card) card.classList.add("is-hidden");
    state.selectedId = null;
  }

  async function loadAudit(id) {
    var list = dom("siteContentAuditList");
    if (!list) return;
    list.innerHTML = "<li>감사 로그 불러오는 중…</li>";
    try {
      var res = await adminFetch("/" + encodeURIComponent(id));
      var logs = Array.isArray(res?.auditLogs) ? res.auditLogs : [];
      if (!logs.length) {
        list.innerHTML = "<li>아직 기록된 감사 로그가 없습니다.</li>";
        return;
      }
      list.innerHTML = logs
        .map(function (log) {
          var fields =
            log.metadata && log.metadata.changedFields && Array.isArray(log.metadata.changedFields)
              ? log.metadata.changedFields.join(", ")
              : "—";
          return (
            "<li><strong>" + escapeHtml(log.action) + "</strong> · " +
            escapeHtml(formatDate(log.createdAt)) + " · 변경 필드: " + escapeHtml(fields) + "</li>"
          );
        })
        .join("");
    } catch (error) {
      list.innerHTML = "<li>감사 로그를 불러오지 못했습니다: " + escapeHtml(error?.message || "") + "</li>";
    }
  }

  function refreshCounters() {
    var form = dom("siteContentForm");
    if (!form) return;
    ["title", "body"].forEach(function (name) {
      var field = form.elements[name];
      var counter = form.querySelector('[data-counter="' + name + '"]');
      if (counter && field) counter.textContent = String((field.value || "").length);
    });
  }

  function refreshPreview() {
    var form = dom("siteContentForm");
    var preview = dom("siteContentPreview");
    if (!form || !preview) return;
    var title = form.elements.title.value.trim();
    var body = form.elements.body.value.trim();
    var ctaLabel = form.elements.ctaLabel.value.trim();
    var ctaHref = form.elements.ctaHref.value.trim();
    var parts = [];
    if (title) parts.push('<h5 class="site-content-preview-title">' + escapeHtml(title) + "</h5>");
    if (body) {
      var paragraphs = body.split(/\n{2,}/).map(function (chunk) {
        return "<p>" + escapeHtml(chunk).replace(/\n/g, "<br/>") + "</p>";
      });
      parts.push(paragraphs.join(""));
    }
    if (ctaLabel) {
      var hrefAttr = ctaHref ? ' href="' + escapeHtml(ctaHref) + '"' : "";
      parts.push('<a class="site-content-preview-cta"' + hrefAttr + ' target="_blank" rel="noopener">' + escapeHtml(ctaLabel) + "</a>");
    }
    preview.innerHTML = parts.length
      ? parts.join("")
      : '<p class="site-content-preview-empty">제목/본문/CTA를 입력하면 사용자 화면에 보일 모양을 미리 확인할 수 있어요.</p>';
  }

  function readForm() {
    var form = dom("siteContentForm");
    if (!form) return null;
    var fd = new FormData(form);
    var rawContent = (fd.get("content") || "").toString().trim();
    var content = {};
    if (rawContent) {
      try {
        content = JSON.parse(rawContent);
        if (!content || typeof content !== "object" || Array.isArray(content)) {
          throw new Error("content는 JSON 객체여야 합니다.");
        }
      } catch (error) {
        throw new Error("content JSON 파싱 실패: " + (error?.message || ""));
      }
    }
    return {
      contentKey: (fd.get("contentKey") || "").toString().trim(),
      scope: (fd.get("scope") || "global").toString(),
      pageKey: (fd.get("pageKey") || "").toString().trim() || null,
      characterSlug: (fd.get("characterSlug") || "").toString().trim() || null,
      modelSlug: (fd.get("modelSlug") || "").toString().trim() || null,
      locale: (fd.get("locale") || "ko-KR").toString().trim(),
      title: (fd.get("title") || "").toString(),
      body: (fd.get("body") || "").toString(),
      ctaLabel: (fd.get("ctaLabel") || "").toString().trim() || null,
      ctaHref: (fd.get("ctaHref") || "").toString().trim() || null,
      content: content,
    };
  }

  function validate(payload, options) {
    if (options && options.requireKey) {
      if (!payload.contentKey || !SAFE_KEY.test(payload.contentKey) || payload.contentKey.length > MAX.contentKey) {
        throw new Error("contentKey 형식이 올바르지 않습니다.");
      }
    }
    if (payload.pageKey && !SAFE_SLUG.test(payload.pageKey)) throw new Error("pageKey 형식이 올바르지 않습니다.");
    if (payload.characterSlug && !SAFE_SLUG.test(payload.characterSlug)) throw new Error("characterSlug 형식이 올바르지 않습니다.");
    if (payload.modelSlug && !SAFE_SLUG.test(payload.modelSlug)) throw new Error("modelSlug 형식이 올바르지 않습니다.");
    if (!SAFE_LOCALE.test(payload.locale)) throw new Error("locale은 ko 또는 ko-KR 형식이어야 합니다.");
    if (payload.title && payload.title.length > MAX.title) throw new Error("제목이 너무 깁니다.");
    if (payload.body && payload.body.length > MAX.body) throw new Error("본문이 너무 깁니다.");
    if (payload.ctaLabel && payload.ctaLabel.length > MAX.ctaLabel) throw new Error("CTA 라벨이 너무 깁니다.");
    if (payload.ctaHref && payload.ctaHref.length > MAX.ctaHref) throw new Error("CTA URL이 너무 깁니다.");
    ["title", "body", "ctaLabel"].forEach(function (key) {
      var value = payload[key];
      if (value && (HTML_LIKE.test(value) || SCRIPT_LIKE.test(value))) {
        throw new Error(key + " 필드에 HTML/script 패턴이 포함되어 있습니다.");
      }
    });
    if (payload.ctaHref) {
      try {
        if (payload.ctaHref.startsWith("/") && !payload.ctaHref.startsWith("//")) {
          return;
        }
        var u = new URL(payload.ctaHref);
        if (u.protocol !== "https:" || !ALLOWED_HOSTS.includes(u.hostname)) {
          throw new Error("CTA URL은 내부 경로 또는 lumina-stage.com HTTPS URL만 허용됩니다.");
        }
      } catch (error) {
        throw new Error("CTA URL 형식이 올바르지 않습니다.");
      }
    }
  }

  async function saveDraft(event) {
    if (event) event.preventDefault();
    setStatus("저장 중…", "neutral");
    try {
      var payload = readForm();
      validate(payload, { requireKey: !state.selectedId });
      if (state.selectedId) {
        var patchPayload = Object.assign({}, payload);
        delete patchPayload.contentKey;
        await adminFetch("/" + encodeURIComponent(state.selectedId), {
          method: "PATCH",
          body: patchPayload,
        });
        setStatus("수정 사항이 저장되었습니다 (draft 유지). 발행 버튼으로 published 처리하세요.", "success");
      } else {
        var created = await adminFetch("", { method: "POST", body: payload });
        if (created?.item?.id) {
          state.selectedId = created.item.id;
          openEditor(created.item);
        }
        setStatus("새 문구를 draft로 저장했습니다. 발행 전 미리보기를 확인하세요.", "success");
      }
      await loadList();
    } catch (error) {
      setStatus(error?.message || "저장에 실패했습니다.", "error");
    }
  }

  function confirmAction(message, onConfirm) {
    if (typeof window.openBackstageConfirm === "function") {
      window.openBackstageConfirm({
        title: "사이트 문구 운영 확인",
        message: message,
        onConfirm: onConfirm,
      });
      return;
    }
    if (window.confirm(message)) onConfirm();
  }

  async function publishCurrent() {
    if (!state.selectedId) {
      setStatus("발행할 문구를 먼저 선택하거나 draft 저장하세요.", "error");
      return;
    }
    var item = state.items.find(function (i) { return i.id === state.selectedId; });
    var scopeLabel = item ? (item.pageKey || item.scope || "global") : state.selectedId;
    confirmAction(
      "이 문구가 사용자 화면에 즉시 노출됩니다. (" + scopeLabel + ")\n발행하시겠어요?",
      async function () {
        setStatus("발행 처리 중…", "neutral");
        try {
          await adminFetch("/" + encodeURIComponent(state.selectedId) + "/publish", { method: "POST" });
          setStatus("발행되었습니다.", "success");
          await loadList();
          var refreshed = state.items.find(function (i) { return i.id === state.selectedId; });
          if (refreshed) openEditor(refreshed);
        } catch (error) {
          setStatus(error?.message || "발행에 실패했습니다.", "error");
        }
      }
    );
  }

  async function archiveCurrent() {
    if (!state.selectedId) {
      setStatus("보관할 문구를 먼저 선택하세요.", "error");
      return;
    }
    confirmAction(
      "이 문구는 보관 처리되고 사용자 화면에서 사라집니다. 진행하시겠어요?",
      async function () {
        setStatus("보관 처리 중…", "neutral");
        try {
          await adminFetch("/" + encodeURIComponent(state.selectedId) + "/archive", { method: "POST" });
          setStatus("보관되었습니다.", "success");
          await loadList();
          closeEditor();
        } catch (error) {
          setStatus(error?.message || "보관에 실패했습니다.", "error");
        }
      }
    );
  }

  function attachEvents() {
    var filterForm = dom("siteContentFilterForm");
    if (filterForm && !filterForm.dataset.bound) {
      filterForm.dataset.bound = "1";
      filterForm.addEventListener("submit", function (event) {
        event.preventDefault();
        loadList();
      });
      filterForm.addEventListener("reset", function () {
        setTimeout(function () { loadList(); }, 0);
      });
    }
    document.querySelectorAll("#site-content .filter-chip[data-site-content-status]").forEach(function (chip) {
      if (chip.dataset.bound) return;
      chip.dataset.bound = "1";
      chip.addEventListener("click", function () {
        document.querySelectorAll("#site-content .filter-chip[data-site-content-status]").forEach(function (other) {
          other.classList.toggle("is-active", other === chip);
        });
        state.filters.status = chip.getAttribute("data-site-content-status") || "";
        loadList();
      });
    });
    var createBtn = dom("siteContentCreateButton");
    if (createBtn && !createBtn.dataset.bound) {
      createBtn.dataset.bound = "1";
      createBtn.addEventListener("click", function () { openEditor(null); });
    }
    var closeBtn = dom("siteContentEditorClose");
    if (closeBtn && !closeBtn.dataset.bound) {
      closeBtn.dataset.bound = "1";
      closeBtn.addEventListener("click", closeEditor);
    }
    var rows = dom("siteContentRows");
    if (rows && !rows.dataset.bound) {
      rows.dataset.bound = "1";
      rows.addEventListener("click", function (event) {
        var btn = event.target.closest("[data-site-content-action]");
        if (!btn) return;
        var row = btn.closest("[data-site-content-id]");
        var id = row && row.getAttribute("data-site-content-id");
        if (!id) return;
        var item = state.items.find(function (i) { return i.id === id; });
        if (item) openEditor(item);
      });
    }
    var form = dom("siteContentForm");
    if (form && !form.dataset.bound) {
      form.dataset.bound = "1";
      form.addEventListener("submit", saveDraft);
      form.addEventListener("input", function () {
        refreshCounters();
        refreshPreview();
      });
    }
    var publishBtn = dom("siteContentPublishButton");
    if (publishBtn && !publishBtn.dataset.bound) {
      publishBtn.dataset.bound = "1";
      publishBtn.addEventListener("click", publishCurrent);
    }
    var archiveBtn = dom("siteContentArchiveButton");
    if (archiveBtn && !archiveBtn.dataset.bound) {
      archiveBtn.dataset.bound = "1";
      archiveBtn.addEventListener("click", archiveCurrent);
    }
  }

  function load() {
    attachEvents();
    loadList();
  }

  window.LuminaSiteContent = { load: load };

  if (document.readyState !== "loading") {
    attachEvents();
  } else {
    document.addEventListener("DOMContentLoaded", attachEvents);
  }
})();
