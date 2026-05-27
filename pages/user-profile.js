(function () {
  "use strict";

/* #152 — 일반 유저 공개 프로필 페이지 (차모 spec `3fa2600 Add public user profile viewer APIs`)
   - URL: ./user-profile.html?handle={publicHandle} 또는 ?id={userId}
   - GET /api/v1/users/handle/:publicHandle/profile  (Authorization 선택)
   - GET /api/v1/users/handle/:publicHandle/lumina-feed?take=20&cursor=<postId>
   - 본인이면 viewer.isSelf === true → "프로필 편집" 버튼 → 마이페이지로 이동
   - 팔로우는 #148 endpoint 사용 (POST/DELETE /api/v1/users/:userId/follow), #153 응답으로 stats/viewer 갱신 */
let _userProfileData = null;
let _userProfilePostsCursor = null;
async function initUserProfilePage() {
  // 진입 시 모든 빈 상태/에러 카드 강제 hidden — HTML hidden 속성이 CSS·i18n에 덮이지 않도록 명시 처리
  ["userProfileEmpty", "userProfileBlocked", "userProfilePostsEmpty", "userProfilePostsSection", "userProfileLoadMore"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.hidden = true;
      el.style.display = "none";
    }
  });

  const params = new URLSearchParams(window.location.search);
  const handle = params.get("handle");
  const userId = params.get("id");
  if (!handle && !userId) {
    showUserProfileNotFound();
    return;
  }

  const isAuth = typeof isLoggedIn === "function" && isLoggedIn();
  const profileEndpoint = handle
    ? `/api/v1/users/handle/${encodeURIComponent(handle)}/profile`
    : `/api/v1/users/${encodeURIComponent(userId)}/profile`;
  const feedEndpoint = handle
    ? `/api/v1/users/handle/${encodeURIComponent(handle)}/lumina-feed?take=20`
    : `/api/v1/users/${encodeURIComponent(userId)}/lumina-feed?take=20`;

  // 1. 프로필 조회
  try {
    const res = await apiFetch(profileEndpoint, { auth: isAuth });
    if (!res?.user) {
      showUserProfileNotFound();
      return;
    }
    _userProfileData = res;
    renderUserProfileCard(res);
    bindUserProfileFollow();
  } catch (err) {
    if (err?.status === 403) {
      // 차단된 계정
      showUserProfileBlocked();
    } else {
      console.warn("[#152 user-profile] 프로필 조회 실패:", err?.status, err?.message);
      showUserProfileNotFound();
    }
    return;
  }

  // 2. 글 목록 조회 (별도 try — 프로필은 보였는데 글 조회만 실패해도 프로필은 유지)
  await loadUserProfilePosts(feedEndpoint, isAuth, /*append*/ false);

  // 3. "이전 글 더 보기" 바인딩
  const loadMoreBtn = document.getElementById("userProfileLoadMore");
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", async () => {
      if (!_userProfilePostsCursor) return;
      loadMoreBtn.disabled = true;
      const sep = feedEndpoint.includes("?") ? "&" : "?";
      const nextUrl = `${feedEndpoint}${sep}cursor=${encodeURIComponent(_userProfilePostsCursor)}`;
      await loadUserProfilePosts(nextUrl, isAuth, /*append*/ true);
      loadMoreBtn.disabled = false;
    });
  }

  // 페이지 인터랙션 — 본인 글 수정/좋아요/삭제 핸들러는 피드 페이지와 공유
  bindLuminaFeedExpand();
  bindLuminaFeedDelete();
  bindLuminaFeedEdit();
  bindLuminaFeedLike();
  bindLuminaFeedThreadBadge?.(); // #309 — 타래 배지 클릭 안내 (있을 때만)
  bindLuminaFeedComment();
  bindFeedAssetLightbox(); // 피드 이미지 라이트박스 + 우클릭 차단

  // X 패턴 3탭 (게시물 / 사진 / 숏폼) — client-side 필터
  bindUserProfileTabs();
  bindProfileEditModal();
  const requestedTab = params.get("tab");
  if (requestedTab) setUserProfileActiveTab(requestedTab);

  // #523 — 팔로워·팔로잉 목록 & 차단 UX
  bindFollowListStatClick();
  bindFollowListModal();
  bindFollowListBlockAction();
  bindBlockConfirmModal();
}

let _userProfileActiveTab = "posts";
/* 프로필 편집 모달 — 본인 프로필일 때만 작동
   - "프로필 편집" 버튼 클릭 → 모달 열기
   - 아바타 변경: 기존 uploadMypageAvatar() 재사용 (PATCH /me/profile { avatarAssetId })
   - cover banner 변경: 차모 #156 spec 받기 전엔 "곧 공개돼요" 안내
   - 자기소개 변경: PATCH /me/profile { bio } (차모 spec 미확인 → 실패 시 안내)
   - ESC, X, 배경 클릭으로 닫기 */
function bindProfileEditModal() {
  if (document._profileEditModalBound) return;
  document._profileEditModalBound = true;

  const modal = document.getElementById("profileEditModal");
  if (!modal) return;

  // 1) 열기 — "프로필 편집" 버튼 (data-open-edit-modal)
  document.addEventListener("click", e => {
    const trigger = e.target.closest("[data-open-edit-modal]");
    if (trigger) {
      e.preventDefault();
      openProfileEditModal();
    }
    // 닫기 (배경/×버튼)
    if (e.target.closest("[data-profile-edit-close]")) {
      e.preventDefault();
      closeProfileEditModal();
    }
  });

  // 2) ESC 닫기
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && modal.classList.contains("is-open")) {
      closeProfileEditModal();
    }
  });

  // 3) 자기소개 입력 카운터
  const bioInput = document.getElementById("profileEditBio");
  const bioCounter = document.getElementById("profileEditBioCounter");
  if (bioInput && bioCounter) {
    bioInput.addEventListener("input", () => {
      bioCounter.textContent = bioInput.value.length;
    });
  }

  // 4) 아바타 변경 버튼 → 파일 선택 → 업로드
  const avatarChangeBtn = document.getElementById("profileEditAvatarChange");
  const avatarInput = document.getElementById("profileEditAvatarInput");
  if (avatarChangeBtn && avatarInput) {
    avatarChangeBtn.addEventListener("click", () => avatarInput.click());
    avatarInput.addEventListener("change", async () => {
      const file = avatarInput.files?.[0];
      avatarInput.value = "";
      if (!file) return;
      await handleProfileEditAvatarUpload(file);
    });
  }

  // 5) cover 변경 버튼 → 파일 선택 → 업로드 (#156 차모 spec)
  const coverChangeBtn = document.getElementById("profileEditCoverChange");
  const coverInput = document.getElementById("profileEditCoverInput");
  if (coverChangeBtn && coverInput) {
    coverChangeBtn.addEventListener("click", () => coverInput.click());
    coverInput.addEventListener("change", async () => {
      const file = coverInput.files?.[0];
      coverInput.value = "";
      if (!file) return;
      await handleProfileEditCoverUpload(file);
    });
  }

  // 6) 저장 버튼 — 자기소개만 저장 (아바타는 즉시 업로드)
  const saveBtn = document.getElementById("profileEditSaveBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => await saveProfileEdit());
  }
}

