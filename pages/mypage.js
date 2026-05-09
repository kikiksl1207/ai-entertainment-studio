(function initMypageModule() {
function setMypageText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setMypageInput(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function formatMypageNumber(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

function getMypageAccountDisplayId(user = {}) {
  const social = user.socialAccount || user.socialProfile || user.oauthAccount || user.providerAccount || {};
  const provider = user.provider || user.socialProvider || social.provider || "";
  const socialId = user.providerUserId || user.socialId || user.externalId || social.providerUserId || social.providerId || social.socialId;
  if (socialId) return provider ? `${provider}:${socialId}` : socialId;
  return user.email ? user.email.split("@")[0] : (user.id || user.userId || user.uuid || "계정 ID 확인 중");
}

function updateMypageProfilePreview(user = {}, displayName = "") {
  const name = displayName || user.displayName || user.name || user.nickname || user.email || "LS";
  const initials = name.replace(/\s+/g, "").slice(0, 2).toUpperCase() || "LS";
  const avatarUrl = user.avatarUrl || user.avatarImageUrl || user.profileImageUrl || user.avatarAsset?.url || user.profileImage?.url || "";
  setMypageText("mypageAvatar", initials);
  setMypageText("mypageProfilePreviewInitial", initials);
  const preview = document.getElementById("mypageProfilePreview");
  if (preview) {
    preview.style.backgroundImage = avatarUrl ? `url('${String(avatarUrl).replace(/'/g, "%27")}')` : "";
    preview.classList.toggle("has-image", !!avatarUrl);
  }
}

/* ══════════════════════════════════════════════
   #058 — 마이페이지 프로필 이미지 업로드/미리보기 (2026-05-03)
   - 흐름: 파일 선택 → 즉시 blob 미리보기 (is-pending)
           → upload-intent → PUT/metadata_only → confirm-upload (is-loading)
           → PATCH /me/profile { avatarAssetId } → setAuth 갱신
           → 헤더 드롭다운 / 피드 작성 아바타 동기화 (is-success)
   - 실패 시: 이전 이미지 원복 + 오류 문구 (is-error)
   ══════════════════════════════════════════════ */
const MYPAGE_AVATAR_ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const MYPAGE_AVATAR_MAX_BYTES = 8 * 1024 * 1024; // 8MB — 2026 SNS 표준 (Instagram/FB/LinkedIn/Discord/Threads 동일)

function setMypageAvatarStatus(message, kind = "info") {
  const el = document.getElementById("mypageAvatarStatus");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("is-info", "is-loading", "is-success", "is-error");
  el.classList.add(`is-${kind}`);
}

function setMypageAvatarPreviewState(state) {
  // state: "idle" | "pending" | "loading" | "success" | "error"
  const preview = document.getElementById("mypageProfilePreview");
  if (!preview) return;
  preview.classList.remove("is-pending", "is-loading", "is-success", "is-error");
  if (state && state !== "idle") preview.classList.add(`is-${state}`);
}

function showMypageAvatarBlobPreview(blobUrl) {
  const preview = document.getElementById("mypageProfilePreview");
  if (!preview) return;
  preview.style.backgroundImage = `url('${String(blobUrl).replace(/'/g, "%27")}')`;
  preview.classList.add("has-image");
}

function bindMypageAvatarUpload() {
  const btn = document.getElementById("mypageAvatarButton");
  const input = document.getElementById("mypageAvatarInput");
  if (!btn || !input) return;
  if (btn._bound) return; // idempotent
  btn._bound = true;

  btn.addEventListener("click", () => {
    if (!isLoggedIn()) {
      openAuthModal?.("login");
      return;
    }
    input.click();
  });

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    // 같은 파일 재선택 가능하도록 즉시 비움
    input.value = "";
    if (!file) return;
    await handleMypageAvatarSelect(file);
  });
}

async function handleMypageAvatarSelect(file) {
  // 1) 클라이언트 검증
  if (!MYPAGE_AVATAR_ALLOWED.includes(file.type)) {
    setMypageAvatarPreviewState("error");
    setMypageAvatarStatus("지원하지 않는 형식이에요. JPG, PNG, WEBP 파일을 선택해 주세요.", "error");
    return;
  }
  if (file.size > MYPAGE_AVATAR_MAX_BYTES) {
    setMypageAvatarPreviewState("error");
    setMypageAvatarStatus("이미지는 8MB 이하 파일로 선택해 주세요.", "error");
    return;
  }

  // 2) 즉시 blob 미리보기 (저장 전 임을 시각적으로 구분)
  const blobUrl = URL.createObjectURL(file);
  showMypageAvatarBlobPreview(blobUrl);
  setMypageAvatarPreviewState("pending");
  setMypageAvatarStatus(`${file.name} 미리보기 중. 저장을 진행합니다…`, "info");

  // 3) 업로드 흐름
  try {
    setMypageAvatarPreviewState("loading");
    setMypageAvatarStatus("이미지를 업로드하고 있어요…", "loading");
    await uploadMypageAvatar(file);
    setMypageAvatarPreviewState("success");
    setMypageAvatarStatus("프로필 이미지가 저장됐어요.", "success");
    // 1.6초 후 success 표시 해제 (idle로 복귀, 저장된 이미지는 그대로 유지)
    setTimeout(() => {
      setMypageAvatarPreviewState("idle");
      setMypageAvatarStatus("선택한 이미지는 저장 전에도 이곳에서 먼저 확인할 수 있습니다.", "info");
    }, 1600);
  } catch (err) {
    // 디버깅 — 콘솔에 상세 (사용자가 콘솔에서 어느 단계 실패했는지 확인 가능)
    console.error("[#058 avatar upload] 실패:", err, "status=", err?.status, "body=", err?.body, "stage=", err?._stage);

    // 실패 시 이전 이미지로 원복
    const auth = getAuth();
    updateMypageProfilePreview(auth?.user || {}, auth?.user?.displayName || "");
    setMypageAvatarPreviewState("error");

    // status별 사용자 카피 분기
    let msg;
    if (err?.status === 401) {
      msg = "로그인이 만료됐어요. 다시 로그인해 주세요.";
    } else if (err?.status === 413) {
      msg = "이미지 용량이 너무 커요. 8MB 이하 파일로 다시 시도해 주세요.";
    } else if (err?.status === 415) {
      msg = "지원하지 않는 형식이에요. JPG, PNG, WEBP 파일을 선택해 주세요.";
    } else if (err?.status === 409) {
      msg = "같은 이미지로 이미 처리 중이에요. 잠시 후 다시 시도해 주세요.";
    } else if (err?.status === 429) {
      msg = "요청이 너무 잦아요. 잠시 후 다시 시도해 주세요.";
    } else if (err?.message?.includes("Failed to fetch") || err?.name === "AbortError") {
      msg = "네트워크 연결을 확인한 뒤 다시 시도해 주세요.";
    } else {
      msg = "이미지 저장에 실패했어요. 잠시 후 다시 시도해 주세요. (상세는 개발자 콘솔 확인)";
    }
    setMypageAvatarStatus(msg, "error");
  } finally {
    // blob URL 메모리 해제 (background-image는 이미 적용됐고, 성공 시 user.avatarUrl로 덮어씌워짐)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
  }
}

async function uploadMypageAvatar(file) {
  // 1. upload-intent
  let intent;
  try {
    intent = await apiFetch("/api/v1/me/assets/upload-intents", {
      method: "POST",
      auth: true,
      throwOnError: true,
      body: {
        fileName: file.name,
        mimeType: file.type,
        fileSizeBytes: file.size
      }
    });
  } catch (err) {
    err._stage = "upload-intents";
    throw err;
  }
  if (!intent?.asset?.id || !intent?.upload) {
    const err = new Error("Invalid upload intent response");
    err._stage = "upload-intents";
    err.body = intent;
    throw err;
  }
  const assetId = intent.asset.id;
  const upload = intent.upload;
  console.info("[#058 avatar upload] intent OK", { assetId, mode: upload.mode });

  // 2. 직접 업로드 (S3/R2 direct upload mode)
  if (upload.mode === "direct_upload_ready" && upload.url) {
    const headers = upload.requiredHeaders || {};
    let putRes;
    try {
      putRes = await fetch(upload.url, {
        method: upload.method || "PUT",
        headers,
        body: file
      });
    } catch (err) {
      err._stage = "direct-upload";
      throw err;
    }
    if (!putRes.ok) {
      const err = new Error(`Upload failed (${putRes.status})`);
      err.status = putRes.status;
      err._stage = "direct-upload";
      throw err;
    }
    console.info("[#058 avatar upload] direct upload OK");
  }
  // metadata_only mode는 PUT 없이 confirm으로 진행

  // 3. confirm-upload
  let confirmed;
  try {
    confirmed = await apiFetch(`/api/v1/me/assets/${encodeURIComponent(assetId)}/confirm-upload`, {
      method: "POST",
      auth: true,
      throwOnError: true,
      body: {}
    });
  } catch (err) {
    err._stage = "confirm-upload";
    throw err;
  }
  const finalAsset = confirmed?.asset || confirmed;
  const finalAssetId = finalAsset?.id || assetId;
  console.info("[#058 avatar upload] confirm OK", { finalAssetId, url: finalAsset?.url });

  // 4. PATCH /me/profile { avatarAssetId } — 프로필에 연결
  let patched;
  try {
    patched = await apiFetch("/api/v1/me/profile", {
      method: "PATCH",
      auth: true,
      throwOnError: true,
      body: { avatarAssetId: finalAssetId }
    });
  } catch (err) {
    err._stage = "patch-profile";
    throw err;
  }
  // 응답에서 user 객체 받기 (백엔드에 따라 patched.user 또는 patched 자체)
  const updatedUser = patched?.user || patched;
  console.info("[#058 avatar upload] PATCH profile OK", updatedUser);

  // 5. setAuth 갱신 — 다른 페이지/리로드 시에도 반영되도록
  const auth = getAuth();
  if (auth) {
    const merged = {
      ...auth.user,
      ...updatedUser,
      // 신뢰 가능한 새 url 우선순위 (백엔드 필드명 다양성 대비)
      avatarUrl: updatedUser?.avatarUrl || updatedUser?.avatarAsset?.url || finalAsset?.url || auth.user?.avatarUrl,
      avatarAsset: updatedUser?.avatarAsset || finalAsset || auth.user?.avatarAsset
    };
    setAuth({ ...auth, user: merged });

    // 6. UI 동기화 — 마이페이지 / 헤더 드롭다운 / 피드 작성
    updateMypageProfilePreview(merged, merged.displayName || "");
    syncUserMenuAvatar();
    if (typeof syncFeedComposeAvatar === "function") syncFeedComposeAvatar();
  }
  return updatedUser;
}

async function initMypagePage() {
  if (!document.body.classList.contains("page-mypage")) return;

  const auth = getAuth();
  const user = auth?.user || null;
  const authed = !!auth?.accessToken;

  document.querySelectorAll("[data-auth-required]").forEach(el => {
    el.hidden = !authed;
  });
  document.querySelectorAll("[data-guest-only]").forEach(el => {
    el.hidden = authed;
  });

  document.querySelectorAll("[data-mypage-login]").forEach(btn => {
    btn.onclick = () => openAuthModal("login");
  });
  document.querySelectorAll("[data-mypage-signup]").forEach(btn => {
    btn.onclick = () => openAuthModal("register");
  });
  document.querySelectorAll("[data-mypage-placeholder]").forEach(btn => {
    btn.onclick = () => alert("차모 API 확인 후 연결될 예정입니다.");
  });

  // #058 — 프로필 이미지 업로드 핸들러 바인드 (로그인 여부 무관, 클릭 시 분기)
  bindMypageAvatarUpload();

  if (!authed) return;

  const displayName = user?.displayName || user?.name || user?.nickname || user?.email?.split("@")[0] || "내 계정";
  const email = user?.email || "이메일 확인 중";

  setMypageText("mypageUserName", displayName);
  setMypageText("mypageUserEmail", email);
  updateMypageProfilePreview(user, displayName);
  setMypageInput("mypageProfileId", getMypageAccountDisplayId(user));
  setMypageInput("mypageProfileEmail", email);
  setMypageInput("mypageNickname", displayName);

  // 공개 프로필(user-profile.html) 진입 링크 — publicHandle 우선, 없으면 user.id
  const publicProfileLink = document.getElementById("mypagePublicProfileLink");
  if (publicProfileLink) {
    if (user?.publicHandle) {
      publicProfileLink.href = `./user-profile.html?handle=${encodeURIComponent(user.publicHandle)}`;
      publicProfileLink.hidden = false;
    } else if (user?.id) {
      publicProfileLink.href = `./user-profile.html?id=${encodeURIComponent(String(user.id))}`;
      publicProfileLink.hidden = false;
    } else {
      publicProfileLink.hidden = true;
    }
  }

  const canChangeNickname = user?.canChangeNickname;
  const nextChangeAt = user?.nicknameNextChangeAt;
  if (canChangeNickname === false && nextChangeAt) {
    const nextDate = new Date(nextChangeAt).toLocaleDateString("ko-KR");
    setMypageText("mypageNicknameStatus", `${nextDate} 이후 다시 변경할 수 있습니다.`);
  } else {
    setMypageText("mypageNicknameStatus", "닉네임은 변경 후 30일 동안 다시 바꿀 수 없습니다.");
  }

  if (!_wallet?.loaded) {
    await loadWallet();
  }
  const balance = _wallet?.balance || 0;
  setMypageText("mypageLuminaBalance", formatMypageNumber(balance));
  setMypageText("mypageStellaBalance", balance >= 10000 ? formatMypageNumber(balance / 10000) : "0");
  setMypageText("mypageWalletStatus", _wallet?.loaded ? "현재 사용할 수 있는 잔액입니다." : "잔액 API 확인이 필요합니다.");

  // #140 정산 프로필 — 차모 spec: GET/PATCH /api/v1/me/settlement-profile
  initMypageSettlementProfile();
  if (typeof window.refreshMypageInlineData === "function") {
    try {
      await window.refreshMypageInlineData();
    } catch (err) {
      console.warn("[Lumina] mypage inline refresh failed:", err);
    }
  }
}

/* #140 — 정산 프로필 (마이페이지 지갑 탭, 차모 spec 그대로)
   - GET /api/v1/me/settlement-profile  → 기존 값 채우기
   - PATCH /api/v1/me/settlement-profile  → 저장
   - 서버 저장: bankName / accountHolderName(마스킹) / accountLast4 / holderMatchesIdentity / payoutExceptionReason
   - 본인인증 / 자동 송금은 별개 흐름 (#115 평가표 본인인증 게이트 30%) */
async function initMypageSettlementProfile() {
  const form = document.getElementById("mypageSettlementForm");
  if (!form) return;

  const bankInput = document.getElementById("settlementBankName");
  const holderInput = document.getElementById("settlementHolder");
  const last4Input = document.getElementById("settlementLast4");
  const matchCheck = document.getElementById("settlementHolderMatch");
  const exceptionWrap = document.getElementById("settlementExceptionWrap");
  const exceptionInput = document.getElementById("settlementException");
  const errorEl = document.getElementById("settlementError");
  const savedEl = document.getElementById("settlementSaved");
  const saveBtn = document.getElementById("settlementSaveBtn");

  // 본인 명의 체크 시 예외 사유 영역 토글
  const updateExceptionVisibility = () => {
    if (!exceptionWrap) return;
    exceptionWrap.hidden = !!matchCheck?.checked;
  };
  matchCheck?.addEventListener("change", updateExceptionVisibility);

  // 1. 기존 정산 프로필 GET
  try {
    const res = await apiFetch("/api/v1/me/settlement-profile", { auth: true });
    const profile = res?.profile || res?.data || res || {};
    if (bankInput) bankInput.value = profile.bankName || "";
    if (holderInput) holderInput.value = profile.accountHolderName || "";
    if (last4Input) last4Input.value = profile.accountLast4 || "";
    if (matchCheck) matchCheck.checked = !!profile.holderMatchesIdentity;
    if (exceptionInput) exceptionInput.value = profile.payoutExceptionReason || "";
    updateExceptionVisibility();
    if (savedEl && (profile.bankName || profile.accountLast4)) {
      savedEl.textContent = "최근 저장된 정보를 불러왔어요.";
      savedEl.hidden = false;
    }
  } catch (err) {
    // 신규 사용자 — 404/empty는 정상
    console.info("[#140 settlement-profile] 기존 정보 없음 또는 미연결:", err?.status);
    updateExceptionVisibility();
  }

  // 2. 저장
  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (errorEl) errorEl.hidden = true;
    if (savedEl) savedEl.hidden = true;

    const bankName = (bankInput?.value || "").trim();
    const accountHolderName = (holderInput?.value || "").trim();
    const accountLast4 = (last4Input?.value || "").trim();
    const holderMatchesIdentity = !!matchCheck?.checked;
    const payoutExceptionReason = (exceptionInput?.value || "").trim();

    // 클라이언트 검증
    if (!bankName) return showSettlementError("은행명을 입력해주세요.");
    if (!accountHolderName) return showSettlementError("예금주를 입력해주세요.");
    if (!/^[0-9]{4}$/.test(accountLast4)) return showSettlementError("계좌 끝 4자리는 숫자 4자리여야 해요.");

    const payload = { bankName, accountHolderName, accountLast4, holderMatchesIdentity };
    if (!holderMatchesIdentity && payoutExceptionReason) {
      payload.payoutExceptionReason = payoutExceptionReason;
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "저장 중…";
    }
    try {
      await apiFetch("/api/v1/me/settlement-profile", {
        method: "PATCH",
        auth: true,
        throwOnError: true,
        body: payload
      });
      if (savedEl) {
        savedEl.textContent = "정산 정보를 저장했어요.";
        savedEl.hidden = false;
      }
    } catch (err) {
      console.warn("[#140 settlement-profile PATCH] 실패", { status: err?.status, body: err?.body });
      showSettlementError(err?.message || "저장에 실패했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "저장";
      }
    }
  });

  function showSettlementError(msg) {
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.hidden = false;
    }
  }
}

window.initMypagePage = initMypagePage;
})();
