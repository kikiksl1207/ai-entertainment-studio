const copy = {
  ko: {
    title: "회원 탈퇴", password: "현재 비밀번호", cancel: "취소", close: "닫기", busy: "탈퇴 처리 중",
    confirm: "회원 탈퇴를 진행할까요?\n보유 중인 {balance}L은 탈퇴와 함께 소멸돼요.",
    warning: "계정 탈퇴를 요청합니다. 현재 Lumina Stage 비밀번호를 확인해 주세요.",
    unsupported: "소셜 전용 또는 비밀번호가 없는 계정은 이 화면에서 탈퇴할 수 없습니다. 소셜 재인증은 지원하지 않습니다.",
    unknown: "계정의 비밀번호 설정 상태를 확인하지 못했습니다. 다시 로그인한 후 시도해 주세요.",
    expired: "다시 로그인한 후 회원 탈퇴를 진행해 주세요.",
    required: "현재 비밀번호를 입력해 주세요.", long: "현재 비밀번호는 128자 이하로 입력해 주세요.",
    invalid: "비밀번호가 올바르지 않거나 로그인이 만료됐습니다. 다시 확인해 주세요.",
    limited: "요청이 너무 많습니다. 잠시 후 비밀번호를 다시 입력해 주세요.",
    failed: "탈퇴 완료를 확인하지 못했습니다. 계정 상태를 확인한 뒤 비밀번호를 다시 입력해 주세요.",
    success: "회원 탈퇴가 완료되었습니다."
  },
  en: {
    title: "Close account", password: "Current password", cancel: "Cancel", close: "Close", busy: "Closing account",
    confirm: "Close your account?\nYour remaining {balance}L will be lost when you close it.",
    warning: "Request account closure by confirming your current Lumina Stage password.",
    unsupported: "Social-only accounts and accounts without a password cannot be closed here. Social reauthentication is not supported.",
    unknown: "Could not confirm your password setup. Sign in again and retry.",
    expired: "Sign in again before closing your account.",
    required: "Enter your current password.", long: "Your current password must be at most 128 characters.",
    invalid: "The password is incorrect or your sign-in has expired. Please check again.",
    limited: "Too many requests. Wait before entering your password again.",
    failed: "Could not confirm account closure. Check your account status before entering your password again.",
    success: "Your account has been closed."
  },
  ja: {
    title: "退会", password: "現在のパスワード", cancel: "キャンセル", close: "閉じる", busy: "退会処理中",
    confirm: "退会しますか？\n保有する{balance}Lは退会時に失効します。",
    warning: "退会を申請します。現在のLumina Stageパスワードを確認してください。",
    unsupported: "ソーシャル専用またはパスワードのないアカウントはここでは退会できません。ソーシャル再認証には対応していません。",
    unknown: "パスワードの設定状態を確認できませんでした。再ログインしてお試しください。",
    expired: "再ログインしてから退会してください。",
    required: "現在のパスワードを入力してください。", long: "現在のパスワードは128文字以内で入力してください。",
    invalid: "パスワードが正しくないか、ログインの有効期限が切れています。再確認してください。",
    limited: "リクエストが多すぎます。しばらく待ってからパスワードを再入力してください。",
    failed: "退会完了を確認できませんでした。アカウントの状態を確認してからパスワードを再入力してください。",
    success: "退会が完了しました。"
  },
  "zh-Hans": {
    title: "注销账号", password: "当前密码", cancel: "取消", close: "关闭", busy: "正在注销",
    confirm: "确认注销账号？\n注销后剩余的{balance}L将失效。",
    warning: "申请注销账号。请确认当前的Lumina Stage密码。",
    unsupported: "仅使用社交登录或未设置密码的账号无法在此注销。暂不支持社交重新认证。",
    unknown: "无法确认密码设置状态。请重新登录后重试。",
    expired: "请重新登录后注销账号。",
    required: "请输入当前密码。", long: "当前密码不得超过128个字符。",
    invalid: "密码不正确或登录已过期。请再次确认。",
    limited: "请求过多。请稍后重新输入密码。",
    failed: "无法确认注销是否完成。请确认账号状态后重新输入密码。",
    success: "账号已注销。"
  },
  "zh-Hant": {
    title: "註銷帳號", password: "目前密碼", cancel: "取消", close: "關閉", busy: "正在註銷",
    confirm: "確定註銷帳號？\n註銷後剩餘的{balance}L將失效。",
    warning: "申請註銷帳號。請確認目前的Lumina Stage密碼。",
    unsupported: "僅使用社群登入或未設定密碼的帳號無法在此註銷。暫不支援社群重新驗證。",
    unknown: "無法確認密碼設定狀態。請重新登入後再試。",
    expired: "請重新登入後註銷帳號。",
    required: "請輸入目前密碼。", long: "目前密碼不得超過128個字元。",
    invalid: "密碼不正確或登入已過期。請再次確認。",
    limited: "請求過多。請稍後重新輸入密碼。",
    failed: "無法確認註銷是否完成。請確認帳號狀態後重新輸入密碼。",
    success: "帳號已註銷。"
  }
};