function openProfileEditModal() {
  const modal = document.getElementById("profileEditModal");
  if (!modal) return;
  // 본인 프로필 필수 검증
  const me = (typeof getAuth === "function") ? getAuth()?.user : null;
  if (!me) {
    if (typeof openAuthModal === "function") openAuthModal("login");
    return;
  }
  // 현재 user 정보로 초기값 채우기
  const profileUser = _userProfileData?.user || me;
  // 자기소개
  const bioInput = document.getElementById("profileEditBio");
  const bioCounter = document.getElementById("profileEditBioCounter");
  if (bioInput) {
    bioInput.value = (profileUser.bio || "").trim();
    if (bioCounter) bioCounter.textContent = bioInput.value.length;
  }
  // 아바타
  syncProfileEditAvatarPreview(profileUser);
  // cover
  syncProfileEditCoverPreview(profileUser);
  // 상태 초기화
  setProfileEditStatus("", "info");

  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
  // animation frame
  requestAnimationFrame(() => modal.classList.add("is-open"));
  document.body.style.overflow = "hidden";
}

function closeProfileEditModal() {
  const modal = document.getElementById("profileEditModal");
  if (!modal) return;
  modal.classList.remove("is-open");
  document.body.style.overflow = "";
  setTimeout(() => {
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
  }, 200);
}

function syncProfileEditAvatarPreview(user) {
  const preview = document.getElementById("profileEditAvatarPreview");
  const fallback = document.getElementById("profileEditAvatarFallback");
  if (!preview) return;
  const url = user?.avatarUrl || "";
  if (url) {
    preview.style.backgroundImage = `url('${String(url).replace(/'/g, "%27")}')`;
    preview.classList.add("has-image");
    if (fallback) fallback.style.display = "none";
  } else {
    preview.style.backgroundImage = "";
    preview.classList.remove("has-image");
    if (fallback) {
      fallback.textContent = (user?.displayName || "?").charAt(0);
      fallback.style.display = "";
    }
  }
}

function syncProfileEditCoverPreview(user) {
  const preview = document.getElementById("profileEditCoverPreview");
  if (!preview) return;
  const url = user?.coverImageUrl || ""; // #156 차모 spec 받으면 활성화
  if (url) {
    preview.style.backgroundImage = `url('${String(url).replace(/'/g, "%27")}')`;
    preview.classList.add("has-image");
  } else {
    preview.style.backgroundImage = "";
    preview.classList.remove("has-image");
  }
}

/* #156 차모 spec — cover banner 업로드 (avatar와 동일 flow + usageType: profile_cover)
   1. POST /me/assets/upload-intents { usageType: "profile_cover" }
   2. PUT upload.url (S3)
   3. POST /me/assets/:assetId/confirm-upload
   4. PATCH /me/profile { coverAssetId } */
async function handleProfileEditCoverUpload(file) {
  const ALLOWED = ["image/png", "image/jpeg", "image/webp"];
  const MAX = 8 * 1024 * 1024;
  if (!ALLOWED.includes(file.type)) {
    setProfileEditStatus("지원하지 않는 형식이에요. JPG, PNG, WEBP 파일을 선택해 주세요.", "error");
    return;
  }
  if (file.size > MAX) {
    setProfileEditStatus("이미지는 8MB 이하 파일로 선택해 주세요.", "error");
    return;
  }

  // blob 미리보기 (모달 cover + user-profile 헤더 cover 둘 다)
  const blobUrl = URL.createObjectURL(file);
  const modalCover = document.getElementById("profileEditCoverPreview");
  const headerCover = document.getElementById("userProfileCover");
  if (modalCover) {
    modalCover.style.backgroundImage = `url('${blobUrl}')`;
    modalCover.classList.add("has-image");
  }
  setProfileEditStatus("표지 이미지를 업로드하고 있어요…", "info");

  try {
    // 1) upload intent (usageType: profile_cover) — 차모 spec + 기존 호환 필드 둘 다
    const intent = await apiFetch("/api/v1/me/assets/upload-intents", {
      method: "POST",
      auth: true,
      throwOnError: true,
      body: {
        fileName: file.name,
        contentType: file.type,
        fileSize: file.size,
        mimeType: file.type,           // 기존 endpoint 호환
        fileSizeBytes: file.size,      // 기존 endpoint 호환
        usageType: "profile_cover"
      }
    });
    if (!intent?.asset?.id || !intent?.upload) throw new Error("Invalid upload intent");
    const assetId = intent.asset.id;
    const upload = intent.upload;

    // 2) 직접 업로드 (S3 PUT)
    if (upload.mode === "direct_upload_ready" && upload.url) {
      const putRes = await fetch(upload.url, {
        method: upload.method || "PUT",
        headers: upload.requiredHeaders || {},
        body: file
      });
      if (!putRes.ok) {
        const err = new Error(`Upload failed (${putRes.status})`);
        err.status = putRes.status;
        throw err;
      }
    }

    // 3) confirm-upload
    const confirmed = await apiFetch(`/api/v1/me/assets/${encodeURIComponent(assetId)}/confirm-upload`, {
      method: "POST", auth: true, throwOnError: true, body: {}
    });
    const finalAsset = confirmed?.asset || confirmed;
    const finalAssetId = finalAsset?.id || assetId;

    // 4) PATCH /me/profile { coverAssetId }
    const patched = await apiFetch("/api/v1/me/profile", {
      method: "PATCH", auth: true, throwOnError: true,
      body: { coverAssetId: finalAssetId }
    });
    const updatedUser = patched?.user || patched;
    const newCoverUrl = updatedUser?.coverImageUrl || updatedUser?.coverAsset?.url || finalAsset?.url || "";

    // 5) UI 갱신: 모달 + 헤더 + setAuth + _userProfileData
    if (modalCover) {
      if (newCoverUrl) {
        modalCover.style.backgroundImage = `url('${String(newCoverUrl).replace(/'/g, "%27")}')`;
        modalCover.classList.add("has-image");
      }
    }
    if (headerCover) {
      if (newCoverUrl) {
        headerCover.style.backgroundImage = `url('${String(newCoverUrl).replace(/'/g, "%27")}')`;
        headerCover.classList.add("has-image");
      }
    }
    if (_userProfileData?.user) {
      _userProfileData.user.coverImageUrl = newCoverUrl;
    }
    const auth = getAuth();
    if (auth) {
      setAuth({
        ...auth,
        user: {
          ...auth.user,
          coverImageUrl: newCoverUrl,
          coverAsset: updatedUser?.coverAsset || finalAsset
        }
      });
    }
    setProfileEditStatus("표지 이미지가 저장됐어요.", "success");
  } catch (err) {
    console.error("[#156 cover upload] 실패:", err, "status=", err?.status, "body=", err?.body);
    let msg = "표지 저장에 실패했어요. 잠시 후 다시 시도해 주세요.";
    if (err?.status === 401) msg = "로그인이 만료됐어요. 다시 로그인해 주세요.";
    else if (err?.status === 413) msg = "이미지 용량이 너무 커요. 8MB 이하 파일로 다시 시도해 주세요.";
    else if (err?.status === 415) msg = "지원하지 않는 형식이에요. JPG, PNG, WEBP 파일을 선택해 주세요.";
    setProfileEditStatus(msg, "error");
    // 실패 시 원래 cover로 복구
    syncProfileEditCoverPreview(_userProfileData?.user || getAuth()?.user || {});
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
  }
}

