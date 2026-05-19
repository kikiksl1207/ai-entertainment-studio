(function initShortformPageLayer() {
function renderShortforms() {
  const root = document.getElementById("shortformGrid");
  if (!root) return;
  root.innerHTML = _shortforms.map(item => {
    const a = getCharacterByName(item.artist);
    const img = item.image || a?.images.thumb || a?.images.cover || "";
    return `
      <article class="short-card clickable-card" data-href="/character-detail?slug=${a?.slug || ""}">
        <div class="short-card-head">
          <span class="eyebrow">${item.artist}</span>
          <strong>${item.title}</strong>
        </div>
        <div class="short-media"${mediaStyle(img)}>
          <span class="short-media-metric">${item.metric}</span>
        </div>
        <div class="short-body">
          <p>${item.mainTone || item.tone}</p>
          <a class="text-link" href="/character-detail?slug=${a?.slug || ""}">캐릭터 보기</a>
        </div>
      </article>`;
  }).join("");
}

function renderShortformHub() {
  const root = document.getElementById("shortformHub");
  if (!root) return;
  root.innerHTML = _shortforms.map(item => {
    const a = getCharacterByName(item.artist);
    const img = item.image || a?.images.thumb || a?.images.cover || "";
    return `
      <article class="feed-card clickable-card" data-href="/character-detail?slug=${a?.slug || ""}">
        <div class="feed-card-head">
          <span class="eyebrow">${item.artist}</span>
          <strong>${item.title}</strong>
        </div>
        <div class="feed-card-media"${mediaStyle(img)}>
          <span class="feed-card-chip">${a?.type || ""}</span>
          <span class="feed-card-metric">${item.metric}</span>
        </div>
        <div class="feed-card-body">
          <p>${item.hubTone || item.tone}</p>
          <a class="text-link" href="/character-detail?slug=${a?.slug || ""}">캐릭터 보기</a>
        </div>
      </article>`;
  }).join("");
}

window.renderShortforms = renderShortforms;
window.renderShortformHub = renderShortformHub;
})();
