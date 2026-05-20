// #324 — 공개 사이트 문구 CMS bootstrap.
// `GET /api/v1/site-content/bootstrap`을 한 번 호출해 `[data-cms-key]` 요소에
// 발행된 CMS 값(title/body/ctaLabel/ctaHref)을 hydrate한다.
// CMS 호출 실패 / 키 누락 시 정적 fallback 유지 — DOM을 비우지 않는다.
(function () {
  "use strict";

  if (typeof window === "undefined" || window.LuminaCms) return;

  var API_BASE = (window.LUMINA_API_BASE || "https://api.lumina-stage.com").replace(/\/$/, "");
  var responseCache = Object.create(null);

  function pickField(el, entry) {
    if (!entry) return null;
    var explicit = el.getAttribute("data-cms-field");
    if (explicit) {
      // 명시된 필드만 사용.
      switch (explicit) {
        case "title": return entry.title;
        case "body": return entry.body;
        case "ctaLabel": return entry.ctaLabel;
        case "ctaHref": return entry.ctaHref;
        default: return null;
      }
    }
    var tag = (el.tagName || "").toUpperCase();
    if (/^H[1-6]$/.test(tag)) return entry.title;
    if (tag === "A" || tag === "BUTTON") return entry.ctaLabel;
    // 기본은 body. <p>, <div>, <span> 등.
    return entry.body;
  }

  function applyEntry(el, entry) {
    if (!entry) return false;
    var value = pickField(el, entry);
    if (value == null || value === "") return false;
    if (el.getAttribute("data-cms-field") === "ctaHref") {
      el.setAttribute("href", String(value));
      return true;
    }
    if (el.tagName === "A" && entry.ctaHref) {
      // CTA 텍스트 + href 동시 갱신.
      el.setAttribute("href", String(entry.ctaHref));
    }
    el.textContent = String(value);
    return true;
  }

  function applyContent(content) {
    if (!content || typeof content !== "object") return 0;
    var applied = 0;
    var nodes = document.querySelectorAll("[data-cms-key]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var key = el.getAttribute("data-cms-key");
      if (!key) continue;
      var entry = content[key];
      if (!entry) continue;
      if (applyEntry(el, entry)) applied += 1;
    }
    document.documentElement.setAttribute("data-cms-state", applied > 0 ? "applied" : "fallback");
    return applied;
  }

  function normalizeLocale(locale) {
    var raw = String(locale || "").trim();
    if (!raw || raw === "ko") return "ko-KR";
    if (raw === "en") return "en-US";
    return raw;
  }

  function buildUrl(opts) {
    var params = new URLSearchParams();
    if (opts.pageKey) params.set("pageKey", opts.pageKey);
    if (opts.characterSlug) params.set("characterSlug", opts.characterSlug);
    if (opts.modelSlug) params.set("modelSlug", opts.modelSlug);
    if (opts.scope) params.set("scope", opts.scope);
    var locale = normalizeLocale(opts.locale || document.documentElement.lang || "ko-KR");
    params.set("locale", locale);
    return API_BASE + "/api/v1/site-content/bootstrap?" + params.toString();
  }

  async function fetchBootstrap(url) {
    if (responseCache[url]) return responseCache[url];
    responseCache[url] = (async function () {
      var response;
      try {
        response = await fetch(url, {
          method: "GET",
          credentials: "omit",
          cache: "no-store",
        });
      } catch (_) {
        throw { statusText: "fetch-error" };
      }
      if (!response.ok) {
        throw { statusText: "http-" + response.status };
      }
      try {
        return await response.json();
      } catch (_) {
        throw { statusText: "parse-error" };
      }
    })().catch(function (error) {
      delete responseCache[url];
      throw error;
    });
    return responseCache[url];
  }

  async function hydrate(options) {
    var opts = options || {};
    var body = document.body || {};
    var pageKey = opts.pageKey || (body.dataset && body.dataset.cmsPageKey) || null;
    if (!pageKey) {
      document.documentElement.setAttribute("data-cms-state", "skipped");
      return { applied: 0, status: "skipped" };
    }
    var characterSlug = opts.characterSlug;
    if (characterSlug === undefined) {
      var autoSlug = body.dataset && body.dataset.cmsAutoCharacterSlug;
      if (autoSlug === "1" || autoSlug === "true") {
        try {
          characterSlug = new URLSearchParams(window.location.search).get("slug") || undefined;
        } catch (_) {
          characterSlug = undefined;
        }
      }
    }
    var modelSlug = opts.modelSlug;
    if (modelSlug === undefined && body.dataset && body.dataset.cmsModelSlug) {
      modelSlug = body.dataset.cmsModelSlug;
    }

    var url = buildUrl({
      pageKey: pageKey,
      characterSlug: characterSlug || undefined,
      modelSlug: modelSlug || undefined,
      locale: opts.locale,
    });

    var data;
    try {
      data = await fetchBootstrap(url);
    } catch (error) {
      document.documentElement.setAttribute("data-cms-state", "fallback");
      return { applied: 0, status: error && error.statusText ? error.statusText : "fetch-error" };
    }
    var applied = applyContent(data && data.content);
    return { applied: applied, status: applied > 0 ? "applied" : "fallback" };
  }

  function autoHydrate() {
    var body = document.body;
    if (!body || !body.dataset || !body.dataset.cmsPageKey) return;
    hydrate().catch(function () {
      document.documentElement.setAttribute("data-cms-state", "fallback");
    });
  }

  window.LuminaCms = { hydrate: hydrate, applyContent: applyContent };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoHydrate);
  } else {
    autoHydrate();
  }
})();