async function handleProfileEditAvatarUpload(file) {
  // 클라이언트 검증
  const ALLOWED = ["image/png", "image/jpeg", "image/webp"];
  const MAX = 8 * 1024 * 1024;
  if (!ALLOWED.includes(file.type)) {
    setProfileEditStatus("지원하지 않는 형식이에요. JPG, PNG, WEBP 파일을 선택해 주세요.", "error");
    return;
  }
  if (file.size > MAX) {
    setProfileEditStatus("이미지는 8MB 이하 파일로 선택해 주세요.", "error");
    return;
  }

  // blob 미리보기 (모달 + 페이지 헤더 둘 다)
  const blobUrl = URL.createObjectURL(file);
  const preview = document.getElementById("profileEditAvatarPreview");
  const fallback = document.getElementById("profileEditAvatarFallback");
  const headerAvatar = document.getElementById("userProfileAvatar");
  const headerFallback = document.getElementById("userProfileAvatarFallback");
  if (preview) {
    preview.style.backgroundImage = `url('${blobUrl}')`;
    preview.classList.add("has-image");
    if (fallback) fallback.style.display = "none";
  }
  setProfileEditStatus("프로필 사진을 업로드하고 있어요…", "info");

  try {
    // 1) upload intent — avatar용 (차모 spec 필드명 + 기존 필드명 둘 다 보내기 — 백엔드 호환성)
    const intent = await apiFetch("/api/v1/me/assets/upload-intents", {
      method: "POST",
      auth: true,
      throwOnError: true,
      body: {
        fileName: file.name,
        contentType: file.type,
        fileSize: file.size,
        mimeType: file.type,           // 기존 avatar endpoint 호환
        fileSizeBytes: file.size,      // 기존 avatar endpoint 호환
        usageType: "profile_avatar"
      }
    });
    if (!intent?.asset?.id || !intent?.upload) throw new Error("Invalid upload intent");
    const assetId = intent.asset.id;
    const upload = intent.upload;

    // 2) S3 PUT
    if (upload.mode === "direct_upload_ready" && upload.url) {
      const putRes = await fetch(upload.url, {
        method: upload.method || "PUT",
        headers: upload.requiredHeaders || {},
        body: file
      });
      if (!putRes.ok) {
        const err = new Error(`Upload failed (${putRes.status})`);
        err.status = putRes.status;
        throw err;
      }
    }

    // 3) confirm
    const confirmed = await apiFetch(`/api/v1/me/assets/${encodeURIComponent(assetId)}/confirm-upload`, {
      method: "POST", auth: true, throwOnError: true, body: {}
    });
    const finalAsset = confirmed?.asset || confirmed;
    const finalAssetId = finalAsset?.id || assetId;

    // 4) PATCH /me/profile { avatarAssetId }
    const patched = await apiFetch("/api/v1/me/profile", {
      method: "PATCH", auth: true, throwOnError: true,
      body: { avatarAssetId: finalAssetId }
    });
    const updatedUser = patched?.user || patched;
    const newAvatarUrl = updatedUser?.avatarUrl || updatedUser?.avatarAsset?.url || finalAsset?.url || "";

    // 5) UI 갱신: 모달 + 페이지 헤더 + setAuth + _userProfileData
    if (preview && newAvatarUrl) {
      preview.style.backgroundImage = `url('${String(newAvatarUrl).replace(/'/g, "%27")}')`;
      preview.classList.add("has-image");
      if (fallback) fallback.style.display = "none";
    }
    if (headerAvatar && newAvatarUrl) {
      headerAvatar.style.backgroundImage = `url('${String(newAvatarUrl).replace(/'/g, "%27")}')`;
      headerAvatar.classList.add("has-image");
      if (headerFallback) headerFallback.style.display = "none";
    }
    if (_userProfileData?.user) {
      _userProfileData.user.avatarUrl = newAvatarUrl;
    }
    const auth = getAuth();
    if (auth) {
      setAuth({
        ...auth,
        user: {
          ...auth.user,
          avatarUrl: newAvatarUrl,
          avatarAsset: updatedUser?.avatarAsset || finalAsset
        }
      });
    }
    // 헤더 드롭다운 아바타도 갱신 (있으면)
    if (typeof syncUserMenuAvatar === "function") syncUserMenuAvatar();
    setProfileEditStatus("프로필 사진이 저장됐어요.", "success");
  } catch (err) {
    console.error("[profile-edit avatar] 실패:", err, "status=", err?.status, "body=", err?.body);
    let msg = "이미지 저장에 실패했어요. 잠시 후 다시 시도해 주세요.";
    if (err?.status === 401) msg = "로그인이 만료됐어요. 다시 로그인해 주세요.";
    else if (err?.status === 413) msg = "이미지 용량이 너무 커요. 8MB 이하 파일로 다시 시도해 주세요.";
    else if (err?.status === 415) msg = "지원하지 않는 형식이에요. JPG, PNG, WEBP 파일을 선택해 주세요.";
    setProfileEditStatus(msg, "error");
    syncProfileEditAvatarPreview(_userProfileData?.user || getAuth()?.user || {});
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
  }
}