export function bindMypageAccountClose({ button, getAuth, sessionKey, sessionCurrent, request, logout, getBalance }) {
  const dialog = document.createElement("div");
  dialog.className = "mypage-dialog";
  dialog.id = "mypageAccountCloseDialog";
  dialog.hidden = true;
  dialog.innerHTML = `
    <div class="mypage-dialog-card" id="mypageAccountCloseCard" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="mypageAccountCloseTitle" aria-describedby="mypageAccountCloseWarning">
      <div class="mypage-dialog-head">
        <h2 id="mypageAccountCloseTitle"></h2>
        <button type="button" class="mypage-dialog-close" data-account-close-dismiss>&times;</button>
      </div>
      <p id="mypageAccountCloseWarning"></p>
      <form id="mypageAccountCloseForm" novalidate>
        <div class="mypage-field-grid">
          <label class="mypage-field">
            <span id="mypageAccountClosePasswordLabel"></span>
            <input id="mypageAccountClosePassword" type="password" autocomplete="current-password" required maxlength="128" aria-describedby="mypageAccountCloseMessage" />
          </label>
        </div>
        <p class="mypage-dialog-message" id="mypageAccountCloseMessage" role="status" aria-live="polite" hidden></p>
        <div class="mypage-action-row">
          <button class="button-primary" type="submit" id="mypageAccountCloseSubmit"></button>
          <button class="button-secondary" type="button" data-account-close-dismiss></button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(dialog);
  const find = id => dialog.querySelector("#" + id);
  const form = find("mypageAccountCloseForm");
  const password = find("mypageAccountClosePassword");
  const submit = find("mypageAccountCloseSubmit");
  const message = find("mypageAccountCloseMessage");
  const dismiss = Array.from(dialog.querySelectorAll("[data-account-close-dismiss]"));
  // Dialog invalidation must not release an account's outstanding DELETE.
  const inFlightUsers = new Set();
  let session = null;
  let userId = null;
  let generation = 0;
  let pending = false;
  let messageKey = null;
  let previousOverflow = "";

  function text(key) {
    const locale = window.luminaI18n?.getLocale?.() || "ko";
    return (copy[locale] || copy.ko)[key];
  }

  function render() {
    button.textContent = text("title");
    find("mypageAccountCloseTitle").textContent = text("title");
    find("mypageAccountCloseWarning").textContent = text("warning");
    find("mypageAccountClosePasswordLabel").textContent = text("password");
    submit.textContent = text(pending ? "busy" : "title");
    dismiss[0].setAttribute("aria-label", text("close"));
    dismiss[0].title = text("close");
    dismiss[1].textContent = text("cancel");
    message.hidden = !messageKey;
    message.textContent = messageKey ? text(messageKey) : "";
  }

  function eligible(auth) {
    const user = auth?.user;
    if (!auth?.accessToken || !user?.id) return "expired";
    if (user.isSocialOnly === true || user.hasPassword === false) return "unsupported";
    const providers = user.providers || [user.provider];
    if (user.hasPassword !== true || !Array.isArray(providers) || !providers.includes("email")) return "unknown";
    return null;
  }

  function current() {
    return session !== null && sessionCurrent(session) && getAuth()?.user?.id === userId;
  }

  function syncAccountButton() {
    button.disabled = pending || inFlightUsers.has(getAuth()?.user?.id);
  }

  function setPending(value) {
    pending = value;
    password.disabled = value;
    submit.disabled = value;
    dismiss.forEach(item => { item.disabled = value; });
    syncAccountButton();
    form.setAttribute("aria-busy", String(value));
    render();
    if (value) find("mypageAccountCloseCard").focus();
  }

  function close(restoreFocus = true) {
    generation += 1;
    password.value = "";
    session = null;
    userId = null;
    messageKey = null;
    const wasOpen = !dialog.hidden;
    dialog.hidden = true;
    setPending(false);
    if (wasOpen) document.body.style.overflow = previousOverflow;
    if (wasOpen && restoreFocus) button.focus();
  }

  function showMessage(key) {
    password.value = "";
    messageKey = key;
    render();
    password.focus();
  }

  function open() {
    if (pending || !dialog.hidden) return;
    const auth = getAuth();
    if (inFlightUsers.has(auth?.user?.id)) return;
    const blocked = eligible(auth);
    if (blocked) return window.alert(text(blocked));
    const openingSession = sessionKey(auth);
    if (!window.confirm(text("confirm").replace("{balance}", getBalance()))) return;
    if (!sessionCurrent(openingSession) || eligible(getAuth())) return;
    session = openingSession;
    userId = auth.user.id;
    generation += 1;
    password.value = "";
    messageKey = null;
    render();
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.hidden = false;
    password.focus();
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (pending || dialog.hidden) return;
    if (!current()) return close(false);
    if (inFlightUsers.has(userId)) return close(false);
    const blocked = eligible(getAuth());
    if (blocked) {
      close();
      window.alert(text(blocked));
      return;
    }
    if (!password.value) return showMessage("required");
    if (password.value.length > 128) return showMessage("long");
    const attempt = generation;
    const submittedUserId = userId;
    const body = { currentPassword: password.value };
    password.value = "";
    messageKey = null;
    inFlightUsers.add(submittedUserId);
    setPending(true);
    try {
      // apiFetch owns token refresh; credentials are never written to storage or logs.
      const result = await request("/api/v1/me", { method: "DELETE", auth: true, throwOnError: true, body });
      body.currentPassword = "";
      if (attempt !== generation) return;
      if (!current()) return close(false);
      if (result?.ok !== true || result?.user?.id !== submittedUserId || result?.user?.status !== "deleted") {
        messageKey = "failed";
        return;
      }
      window.alert(text("success"));
      if (attempt !== generation || !current()) return;
      await logout();
      // authLogout clears its own session and emits authchange; never act on a new login.
      if (attempt !== generation) return;
      close();
    } catch (error) {
      if (attempt !== generation) return;
      if (!current()) return close(false);
      messageKey = error?.status === 401 || error?.status === 403 ? "invalid" : error?.status === 429 ? "limited" : "failed";
    } finally {
      body.currentPassword = "";
      inFlightUsers.delete(submittedUserId);
      if (attempt === generation) {
        password.value = "";
        setPending(false);
        if (!dialog.hidden) password.focus();
      }
      syncAccountButton();
    }
  }

  button.addEventListener("click", open);
  form.addEventListener("submit", onSubmit);
  dismiss.forEach(item => item.addEventListener("click", () => { if (!pending) close(); }));
  dialog.addEventListener("click", event => { if (event.target === dialog && !pending) close(); });
  dialog.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!pending) close();
    }
    if (event.key !== "Tab") return;
    const focusable = [dismiss[0], password, submit, dismiss[1]].filter(item => !item.disabled);
    if (!focusable.length) return event.preventDefault();
    const target = event.shiftKey ? focusable[focusable.length - 1] : focusable[0];
    const edge = event.shiftKey ? focusable[0] : focusable[focusable.length - 1];
    if (document.activeElement === edge || !focusable.includes(document.activeElement)) {
      event.preventDefault();
      target.focus();
    }
  });
  window.addEventListener("lumina:authchange", () => {
    if (session !== null && !current()) close(false);
    syncAccountButton();
  });
  window.addEventListener("storage", event => { if (event.key === "lumina_auth" || event.key === null) close(false); });
  window.addEventListener("pagehide", () => close(false));
  window.addEventListener("lumina:localechange", render);
  render();
}
