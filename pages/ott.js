(function () {
  "use strict";

  const copy = {
    ko: { description: "공개와 감상 권한이 확인된 작품만 소개합니다.", catalog: "공개 작품", note: "현재 공개 기준을 충족한 작품을 확인할 수 있습니다.", loading: "공개 작품을 확인하고 있어요.", emptyTitle: "지금 공개된 OTT 작품이 없습니다.", emptyBody: "감상 가능한 작품이 공개되면 이곳에 표시됩니다.", errorTitle: "작품 목록을 불러오지 못했습니다.", errorBody: "잠시 후 다시 확인해 주세요.", by: "제작", details: "작품 정보", unavailable: "현재 이 작품의 감상 이용은 제공되지 않습니다." },
    en: { description: "Only titles cleared for public release and viewing are listed.", catalog: "Released titles", note: "Browse titles that currently meet the public release requirements.", loading: "Checking released titles.", emptyTitle: "No OTT titles are public right now.", emptyBody: "Titles will appear here when they are cleared for viewing.", errorTitle: "The catalog could not be loaded.", errorBody: "Please check again shortly.", by: "Created by", details: "Title details", unavailable: "Viewing is not currently available for this title." },
    ja: { description: "公開と視聴の権利が確認された作品のみ掲載します。", catalog: "公開作品", note: "現在の公開基準を満たす作品を確認できます。", loading: "公開作品を確認しています。", emptyTitle: "現在公開中のOTT作品はありません。", emptyBody: "視聴可能な作品が公開されると、ここに表示されます。", errorTitle: "作品一覧を読み込めませんでした。", errorBody: "しばらくしてからもう一度ご確認ください。", by: "制作", details: "作品情報", unavailable: "現在、この作品の視聴は提供されていません。" },
    "zh-Hans": { description: "这里只展示已确认公开和观看授权的作品。", catalog: "公开作品", note: "查看目前符合公开标准的作品。", loading: "正在确认公开作品。", emptyTitle: "目前没有公开的 OTT 作品。", emptyBody: "可观看作品公开后会显示在这里。", errorTitle: "无法加载作品列表。", errorBody: "请稍后再试。", by: "制作", details: "作品信息", unavailable: "目前暂不提供此作品的观看服务。" },
    "zh-Hant": { description: "這裡只展示已確認公開與觀看授權的作品。", catalog: "公開作品", note: "查看目前符合公開標準的作品。", loading: "正在確認公開作品。", emptyTitle: "目前沒有公開的 OTT 作品。", emptyBody: "可觀看作品公開後會顯示在這裡。", errorTitle: "無法載入作品列表。", errorBody: "請稍後再試。", by: "製作", details: "作品資訊", unavailable: "目前暫不提供此作品的觀看服務。" },
  };

  const root = document.getElementById("ottCatalogRoot");
  const locale = () => {
    const value = String(window.LuminaI18n?.getLocale?.() || localStorage.getItem("lumina_locale") || navigator.language || "ko");
    if (value.startsWith("ja")) return "ja";
    if (value.startsWith("zh-Hant") || /zh-(TW|HK|MO)/i.test(value)) return "zh-Hant";
    if (value.startsWith("zh")) return "zh-Hans";
    if (value.startsWith("en")) return "en";
    return "ko";
  };
  const tr = (key) => copy[locale()]?.[key] || copy.ko[key];
  const text = (value) => value?.[locale()] || value?.ko || value?.en || "";
  const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

  function applyCopy() {
    document.documentElement.lang = locale();
    document.getElementById("ottDescription").textContent = tr("description");
    document.getElementById("ottCatalogTitle").textContent = tr("catalog");
    document.getElementById("ottCatalogNote").textContent = tr("note");
  }

  function status(title, body = "") {
    root.innerHTML = `<div class="ott-status"><div><strong>${escapeHtml(title)}</strong>${body ? `<p>${escapeHtml(body)}</p>` : ""}</div></div>`;
  }

  function render(items) {
    if (!items.length) return status(tr("emptyTitle"), tr("emptyBody"));
    root.innerHTML = `<div class="ott-grid">${items.map((item) => `<article class="ott-card">
      <div class="ott-card-art" aria-hidden="true">LUMINA OTT</div>
      <div class="ott-card-body"><h3>${escapeHtml(text(item.title))}</h3><p>${escapeHtml(text(item.synopsis))}</p>
      <div class="ott-card-meta"><span>${escapeHtml(tr("by"))} ${escapeHtml(text(item.creatorName))}</span><span>${escapeHtml(new Date(item.publishedAt).toLocaleDateString(locale()))}</span></div>
      <button class="ott-detail-button" type="button">${escapeHtml(tr("details"))}</button>
      <p class="ott-boundary" hidden>${escapeHtml(tr("unavailable"))}</p></div></article>`).join("")}</div>`;
    root.querySelectorAll(".ott-detail-button").forEach((button) => button.addEventListener("click", () => {
      const boundary = button.nextElementSibling;
      boundary.hidden = !boundary.hidden;
    }));
  }

  async function load() {
    status(tr("loading"));
    try {
      const response = await fetch("/api/v1/ott", { headers: { Accept: "application/json" }, credentials: "omit" });
      if (!response.ok) throw new Error("catalog unavailable");
      const payload = await response.json();
      render(Array.isArray(payload?.items) ? payload.items : []);
    } catch {
      status(tr("errorTitle"), tr("errorBody"));
    }
  }

  applyCopy();
  window.addEventListener("lumina:localechange", () => { applyCopy(); load(); });
  load();
})();