async function saveProfileEdit() {
  const saveBtn = document.getElementById("profileEditSaveBtn");
  const bioInput = document.getElementById("profileEditBio");
  if (!bioInput) return;
  const newBio = bioInput.value.trim();
  const currentBio = (_userProfileData?.user?.bio || "").trim();
  // 변경 없으면 그냥 닫기
  if (newBio === currentBio) {
    closeProfileEditModal();
    return;
  }
  if (saveBtn) saveBtn.disabled = true;
  setProfileEditStatus("저장 중…", "info");
  try {
    const patched = await apiFetch("/api/v1/me/profile", {
      method: "PATCH",
      auth: true,
      throwOnError: true,
      body: { bio: newBio }
    });
    const updatedUser = patched?.user || patched;
    // user-profile 데이터 갱신
    if (_userProfileData?.user) {
      _userProfileData.user.bio = updatedUser?.bio ?? newBio;
    }
    // 헤더 자기소개 즉시 갱신
    const bioEl = document.getElementById("userProfileBio");
    if (bioEl) {
      const finalBio = (updatedUser?.bio ?? newBio).trim();
      if (finalBio) {
        bioEl.textContent = finalBio;
        bioEl.classList.remove("is-empty");
      } else {
        bioEl.textContent = "아직 소개가 없어요.";
        bioEl.classList.add("is-empty");
      }
      bioEl.hidden = false;
      bioEl.style.display = "";
    }
    // setAuth 갱신
    const auth = getAuth();
    if (auth) setAuth({ ...auth, user: { ...auth.user, bio: updatedUser?.bio ?? newBio } });
    setProfileEditStatus("자기소개를 저장했어요.", "success");
    setTimeout(() => closeProfileEditModal(), 700);
  } catch (err) {
    console.error("[profile-edit bio] 실패:", err);
    let msg = "저장에 실패했어요. 잠시 후 다시 시도해 주세요.";
    if (err?.status === 401) msg = "로그인이 만료됐어요. 다시 로그인해 주세요.";
    else if (err?.status === 422 || err?.status === 400) msg = "입력한 내용을 확인해 주세요.";
    setProfileEditStatus(msg, "error");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

function setProfileEditStatus(text, kind) {
  const el = document.getElementById("profileEditStatus");
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.textContent = text;
  el.dataset.kind = kind || "info";
  el.hidden = false;
}

/* #155 차모 spec — 본인 좋아요한 글 목록
   GET /api/v1/me/lumina-feed/likes?take=20&cursor=<reactionId>
   응답: { items: [{ like, post }], nextCursor, ... }
   items[].post를 normalizeFeedPost로 변환해서 기존 카드 렌더러에 넣음 */
async function loadUserProfileLikes() {
  const list = document.getElementById("userProfilePostList");
  const emptyEl = document.getElementById("userProfilePostsEmpty");
  if (!list) return;

  // 로딩 안내
  list.innerHTML = `<div class="user-profile-loading" style="padding:32px 16px;text-align:center;color:rgba(220,210,240,0.55);font-size:14px;">좋아요한 글을 불러오고 있어요…</div>`;
  if (emptyEl) { emptyEl.hidden = true; emptyEl.style.display = "none"; }

  try {
    const res = await apiFetch("/api/v1/me/lumina-feed/likes?take=20", {
      auth: true,
      throwOnError: true
    });
    console.info("[#155 likes] response:", res);
    // 응답 fallback: items[].post 또는 posts[] (차모 답변에 둘 다 언급)
    let postsRaw = [];
    if (Array.isArray(res?.items) && res.items.length) {
      postsRaw = res.items.map(it => it?.post || it).filter(Boolean);
    } else if (Array.isArray(res?.posts) && res.posts.length) {
      postsRaw = res.posts;
    } else if (Array.isArray(res) && res.length) {
      postsRaw = res;
    }
    const posts = postsRaw.map(p => (typeof normalizeFeedPost === "function" ? normalizeFeedPost(p) : p));

    if (posts.length === 0) {
      list.innerHTML = "";
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.style.display = "";
        emptyEl.innerHTML = `<strong>아직 좋아요한 글이 없어요.</strong><p>마음에 든 글에 좋아요를 누르면 이곳에 모아져요.</p>`;
      }
      return;
    }

    _luminaFeedItems = posts;
    list.innerHTML = renderUserProfilePostListHtml(posts, { preservePostAuthor: true });
  } catch (err) {
    console.error("[#155 likes] 실패:", err);
    list.innerHTML = "";
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.style.display = "";
      let msg = "좋아요한 글을 불러오지 못했어요.";
      if (err?.status === 401) msg = "로그인이 만료됐어요. 다시 로그인해 주세요.";
      emptyEl.innerHTML = `<strong>${feedEscapeHtml(msg)}</strong><p>잠시 후 다시 시도해 주세요.</p>`;
    }
  }
}

function bindUserProfileTabs() {
  const tabs = document.querySelectorAll("[data-user-profile-tab]");
  if (!tabs.length) return;
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const key = tab.dataset.userProfileTab;
      setUserProfileActiveTab(key);
    });
  });
}

function setUserProfileActiveTab(key) {
  const allowed = new Set(["posts", "media", "shortform", "likes"]);
  if (!allowed.has(key) || _userProfileActiveTab === key) return;
  const targetTab = document.querySelector(`[data-user-profile-tab="${key}"]`);
  if (targetTab?.hidden || targetTab?.style?.display === "none") return;
  _userProfileActiveTab = key;
  document.querySelectorAll("[data-user-profile-tab]").forEach(t => {
    const active = t.dataset.userProfileTab === key;
    t.classList.toggle("is-active", active);
    t.setAttribute("aria-selected", active ? "true" : "false");
  });
  applyUserProfileTabFilter();
}

function applyUserProfileTabFilter() {
  const list = document.getElementById("userProfilePostList");
  const emptyEl = document.getElementById("userProfilePostsEmpty");
  const loadMoreBtn = document.getElementById("userProfileLoadMore");
  if (!list) return;

  const all = Array.isArray(_luminaFeedItems) ? _luminaFeedItems : [];

  // ── 사진 탭 → 그리드 갤러리 (X / IG 미디어 탭 스타일)
  if (_userProfileActiveTab === "media") {
    // 모든 글의 자산에서 이미지만 펼쳐서 정사각형 썸네일 그리드로
    const images = [];
    all.forEach(p => {
      if (!Array.isArray(p.assets)) return;
      p.assets.forEach(a => {
        const url = a?.asset?.url || a?.url || a?.publicUrl || "";
        const thumb = a?.asset?.thumbnailUrl || a?.thumbnailUrl || url;
        const type = (a?.asset?.mimeType || a?.type || a?.mimeType || "").toString().toLowerCase();
        const isImage = /^image\//.test(type) || /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(url);
        if (url && isImage) images.push({ url, thumb });
      });
    });
    if (images.length === 0) {
      list.innerHTML = "";
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.style.display = "";
        emptyEl.innerHTML = `<strong>아직 사진이 없어요.</strong><p>이미지가 포함된 글이 이곳에 모아져요.</p>`;
      }
    } else {
      if (emptyEl) { emptyEl.hidden = true; emptyEl.style.display = "none"; }
      const sources = images.map(i => i.url).join("|");
      list.innerHTML = `<div class="user-profile-media-grid" data-feed-asset-group="${feedEscapeHtml(sources)}">
        ${images.map((img, idx) => `
          <a class="user-profile-media-item feed-post-asset-item" href="${feedEscapeHtml(img.url)}" target="_blank" rel="noopener noreferrer" data-feed-asset data-asset-index="${idx}" data-asset-url="${feedEscapeHtml(img.url)}">
            <img src="${feedEscapeHtml(img.thumb)}" alt="" loading="lazy" oncontextmenu="return false;" draggable="false" />
          </a>
        `).join("")}
      </div>`;
    }
    if (loadMoreBtn) { loadMoreBtn.hidden = true; loadMoreBtn.style.display = "none"; }
    return;
  }

  // ── 숏폼 탭 placeholder
  if (_userProfileActiveTab === "shortform") {
    list.innerHTML = "";
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.style.display = "";
      emptyEl.innerHTML = `<strong>숏폼은 곧 공개돼요.</strong><p>준비되는 대로 이곳에 모아볼 수 있게 할게요.</p>`;
    }
    if (loadMoreBtn) { loadMoreBtn.hidden = true; loadMoreBtn.style.display = "none"; }
    return;
  }

  // ── 좋아요 탭: 본인만 노출, #155 차모 endpoint
  // GET /api/v1/me/lumina-feed/likes?take=20&cursor=<reactionId>
  // 응답: { items: [{ like, post }], nextCursor, ... }
  if (_userProfileActiveTab === "likes") {
    if (loadMoreBtn) { loadMoreBtn.hidden = true; loadMoreBtn.style.display = "none"; }
    loadUserProfileLikes(); // 비동기로 endpoint 호출 + 렌더
    return;
  }

  // ── 게시물 탭 (기본)
  const filtered = all;
  if (filtered.length === 0) {
    list.innerHTML = "";
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.style.display = "";
      emptyEl.innerHTML = `<strong>아직 공개한 글이 없어요.</strong><p>피드에 글을 남기면 이곳에 모아볼 수 있습니다.</p>`;
    }
  } else {
    if (emptyEl) { emptyEl.hidden = true; emptyEl.style.display = "none"; }
    list.innerHTML = renderUserProfilePostListHtml(filtered);
  }

  // 더 보기 버튼은 게시물 탭에서만 노출
  if (loadMoreBtn) {
    const showLoadMore = _userProfileActiveTab === "posts" && !!_userProfilePostsCursor;
    loadMoreBtn.hidden = !showLoadMore;
    loadMoreBtn.style.display = showLoadMore ? "" : "none";
  }
}

