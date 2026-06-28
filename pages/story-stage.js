(function initStoryStagePage() {
/* ════════════════════════════════════════════════════════════
   #1090/#1119/#1128/#1154/#1160/#1173 — 스토리 스테이지 read-only surface
   - 무료 프롤로그(계정당 1회, 본인+동반 1) / 유료 챕터 / 시즌 / 동반 캐릭터 / 영상 추가 비용을
     한 화면에서 UX 계약상 자연스럽게 보여주는 미리보기 화면.
   - 보안/정책: 실제 결제·entitlement·wallet·story progress·provider 호출 mutation 절대 없음.
     모든 액션 버튼은 aria-disabled 미리보기 상태이며, 상단 배너로 미리보기임을 명시.
   - 이중결제 오해 방지: 무료(1회)·유료 챕터·시즌·영상 추가비용을 시각적으로 분리하고,
     영상 비용은 "만들 때만" 드는 선택 비용임을 명시.
   ════════════════════════════════════════════════════════════ */

const STORY_FIXTURE = Object.freeze({
  prologue: {
    title: "무료 프롤로그",
    summary: "계정당 1회, 본인 또는 동반 캐릭터 한 명과 함께 첫 이야기를 무료로 즐겨보세요.",
    runtime: "약 10분 분량",
    freePerAccount: 1,
    companionMax: 1,
  },
  chapters: [
    { no: 1, title: "첫 무대의 떨림", priceLumina: 120, summary: "데뷔 직전, 무대 뒤에서의 하룻밤." },
    { no: 2, title: "흔들리는 스포트라이트", priceLumina: 150, summary: "예상치 못한 사고로 흔들리는 팀." },
    { no: 3, title: "다시, 처음처럼", priceLumina: 150, summary: "무너진 자리에서 다시 손을 맞잡다." },
  ],
  season: {
    title: "시즌 1 · 데뷔의 계절",
    chapterCount: 8,
    bundlePriceLumina: 880,
    singleSumLumina: 1120,
  },
  video: {
    perClipLumina: 60,
    note: "장면을 영상으로 만들 때만 드는 선택 비용이에요. 챕터 구매와 별개이고, 만들지 않으면 청구되지 않아요.",
  },
  // #1250 — 댓글/평점/완독자 read-only fixture. 댓글은 결제자 기준, 완독은 완독자 표기.
  reactions: {
    chapters: [
      { no: 1, rating: 4.7, readers: 312, comments: 48 },
      { no: 2, rating: 4.5, readers: 268, comments: 33 },
      { no: 3, rating: 4.8, readers: 241, comments: 51 },
    ],
    storyComments: [
      { author: "별빛_수아", paid: true, completed: true, text: "프롤로그만 보려다 시즌까지 갔어요. 무대 뒤 이야기가 이렇게 따뜻할 줄은 몰랐네요." },
      { author: "조용한_관객", paid: true, completed: false, text: "챕터마다 톤이 달라서 좋아요. 아직 다 못 봤지만 다음 시즌도 기다릴게요." },
      { author: "오늘의_픽러", paid: true, completed: true, text: "완독하고 나니 캐릭터가 더 좋아졌어요. 마지막 장면은 영상으로도 남겨두고 싶다." },
    ],
  },
});

function lumina(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("ko-KR") + " L";
}

/* 동반 캐릭터 후보 — characters.js의 공개 아티스트에서 최대 6명 (read-only 선택지). */
function companionOptions() {
  const data = (typeof window !== "undefined" && window.LuminaStaticData) ? window.LuminaStaticData : null;
  const all = data && Array.isArray(data.characters) ? data.characters : [];
  return all
    .filter(a => a && (a.status === "public" || a.status === "debut"))
    .slice(0, 6)
    .map(a => ({ slug: a.slug, name: a.publicName || a.name || a.slug }));
}

function renderStoryStage() {
  const root = document.getElementById("storyStageRoot");
  if (!root) return;

  const f = STORY_FIXTURE;
  const companions = companionOptions();
  const seasonSaving = Math.max(0, f.season.singleSumLumina - f.season.bundlePriceLumina);

  const companionChips = companions.length
    ? companions.map((c, i) => `
        <button class="story-companion-chip${i === 0 ? " is-selected" : ""}" type="button"
                aria-pressed="${i === 0 ? "true" : "false"}" data-story-companion="${c.slug}">
          ${c.name}
        </button>`).join("")
    : `<p class="story-muted">공개 아티스트가 준비되면 동반 캐릭터로 선택할 수 있어요.</p>`;

  root.innerHTML = `
    <div class="story-preview-banner" role="note">
      <strong>미리보기 화면</strong>
      <span>구성을 미리 보는 read-only 화면이에요. 실제 해금·결제는 정식 오픈 시 진행돼요.</span>
    </div>

    <!-- 1) 무료 프롤로그 — 계정당 1회, 본인+동반 1 -->
    <section class="story-section" aria-labelledby="storyPrologueTitle">
      <div class="story-section-head">
        <span class="story-eyebrow story-eyebrow-free">무료 · 계정당 1회</span>
        <h2 id="storyPrologueTitle">${f.prologue.title}</h2>
      </div>
      <div class="story-card story-card-prologue">
        <p class="story-card-summary">${f.prologue.summary}</p>
        <ul class="story-meta-list">
          <li><strong>비용</strong><span class="story-free-pill">무료</span></li>
          <li><strong>제공</strong><span>계정당 ${f.prologue.freePerAccount}회</span></li>
          <li><strong>분량</strong><span>${f.prologue.runtime}</span></li>
        </ul>
        <div class="story-companion">
          <p class="story-companion-label">함께할 캐릭터 — 본인 또는 동반 1명</p>
          <div class="story-companion-chips" role="group" aria-label="동반 캐릭터 선택 (최대 ${f.prologue.companionMax}명)">
            <button class="story-companion-chip is-self is-selected" type="button" aria-pressed="true" data-story-companion="self">나 혼자</button>
            ${companionChips}
          </div>
          <p class="story-muted story-companion-hint">동반은 최대 ${f.prologue.companionMax}명까지 선택할 수 있어요.</p>
        </div>
        <button class="story-cta story-cta-free" type="button" aria-disabled="true" data-story-preview="prologue">무료로 시작 (미리보기)</button>
      </div>
    </section>

    <!-- 2) 유료 챕터 구매 -->
    <section class="story-section" aria-labelledby="storyChaptersTitle">
      <div class="story-section-head">
        <span class="story-eyebrow story-eyebrow-paid">유료 · 챕터별 구매</span>
        <h2 id="storyChaptersTitle">이어지는 챕터</h2>
      </div>
      <ul class="story-chapter-list">
        ${f.chapters.map(c => `
          <li class="story-chapter-item">
            <span class="story-chapter-no">CH.${c.no}</span>
            <div class="story-chapter-body">
              <strong class="story-chapter-title">${c.title}</strong>
              <p class="story-chapter-summary">${c.summary}</p>
            </div>
            <div class="story-chapter-buy">
              <span class="story-price">${lumina(c.priceLumina)}</span>
              <button class="story-cta story-cta-paid" type="button" aria-disabled="true" data-story-preview="chapter-${c.no}">구매 (미리보기)</button>
            </div>
          </li>`).join("")}
      </ul>
    </section>

    <!-- 3) 시즌 묶음 구매 — 챕터 합산보다 저렴 (이중결제 아님을 명시) -->
    <section class="story-section" aria-labelledby="storySeasonTitle">
      <div class="story-section-head">
        <span class="story-eyebrow story-eyebrow-paid">유료 · 시즌 묶음</span>
        <h2 id="storySeasonTitle">${f.season.title}</h2>
      </div>
      <div class="story-card story-card-season">
        <p class="story-card-summary">챕터 ${f.season.chapterCount}편을 한 번에. 챕터별로 따로 사지 않아도 돼요.</p>
        <div class="story-season-price">
          <span class="story-price story-price-lg">${lumina(f.season.bundlePriceLumina)}</span>
          <span class="story-price-strike">${lumina(f.season.singleSumLumina)}</span>
          ${seasonSaving > 0 ? `<span class="story-save-pill">${lumina(seasonSaving)} 절약</span>` : ""}
        </div>
        <p class="story-muted">이미 구매한 챕터가 있으면 그만큼 빼고 결제돼요. 같은 챕터를 두 번 사지 않아요.</p>
        <button class="story-cta story-cta-paid" type="button" aria-disabled="true" data-story-preview="season">시즌 구매 (미리보기)</button>
      </div>
    </section>

    <!-- 4) 영상 생성 추가 비용 — 챕터/시즌과 별개임을 분리 강조 -->
    <section class="story-section" aria-labelledby="storyVideoTitle">
      <div class="story-section-head">
        <span class="story-eyebrow story-eyebrow-extra">선택 · 추가 비용</span>
        <h2 id="storyVideoTitle">장면을 영상으로</h2>
      </div>
      <div class="story-card story-card-video">
        <div class="story-video-row">
          <span class="story-price">${lumina(f.video.perClipLumina)} <small>/ 1편</small></span>
          <button class="story-cta story-cta-extra" type="button" aria-disabled="true" data-story-preview="video">영상 만들기 (미리보기)</button>
        </div>
        <p class="story-note-extra">${f.video.note}</p>
      </div>
    </section>

    <!-- 5) #1250 — 댓글/평점/완독자 read-only surface. 챕터 평점·완독자와 스토리 전체 댓글(결제자)을 구분. -->
    <section class="story-section" aria-labelledby="storyReactTitle">
      <div class="story-section-head">
        <span class="story-eyebrow story-eyebrow-react">반응 · 읽은 사람</span>
        <h2 id="storyReactTitle">이야기 반응</h2>
      </div>
      <ul class="story-chapter-react-list">
        ${f.reactions.chapters.map(r => `
          <li class="story-chapter-react">
            <span class="story-chapter-no">CH.${r.no}</span>
            <div class="story-react-meta">
              <span class="story-rating" aria-label="평점 ${r.rating}점">★ ${r.rating.toFixed(1)}</span>
              <span class="story-read-badge">완독 ${r.readers.toLocaleString("ko-KR")}명</span>
              <span class="story-react-count">댓글 ${r.comments}</span>
            </div>
          </li>`).join("")}
      </ul>
      <div class="story-comments">
        <p class="story-comments-head">스토리 전체 댓글 <span class="story-muted">· 구매한 분만 남길 수 있어요</span></p>
        ${f.reactions.storyComments.map(cm => `
          <div class="story-comment">
            <div class="story-comment-top">
              <strong class="story-comment-author">${cm.author}</strong>
              ${cm.paid ? `<span class="story-buyer-badge">결제자</span>` : ""}
              ${cm.completed ? `<span class="story-read-badge is-done">완독</span>` : ""}
            </div>
            <p class="story-comment-text">${cm.text}</p>
          </div>`).join("")}
        <button class="story-cta story-cta-extra" type="button" aria-disabled="true" data-story-preview="comment">댓글 남기기 (구매 후 가능 · 미리보기)</button>
      </div>
    </section>
  `;

  bindStoryPreview(root);
}

/* read-only 미리보기 — 어떤 결제/해금 mutation도 실행하지 않고 안내만 노출. */
function bindStoryPreview(root) {
  if (root._storyPreviewBound) return;
  root._storyPreviewBound = true;

  // 동반 캐릭터 선택은 시각 토글만 (최대 1명, '나 혼자'와 상호배타) — 데이터 변경 없음.
  root.addEventListener("click", (event) => {
    const chip = event.target.closest(".story-companion-chip");
    if (chip) {
      const group = chip.closest(".story-companion-chips");
      if (group) group.querySelectorAll(".story-companion-chip").forEach(c => {
        c.classList.remove("is-selected");
        c.setAttribute("aria-pressed", "false");
      });
      chip.classList.add("is-selected");
      chip.setAttribute("aria-pressed", "true");
      return;
    }
    const cta = event.target.closest("[data-story-preview]");
    if (cta) {
      event.preventDefault();
      showStoryPreviewToast();
    }
  });
}

let _storyToastTimer = null;
function showStoryPreviewToast() {
  let toast = document.getElementById("storyPreviewToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "storyPreviewToast";
    toast.className = "story-toast";
    toast.setAttribute("role", "status");
    document.body.appendChild(toast);
  }
  toast.textContent = "미리보기 화면이에요. 해금·결제는 정식 오픈 시 열려요.";
  toast.classList.add("is-visible");
  clearTimeout(_storyToastTimer);
  _storyToastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", renderStoryStage);
} else {
  renderStoryStage();
}
window.renderStoryStage = renderStoryStage;
})();