function renderUserProfileCard(data) {
  const card = document.getElementById("userProfileCard");
  if (!card) return;
  card.hidden = false;
  card.style.display = "";

  // 빈 상태 카드들 강제 숨김 (i18n/CSS 무관)
  ["userProfileEmpty", "userProfileBlocked"].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.hidden = true; el.style.display = "none"; }
  });

  const user = data.user || {};
  const stats = data.stats || {};
  const viewer = data.viewer || {};

  // 페이지 타이틀
  document.title = `${user.displayName || "프로필"} — Lumina Stage`;

  // Cover banner — coverImageUrl 있으면 이미지로 덮음, 없으면 CSS 기본 그라디언트
  const coverEl = document.getElementById("userProfileCover");
  if (coverEl) {
    if (user.coverImageUrl) {
      coverEl.style.backgroundImage = `url('${String(user.coverImageUrl).replace(/'/g, "%27")}')`;
      coverEl.classList.add("has-image");
    } else {
      coverEl.style.backgroundImage = "";
      coverEl.classList.remove("has-image");
    }
  }

  // 아바타
  const avatarEl = document.getElementById("userProfileAvatar");
  const avatarFallback = document.getElementById("userProfileAvatarFallback");
  if (avatarEl) {
    if (user.avatarUrl) {
      avatarEl.style.backgroundImage = `url('${user.avatarUrl}')`;
      avatarEl.classList.add("has-image");
      if (avatarFallback) avatarFallback.style.display = "none";
    } else if (avatarFallback) {
      avatarFallback.textContent = (user.displayName || "?").charAt(0);
      avatarFallback.style.display = "";
    }
  }

  // 이름·핸들
  const nameEl = document.getElementById("userProfileName");
  if (nameEl) nameEl.textContent = user.displayName || "Lumina User";
  const handleEl = document.getElementById("userProfileHandle");
  if (handleEl) {
    // 자동 생성된 핸들(user-xxxxxxxxxxxx 패턴)은 사용자에게 의미 없는 식별자라 숨김
    // 사용자가 직접 설정한 publicHandle만 노출 (영문/숫자 짧은 핸들)
    const handle = (user.publicHandle || "").trim();
    const isAutoGenerated = /^user-[a-f0-9]{16,}$/i.test(handle) || handle.length > 24;
    if (handle && !isAutoGenerated) {
      handleEl.textContent = `@${handle}`;
      handleEl.hidden = false;
      handleEl.style.display = "";
    } else {
      handleEl.textContent = "";
      handleEl.hidden = true;
      handleEl.style.display = "none";
    }
  }

  // 자기소개 (#154 에밀리 카피: 비어있으면 "아직 소개가 없어요." 표시)
  const bioEl = document.getElementById("userProfileBio");
  const bioToggleEl = document.getElementById("userProfileBioToggle");
  if (bioEl) {
    const bio = (user.bio || "").trim();
    if (bio) {
      bioEl.textContent = bio;
      bioEl.classList.remove("is-empty");
      bioEl.classList.remove("is-expanded");
    } else {
      bioEl.textContent = "아직 소개가 없어요.";
      bioEl.classList.add("is-empty");
      bioEl.classList.remove("is-expanded");
    }
    bioEl.hidden = false;
    bioEl.style.display = "";

    // 더보기 토글 — 3줄 넘으면 노출
    if (bioToggleEl) {
      bioToggleEl.textContent = "더 보기";
      // 다음 프레임에 측정 (line-clamp 적용 후)
      requestAnimationFrame(() => {
        const isClipped = !bioEl.classList.contains("is-empty") && (bioEl.scrollHeight > bioEl.clientHeight + 1);
        if (isClipped) {
          bioToggleEl.classList.add("is-visible");
          if (!bioToggleEl._bound) {
            bioToggleEl._bound = true;
            bioToggleEl.addEventListener("click", () => {
              const expanded = bioEl.classList.toggle("is-expanded");
              bioToggleEl.textContent = expanded ? "접기" : "더 보기";
            });
          }
        } else {
          bioToggleEl.classList.remove("is-visible");
        }
      });
    }
  }

  // 통계
  setUserProfileStat("userProfileFollowerCount", stats.followerCount ?? stats.followers ?? 0);
  setUserProfileStat("userProfileFollowingCount", (stats.followingCount ?? stats.followingUsers ?? 0));
  setUserProfileStat("userProfilePostCount", stats.postCount ?? stats.posts ?? 0);

  // 액션 (본인 vs 남) — 본인이면 편집만, 남이면 팔로우만. 둘 다 보이는 일 절대 금지.
  const followBtn = document.getElementById("userProfileFollowBtn");
  const editBtn = document.getElementById("userProfileEditBtn");
  // 본인 판단: viewer.isSelf 또는 viewer.canEditProfile 또는 (로그인 사용자 id == 프로필 user id) 중 하나라도 true면 본인
  const myUserId = (typeof getAuth === "function") ? (getAuth()?.user?.id || getAuth()?.user?.userId) : null;
  const isSelf = !!(viewer.isSelf || viewer.canEditProfile || (myUserId && user.id && String(myUserId) === String(user.id)));
  if (isSelf) {
    if (editBtn)   { editBtn.hidden = false;  editBtn.style.display = ""; }
    if (followBtn) { followBtn.hidden = true; followBtn.style.display = "none"; }
    // 본인 프로필이면 "좋아요" 탭 노출 (다른 사람에겐 안 보임)
    const likesTab = document.querySelector(".user-profile-tab-likes");
    if (likesTab) { likesTab.hidden = false; likesTab.style.display = ""; }
  } else {
    if (editBtn)   { editBtn.hidden = true;   editBtn.style.display = "none"; }
    if (followBtn) {
      followBtn.hidden = false;
      followBtn.style.display = "";
      followBtn.dataset.userId = user.id || "";
      applyUserProfileFollowState(viewer);
    }
    // 좋아요 탭 강제 숨김 (다른 사람 프로필)
    const likesTab = document.querySelector(".user-profile-tab-likes");
    if (likesTab) { likesTab.hidden = true; likesTab.style.display = "none"; }
  }
}

function setUserProfileStat(elId, value) {
  const el = document.getElementById(elId);
  if (!el) return;
  const n = Number(value) || 0;
  el.textContent = n.toLocaleString("ko-KR");
}

function applyUserProfileFollowState(viewer) {
  const btn = document.getElementById("userProfileFollowBtn");
  if (!btn) return;
  const label = btn.querySelector("[data-detail-follow-label]");
  if (viewer?.isFollowing || viewer?.canUnfollow) {
    btn.classList.add("is-following");
    btn.dataset.following = "1";
    if (label) label.textContent = "팔로잉 해제";
  } else {
    btn.classList.remove("is-following");
    btn.dataset.following = "0";
    if (label) label.textContent = "팔로우";
  }
}

function bindUserProfileFollow() {
  const btn = document.getElementById("userProfileFollowBtn");
  if (!btn || btn._bound) return;
  btn._bound = true;
  btn.addEventListener("click", async e => {
    e.preventDefault();
    if (btn.dataset.busy === "1") return;
    if (typeof getAccessToken === "function" && !getAccessToken()) {
      alert("로그인 후 팔로우할 수 있어요.");
      return;
    }
    const userId = btn.dataset.userId;
    if (!userId) return;
    const wasFollowing = btn.dataset.following === "1";
    btn.dataset.busy = "1";
    // 낙관적 토글
    btn.classList.toggle("is-following", !wasFollowing);
    btn.dataset.following = wasFollowing ? "0" : "1";
    const label = btn.querySelector("[data-detail-follow-label]");
    if (label) label.textContent = wasFollowing ? "팔로우" : "팔로잉 해제";
    try {
      const res = await apiFetch(`/api/v1/users/${encodeURIComponent(userId)}/follow`, {
        method: wasFollowing ? "DELETE" : "POST",
        auth: true,
        throwOnError: true
      });
      // #153 — 응답에 stats/viewer 포함됨. 정확한 값으로 재반영
      if (res?.viewer) applyUserProfileFollowState(res.viewer);
      if (res?.stats) {
        const followerCount = res.stats.followerCount ?? res.stats.followers ?? null;
        if (followerCount !== null) setUserProfileStat("userProfileFollowerCount", followerCount);
      }
    } catch (err) {
      // 롤백
      btn.classList.toggle("is-following", wasFollowing);
      btn.dataset.following = wasFollowing ? "1" : "0";
      if (label) label.textContent = wasFollowing ? "팔로잉 해제" : "팔로우";
      console.warn("[#152 user follow] 실패", { status: err?.status, body: err?.body });
      alert(err?.message || "팔로우 처리에 실패했어요.");
    } finally {
      btn.dataset.busy = "0";
    }
  });
}

async function loadUserProfilePosts(endpoint, isAuth, append) {
  const list = document.getElementById("userProfilePostList");
  const section = document.getElementById("userProfilePostsSection");
  const emptyEl = document.getElementById("userProfilePostsEmpty");
  const loadMoreBtn = document.getElementById("userProfileLoadMore");
  if (!list || !section) return;
  section.hidden = false;
  section.style.display = "";
  try {
    const res = await apiFetch(endpoint, { auth: isAuth });
    const items = Array.isArray(res?.items) ? res.items : [];
    const normalized = items.map(normalizeFeedPost);

    if (!append) {
      _luminaFeedItems = normalized; // 피드 페이지 함수와 공유 — 좋아요/수정/삭제 핸들러가 _luminaFeedItems 사용
    } else {
      _luminaFeedItems = (_luminaFeedItems || []).concat(normalized);
    }

    // 카드 렌더 + 빈 상태 명시 토글 (display까지 같이)
    if (!append && normalized.length === 0) {
      list.innerHTML = "";
      if (emptyEl) { emptyEl.hidden = false; emptyEl.style.display = ""; }
    } else if (emptyEl) {
      emptyEl.hidden = true;
      emptyEl.style.display = "none";
    }
    if (normalized.length > 0) {
      const html = renderUserProfilePostListHtml(normalized);
      if (append) {
        list.insertAdjacentHTML("beforeend", html);
      } else {
        list.innerHTML = html;
      }
    }

    // 다음 페이지 cursor
    _userProfilePostsCursor = res?.nextCursor || null;
    if (loadMoreBtn) {
      const show = !!_userProfilePostsCursor;
      loadMoreBtn.hidden = !show;
      loadMoreBtn.style.display = show ? "" : "none";
    }
  } catch (err) {
    console.warn("[#152 user-profile posts] 조회 실패:", err?.status, err?.message);
    if (!append && list) {
      list.innerHTML = `<p class="user-profile-posts-empty" style="display:block;">글 목록을 불러오지 못했어요.</p>`;
    }
    if (emptyEl) emptyEl.hidden = true;
  }
}

/* user-profile.html 전용 글 카드 렌더 (피드 페이지의 카드 디자인과 일관성) */
function renderUserProfilePostListHtml(posts, options = {}) {
  // 기본 글 목록은 프로필 주인이 작성자라 헤더 정보로 보정.
  // 좋아요 탭은 다른 사람 글을 모아보는 영역이라 원작성자 정보를 보존해야 함.
  const profileUser = _userProfileData?.user || {};
  return posts.map(post => {
    const preservePostAuthor = !!options.preservePostAuthor;
    const displayName = preservePostAuthor
      ? (post.authorName || "Lumina User")
      : (profileUser.displayName || "Lumina User");
    const avatarUrl = preservePostAuthor ? (post.avatarUrl || "") : (profileUser.avatarUrl || "");
    const authorTarget = preservePostAuthor
      ? buildUserProfileUrl({
          publicHandle: post.authorPublicHandle,
          id: post.authorUserId
        })
      : "";
    const authorLinkAttr = preservePostAuthor && (post.authorPublicHandle || post.authorUserId)
      ? buildMiniProfileAuthorAttrs({
          target: authorTarget,
          handle: post.authorPublicHandle,
          userId: post.authorUserId
        })
      : "";
    const initial = (displayName || "?").charAt(0);
    const avatarSrc = avatarUrl;
    const deleteButton = post.viewer?.canDelete && post.id
      ? `<button class="feed-action-btn feed-delete-btn" type="button" data-feed-delete="${feedEscapeHtml(post.id)}" aria-label="게시글 삭제">삭제</button>`
      : "";
    const editButton = post.viewer?.canEdit && post.id
      ? `<button class="feed-action-btn feed-edit-btn" type="button" data-feed-edit="${feedEscapeHtml(post.id)}" aria-label="게시글 수정">수정</button>`
      : "";
    return `
      <article class="feed-post" data-feed-type="${post.postType}">
        <header class="feed-post-head"${authorLinkAttr}>
          <div class="feed-post-avatar">
            ${avatarSrc
              ? `<img src="${feedEscapeHtml(avatarSrc)}" alt="${feedEscapeHtml(displayName)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><span class="feed-post-avatar-fallback" style="display:none;">${feedEscapeHtml(initial)}</span>`
              : `<span class="feed-post-avatar-fallback">${feedEscapeHtml(initial)}</span>`}
          </div>
          <div class="feed-post-meta">
            <strong class="feed-post-author">${feedEscapeHtml(displayName)}</strong>
          </div>
        </header>
        <p class="feed-post-body">${feedEscapeHtml(post.body)}</p>
        ${renderFeedPostThreadBadge(post)}
        ${renderFeedPostAssets(post.assets)}
        ${renderFeedLinkPreview(post.linkPreview)}
        <footer class="feed-post-actions">
          <button class="feed-action-btn feed-like-btn${post.viewer?.hasLiked ? " is-liked" : ""}" type="button"
                  data-feed-like="${feedEscapeHtml(post.id || "")}"
                  aria-pressed="${post.viewer?.hasLiked ? "true" : "false"}"
                  aria-label="${post.viewer?.hasLiked ? "좋아요 취소하기" : "좋아요 누르기"}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.5-9.5-9.5C1 8.5 3.5 5.5 7 5.5c2 0 3.5 1 5 2.5 1.5-1.5 3-2.5 5-2.5 3.5 0 6 3 4.5 6-2 5-9.5 9.5-9.5 9.5z" stroke="currentColor" fill="none" stroke-width="1.6"/></svg>
            <span data-feed-like-count>${Number(post.likeCount) || 0}</span>
          </button>
          <button class="feed-action-btn feed-comment-btn" type="button" data-feed-comment="${feedEscapeHtml(post.id || "")}" aria-label="댓글 보기">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v10H7l-3 3z" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linejoin="round"/></svg>
            <span>${Number(post.replyCount) > 0 ? Number(post.replyCount) : "0"}</span>
          </button>
          ${editButton}
          ${deleteButton}
        </footer>
      </article>
    `;
  }).join("");
}

function showUserProfileNotFound() {
  const empty = document.getElementById("userProfileEmpty");
  if (empty) { empty.hidden = false; empty.style.display = ""; }
  // 다른 카드들은 강제 숨김
  ["userProfileCard", "userProfileBlocked", "userProfilePostsSection"].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.hidden = true; el.style.display = "none"; }
  });
  document.title = "프로필을 찾을 수 없어요 — Lumina Stage";
}
function showUserProfileBlocked() {
  const blocked = document.getElementById("userProfileBlocked");
  if (blocked) { blocked.hidden = false; blocked.style.display = ""; }
  ["userProfileCard", "userProfileEmpty", "userProfilePostsSection"].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.hidden = true; el.style.display = "none"; }
  });
  document.title = "이 프로필을 볼 수 없어요 — Lumina Stage";
}

/* ══════════════════════════════════════════════════════════════
   #523 — 팔로워·팔로잉 목록 모달 & 차단 UX
   - 팔로워/팔로잉 숫자 클릭 → 목록 모달
   - 본인 프로필이면 팔로워 목록에 "차단" 버튼 (live)
   - "팔로워 제거"는 contract-ready → 비활성 표시
   - 차단 전 확인 모달 (실수 방지)
   ══════════════════════════════════════════════════════════════ */

let _followListActiveTab = "followers"; // "followers" | "following"
let _followListCursor = null;
let _followListIsSelf = false;
let _followListTargetId = null;
let _blockConfirmTargetId = null;
let _blockConfirmTargetName = "";

// ── 통계 숫자 클릭 바인딩 ──
function bindFollowListStatClick() {
  const statItems = document.querySelectorAll(".user-profile-stats li");
  statItems.forEach(li => {
    const label = li.querySelector("small");
    if (!label) return;
    const text = (label.textContent || "").trim();
    let type = null;
    if (text === "팔로워") type = "followers";
    if (text === "팔로잉") type = "following";
    if (!type) return;
    li.style.cursor = "pointer";
    li.addEventListener("click", () => openFollowListModal(type));
  });
}

// ── 목록 모달 열기 ──
function openFollowListModal(type) {
  const modal = document.getElementById("followListModal");
  if (!modal) return;

  _followListActiveTab = type || "followers";
  _followListCursor = null;

  // isSelf 판단 (renderUserProfileCard와 동일 로직)
  const viewer = _userProfileData?.viewer || {};
  const profileUser = _userProfileData?.user || {};
  const myUserId = (typeof getAuth === "function") ? (getAuth()?.user?.id || getAuth()?.user?.userId) : null;
  _followListIsSelf = !!(viewer.isSelf || viewer.canEditProfile || (myUserId && profileUser.id && String(myUserId) === String(profileUser.id)));
  _followListTargetId = profileUser.id || null;

  // 탭 상태 갱신
  modal.querySelectorAll("[data-follow-tab]").forEach(tab => {
    const isActive = tab.dataset.followTab === _followListActiveTab;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  const titleEl = document.getElementById("followListModalTitle");
  if (titleEl) titleEl.textContent = _followListActiveTab === "followers" ? "팔로워" : "팔로잉";

  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => modal.classList.add("is-open"));
  document.body.style.overflow = "hidden";

  loadFollowList(_followListActiveTab, /* append */ false);
}

// ── 목록 모달 닫기 ──
function closeFollowListModal() {
  const modal = document.getElementById("followListModal");
  if (!modal) return;
  modal.classList.remove("is-open");
  document.body.style.overflow = "";
  setTimeout(() => {
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
  }, 200);
}

// ── 목록 모달 이벤트 바인딩 ──
function bindFollowListModal() {
  const modal = document.getElementById("followListModal");
  if (!modal || modal._bound523) return;
  modal._bound523 = true;

  document.getElementById("followListCloseBtn")?.addEventListener("click", closeFollowListModal);
  document.getElementById("followListModalBackdrop")?.addEventListener("click", closeFollowListModal);

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && modal.classList.contains("is-open")) closeFollowListModal();
  });

  // 탭 전환
  modal.querySelectorAll("[data-follow-tab]").forEach(tab => {
    tab.addEventListener("click", () => {
      const newType = tab.dataset.followTab;
      if (newType === _followListActiveTab) return;
      _followListActiveTab = newType;
      _followListCursor = null;
      modal.querySelectorAll("[data-follow-tab]").forEach(t => {
        const active = t.dataset.followTab === newType;
        t.classList.toggle("is-active", active);
        t.setAttribute("aria-selected", active ? "true" : "false");
      });
      const titleEl = document.getElementById("followListModalTitle");
      if (titleEl) titleEl.textContent = newType === "followers" ? "팔로워" : "팔로잉";
      loadFollowList(newType, false);
    });
  });

  // 더 보기
  document.getElementById("followListLoadMore")?.addEventListener("click", async () => {
    if (!_followListCursor) return;
    const btn = document.getElementById("followListLoadMore");
    if (btn) btn.disabled = true;
    await loadFollowList(_followListActiveTab, true);
    if (btn) btn.disabled = false;
  });
}

// ── API 호출 & 목록 렌더 ──
async function loadFollowList(type, append) {
  const itemsEl = document.getElementById("followListItems");
  const emptyEl = document.getElementById("followListEmpty");
  const loadMoreBtn = document.getElementById("followListLoadMore");
  if (!itemsEl) return;

  if (!append) {
    itemsEl.innerHTML = `<div class="follow-list-loading">불러오는 중…</div>`;
    if (emptyEl) { emptyEl.hidden = true; emptyEl.innerHTML = ""; }
    if (loadMoreBtn) loadMoreBtn.hidden = true;
  }

  const isAuth = typeof isLoggedIn === "function" && isLoggedIn();
  let endpoint;
  if (_followListIsSelf) {
    // 본인: /me/* 엔드포인트 (live)
    endpoint = type === "followers"
      ? `/api/v1/me/followers?take=20`
      : `/api/v1/me/following-users?take=20`;
  } else {
    // 타인: /users/:id/* (contract-ready)
    const uid = encodeURIComponent(_followListTargetId || "");
    endpoint = type === "followers"
      ? `/api/v1/users/${uid}/followers?take=20`
      : `/api/v1/users/${uid}/following-users?take=20`;
  }
  if (_followListCursor) endpoint += `&cursor=${encodeURIComponent(_followListCursor)}`;

  try {
    const res = await apiFetch(endpoint, { auth: isAuth });
    const rawItems = Array.isArray(res?.items) ? res.items
      : Array.isArray(res?.users) ? res.users
      : [];

    if (!append) itemsEl.innerHTML = "";

    if (rawItems.length === 0 && !append) {
      if (emptyEl) {
        const label = type === "followers" ? "팔로워가 아직 없어요." : "팔로잉이 아직 없어요.";
        emptyEl.innerHTML = `<strong>${label}</strong>`;
        emptyEl.hidden = false;
      }
      if (loadMoreBtn) loadMoreBtn.hidden = true;
      return;
    }

    const html = rawItems.map(item => renderFollowListItem(item, type)).join("");
    if (append) {
      itemsEl.insertAdjacentHTML("beforeend", html);
    } else {
      itemsEl.innerHTML = html;
    }

    _followListCursor = res?.nextCursor || null;
    if (loadMoreBtn) loadMoreBtn.hidden = !_followListCursor;

  } catch (err) {
    console.warn(`[#523 follow-list] ${type} 로드 실패:`, err?.status, err?.message);
    if (!append) {
      itemsEl.innerHTML = "";
      let msg = "목록을 불러오지 못했어요.";
      let sub = "잠시 후 다시 시도해 주세요.";
      if (err?.status === 404 || err?.status === 501) {
        msg = "이 목록은 아직 준비 중이에요.";
        sub = "조금만 기다려 주세요.";
      } else if (err?.status === 403) {
        msg = "이 프로필의 목록을 볼 수 없어요.";
        sub = "";
      }
      if (emptyEl) {
        emptyEl.innerHTML = `<strong>${msg}</strong>${sub ? `<p>${sub}</p>` : ""}`;
        emptyEl.hidden = false;
      }
      if (loadMoreBtn) loadMoreBtn.hidden = true;
    }
  }
}

// ── 목록 아이템 HTML ──
function renderFollowListItem(item, type) {
  const user = item?.user || item || {};
  const userId = user?.id || "";
  const displayName = user?.displayName || "Lumina User";
  const publicHandle = user?.publicHandle || "";
  const avatarUrl = user?.avatarUrl || "";
  const initial = (displayName || "?").charAt(0);

  const profileHref = (typeof buildUserProfileUrl === "function")
    ? buildUserProfileUrl({ publicHandle, id: userId })
    : `/user-profile?id=${encodeURIComponent(userId)}`;

  const esc = (s) => (typeof feedEscapeHtml === "function") ? feedEscapeHtml(String(s)) : String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

  const avatarHtml = avatarUrl
    ? `<img src="${esc(avatarUrl)}" alt="${esc(displayName)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><span class="follow-list-item-avatar-fallback" style="display:none;">${esc(initial)}</span>`
    : `<span class="follow-list-item-avatar-fallback">${esc(initial)}</span>`;

  const handleHtml = publicHandle
    ? `<span class="follow-list-item-handle">@${esc(publicHandle)}</span>`
    : "";

  // 차단·제거 버튼 (본인 팔로워 목록에만)
  let actionsHtml = "";
  if (_followListIsSelf && type === "followers" && userId) {
    actionsHtml = `
      <div class="follow-list-item-actions">
        <button class="follow-list-block-btn" type="button"
                data-follow-block-user="${esc(userId)}"
                data-follow-block-name="${esc(displayName)}">차단</button>
        <button class="follow-list-remove-btn" type="button" disabled
                title="팔로워 제거는 준비 중이에요.">제거</button>
      </div>`;
  }

  return `
    <div class="follow-list-item" data-follow-item-user="${esc(userId)}">
      <a class="follow-list-item-avatar" href="${esc(profileHref)}" target="_blank" rel="noopener noreferrer">
        ${avatarHtml}
      </a>
      <div class="follow-list-item-info">
        <a class="follow-list-item-name" href="${esc(profileHref)}" target="_blank" rel="noopener noreferrer">${esc(displayName)}</a>
        ${handleHtml}
      </div>
      ${actionsHtml}
    </div>`;
}

// ── 차단 버튼 이벤트 (이벤트 위임) ──
function bindFollowListBlockAction() {
  const itemsEl = document.getElementById("followListItems");
  if (!itemsEl || itemsEl._blockBound523) return;
  itemsEl._blockBound523 = true;

  itemsEl.addEventListener("click", e => {
    const btn = e.target.closest("[data-follow-block-user]");
    if (!btn) return;
    e.preventDefault();
    const userId = btn.dataset.followBlockUser;
    const displayName = btn.dataset.followBlockName || "이 회원";
    if (!userId) return;
    openBlockConfirmModal(userId, displayName);
  });
}

// ── 차단 확인 모달 ──
function openBlockConfirmModal(userId, displayName) {
  _blockConfirmTargetId = userId;
  _blockConfirmTargetName = displayName;

  const modal = document.getElementById("blockConfirmModal");
  if (!modal) return;

  const descEl = document.getElementById("blockConfirmDesc");
  if (descEl) {
    descEl.textContent = `차단하면 ${displayName}님이 내 글·프로필을 볼 수 없어요. 양쪽 팔로우도 해제돼요.`;
  }

  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
}

function closeBlockConfirmModal() {
  const modal = document.getElementById("blockConfirmModal");
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute("aria-hidden", "true");
  _blockConfirmTargetId = null;
  _blockConfirmTargetName = "";
}

function bindBlockConfirmModal() {
  const modal = document.getElementById("blockConfirmModal");
  if (!modal || modal._bound523) return;
  modal._bound523 = true;

  document.getElementById("blockConfirmCancel")?.addEventListener("click", closeBlockConfirmModal);
  document.getElementById("blockConfirmBackdrop")?.addEventListener("click", closeBlockConfirmModal);

  document.getElementById("blockConfirmSubmit")?.addEventListener("click", async () => {
    if (!_blockConfirmTargetId) return;
    const submitBtn = document.getElementById("blockConfirmSubmit");
    if (submitBtn) submitBtn.disabled = true;

    try {
      await apiFetch(`/api/v1/users/${encodeURIComponent(_blockConfirmTargetId)}/block`, {
        method: "POST",
        auth: true,
        throwOnError: true,
        body: {}
      });

      // 성공: 목록에서 해당 아이템 페이드 아웃
      const targetId = _blockConfirmTargetId;
      closeBlockConfirmModal();
      const itemEl = document.querySelector(`[data-follow-item-user="${targetId}"]`);
      if (itemEl) {
        itemEl.style.transition = "opacity 0.22s, transform 0.22s";
        itemEl.style.opacity = "0";
        itemEl.style.transform = "translateX(10px)";
        setTimeout(() => itemEl.remove(), 230);
      }
      // 팔로워 카운트 -1 (낙관적)
      const followerCountEl = document.getElementById("userProfileFollowerCount");
      if (followerCountEl) {
        const cur = parseInt((followerCountEl.textContent || "0").replace(/,/g, ""), 10) || 0;
        followerCountEl.textContent = Math.max(0, cur - 1).toLocaleString("ko-KR");
      }
    } catch (err) {
      console.error("[#523 block] 실패:", err?.status, err?.message);
      let msg = "차단에 실패했어요. 잠시 후 다시 시도해 주세요.";
      if (err?.status === 401) msg = "로그인이 만료됐어요. 다시 로그인해 주세요.";
      if (submitBtn) submitBtn.disabled = false;
      alert(msg);
    }
  });
}

  window.initUserProfilePage = initUserProfilePage;
})();
