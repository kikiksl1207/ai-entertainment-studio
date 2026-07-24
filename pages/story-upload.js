(function initStoryUploadPage() {
  "use strict";

  const root = document.getElementById("storyUploadRoot");
  if (!root) return;

  const API_ORIGIN = "https://api.lumina-stage.com";
  const MAX_TOTAL_BYTES = 150 * 1024 * 1024;
  const LOCALES = ["ko", "en", "ja", "zh-Hans", "zh-Hant"];
  const COPY = {
    ko: {
      eyebrow: "작가 스튜디오",
      title: "최종 원고 업로드",
      description: "완성된 작품 원고와 공개에 필요한 자료를 제출합니다.",
      workInfo: "작품 정보",
      workTitle: "작품명",
      workTitlePlaceholder: "작품명을 입력해 주세요",
      originalLocale: "원문 언어",
      rightsType: "작품 권리",
      rightsOriginal: "작가 창작물",
      rightsPublic: "퍼블릭 도메인",
      rightsLicensed: "정식 계약 IP",
      rightsReference: "권리 확인 자료",
      rightsReferencePlaceholder: "권리 확인 자료의 이름을 입력해 주세요",
      manuscript: "최종 원고",
      manuscriptAccept: "MD, TXT, DOCX, PDF, JSON",
      metadata: "분기·엔딩 자료",
      metadataAccept: "JSON 또는 CSV",
      visuals: "표지·배경·캐릭터 자료",
      visualsAccept: "JPG, PNG, WEBP",
      choose: "파일 선택",
      noFiles: "선택된 파일 없음",
      remove: "제거",
      finalConfirm: "업로드할 파일이 최종본임을 확인했습니다.",
      submit: "최종본 제출",
      submitting: "제출 중입니다.",
      loginRequired: "로그인 후 제출할 수 있습니다.",
      requiredTitle: "작품명을 입력해 주세요.",
      requiredManuscript: "최종 원고 파일을 선택해 주세요.",
      requiredRights: "정식 계약 IP는 권리 확인 자료가 필요합니다.",
      requiredConfirm: "최종본 확인에 체크해 주세요.",
      tooLarge: "전체 파일 용량은 150MB 이하여야 합니다.",
      submitFailed: "제출하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      serviceUnavailable: "현재 최종 원고를 제출할 수 없습니다. 잠시 후 다시 시도해 주세요.",
      submitted: "최종 원고가 접수되었습니다.",
      submittedBody: "검수 상태는 작가 스튜디오에서 확인할 수 있습니다.",
      uploadAnother: "다른 작품 제출",
    },
    en: {
      eyebrow: "Writer studio",
      title: "Upload final manuscript",
      description: "Submit a completed manuscript and its publication materials.",
      workInfo: "Work details",
      workTitle: "Title",
      workTitlePlaceholder: "Enter the work title",
      originalLocale: "Original language",
      rightsType: "Rights",
      rightsOriginal: "Original work",
      rightsPublic: "Public domain",
      rightsLicensed: "Licensed IP",
      rightsReference: "Rights reference",
      rightsReferencePlaceholder: "Enter the name of the rights confirmation material",
      manuscript: "Final manuscript",
      manuscriptAccept: "MD, TXT, DOCX, PDF, JSON",
      metadata: "Branches and endings",
      metadataAccept: "JSON or CSV",
      visuals: "Cover, backgrounds, characters",
      visualsAccept: "JPG, PNG, WEBP",
      choose: "Choose files",
      noFiles: "No files selected",
      remove: "Remove",
      finalConfirm: "I confirm these files are the final version.",
      submit: "Submit final version",
      submitting: "Submitting.",
      loginRequired: "Log in to submit.",
      requiredTitle: "Enter the work title.",
      requiredManuscript: "Choose at least one final manuscript file.",
      requiredRights: "Licensed IP requires a rights reference.",
      requiredConfirm: "Confirm that this is the final version.",
      tooLarge: "The total file size must be 150MB or less.",
      submitFailed: "Submission failed. Please try again shortly.",
      serviceUnavailable: "The final manuscript cannot be submitted right now. Please try again shortly.",
      submitted: "The final manuscript was submitted.",
      submittedBody: "Check its review status in Writer Studio.",
      uploadAnother: "Submit another work",
    },
    ja: {
      eyebrow: "作家スタジオ",
      title: "最終原稿アップロード",
      description: "完成した作品原稿と公開に必要な資料を提出します。",
      workInfo: "作品情報",
      workTitle: "作品名",
      workTitlePlaceholder: "作品名を入力してください",
      originalLocale: "原文言語",
      rightsType: "作品の権利",
      rightsOriginal: "作家オリジナル",
      rightsPublic: "パブリックドメイン",
      rightsLicensed: "正式契約IP",
      rightsReference: "権利確認資料",
      rightsReferencePlaceholder: "権利確認資料の名前を入力してください",
      manuscript: "最終原稿",
      manuscriptAccept: "MD, TXT, DOCX, PDF, JSON",
      metadata: "分岐・エンディング資料",
      metadataAccept: "JSONまたはCSV",
      visuals: "表紙・背景・キャラクター資料",
      visualsAccept: "JPG, PNG, WEBP",
      choose: "ファイル選択",
      noFiles: "ファイル未選択",
      remove: "削除",
      finalConfirm: "アップロードするファイルが最終版であることを確認しました。",
      submit: "最終版を提出",
      submitting: "提出しています。",
      loginRequired: "ログイン後に提出できます。",
      requiredTitle: "作品名を入力してください。",
      requiredManuscript: "最終原稿ファイルを選択してください。",
      requiredRights: "正式契約IPには権利確認資料が必要です。",
      requiredConfirm: "最終版の確認にチェックしてください。",
      tooLarge: "ファイル合計は150MB以下にしてください。",
      submitFailed: "提出できませんでした。しばらくしてからお試しください。",
      serviceUnavailable: "現在、最終原稿を提出できません。しばらくしてからお試しください。",
      submitted: "最終原稿を受け付けました。",
      submittedBody: "検収状況は作家スタジオで確認できます。",
      uploadAnother: "別の作品を提出",
    },
    "zh-Hans": {
      eyebrow: "作家工作室",
      title: "上传最终稿",
      description: "提交已完成的作品原稿及发布所需资料。",
      workInfo: "作品信息",
      workTitle: "作品名",
      workTitlePlaceholder: "请输入作品名",
      originalLocale: "原文语言",
      rightsType: "作品权利",
      rightsOriginal: "原创作品",
      rightsPublic: "公有领域",
      rightsLicensed: "正式授权IP",
      rightsReference: "权利证明资料",
      rightsReferencePlaceholder: "请输入权利证明资料的名称",
      manuscript: "最终原稿",
      manuscriptAccept: "MD, TXT, DOCX, PDF, JSON",
      metadata: "分支与结局资料",
      metadataAccept: "JSON或CSV",
      visuals: "封面、背景、角色资料",
      visualsAccept: "JPG, PNG, WEBP",
      choose: "选择文件",
      noFiles: "未选择文件",
      remove: "移除",
      finalConfirm: "我确认上传文件为最终版本。",
      submit: "提交最终版本",
      submitting: "正在提交。",
      loginRequired: "登录后即可提交。",
      requiredTitle: "请输入作品名。",
      requiredManuscript: "请选择最终原稿文件。",
      requiredRights: "正式授权IP需要权利证明资料。",
      requiredConfirm: "请确认这是最终版本。",
      tooLarge: "文件总大小不得超过150MB。",
      submitFailed: "提交失败，请稍后重试。",
      serviceUnavailable: "暂时无法提交最终原稿，请稍后重试。",
      submitted: "最终原稿已提交。",
      submittedBody: "可在作家工作室查看审核状态。",
      uploadAnother: "提交其他作品",
    },
    "zh-Hant": {
      eyebrow: "作家工作室",
      title: "上傳最終稿",
      description: "提交已完成的作品原稿及發布所需資料。",
      workInfo: "作品資訊",
      workTitle: "作品名",
      workTitlePlaceholder: "請輸入作品名",
      originalLocale: "原文語言",
      rightsType: "作品權利",
      rightsOriginal: "原創作品",
      rightsPublic: "公有領域",
      rightsLicensed: "正式授權IP",
      rightsReference: "權利證明資料",
      rightsReferencePlaceholder: "請輸入權利證明資料的名稱",
      manuscript: "最終原稿",
      manuscriptAccept: "MD, TXT, DOCX, PDF, JSON",
      metadata: "分支與結局資料",
      metadataAccept: "JSON或CSV",
      visuals: "封面、背景、角色資料",
      visualsAccept: "JPG, PNG, WEBP",
      choose: "選擇檔案",
      noFiles: "未選擇檔案",
      remove: "移除",
      finalConfirm: "我確認上傳檔案為最終版本。",
      submit: "提交最終版本",
      submitting: "正在提交。",
      loginRequired: "登入後即可提交。",
      requiredTitle: "請輸入作品名。",
      requiredManuscript: "請選擇最終原稿檔案。",
      requiredRights: "正式授權IP需要權利證明資料。",
      requiredConfirm: "請確認這是最終版本。",
      tooLarge: "檔案總大小不得超過150MB。",
      submitFailed: "提交失敗，請稍後重試。",
      serviceUnavailable: "暫時無法提交最終原稿，請稍後再試。",
      submitted: "最終原稿已提交。",
      submittedBody: "可在作家工作室查看審核狀態。",
      uploadAnother: "提交其他作品",
    },
  };

  const state = {
    locale: resolveLocale(),
    files: { manuscripts: [], metadata: [], visuals: [] },
    busy: false,
  };

  function resolveLocale() {
    const value = window.luminaI18n?.getLocale?.() || "ko";
    if (value === "zh-CN") return "zh-Hans";
    if (value === "zh-TW" || value === "zh-HK") return "zh-Hant";
    return COPY[value] ? value : "ko";
  }

  function tr(key) {
    return COPY[state.locale]?.[key] || COPY.ko[key] || key;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function localeOptions() {
    return [
      ["ko", "한국어"],
      ["en", "English"],
      ["ja", "日本語"],
      ["zh-Hans", "简体中文"],
      ["zh-Hant", "繁體中文"],
    ].map(([value, label]) => `<option value="${value}"${value === state.locale ? " selected" : ""}>${label}</option>`).join("");
  }

  function fileField(name, label, acceptLabel, accept, multiple = true) {
    return `
      <section class="su-file-field" data-file-group="${name}">
        <div class="su-file-heading">
          <span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(acceptLabel)}</small></span>
          <label class="su-file-button">
            ${escapeHtml(tr("choose"))}
            <input type="file" name="${name}" accept="${accept}"${multiple ? " multiple" : ""} />
          </label>
        </div>
        <div class="su-file-list" data-file-list="${name}">${renderFileList(name)}</div>
      </section>`;
  }

  function renderFileList(group) {
    const files = state.files[group];
    if (!files.length) return `<p class="su-no-files">${escapeHtml(tr("noFiles"))}</p>`;
    return `<ul>${files.map((file, index) => `
      <li>
        <span><strong>${escapeHtml(file.name)}</strong><small>${escapeHtml(formatBytes(file.size))}</small></span>
        <button type="button" data-remove-file="${group}" data-file-index="${index}" aria-label="${escapeHtml(`${tr("remove")} ${file.name}`)}">×</button>
      </li>`).join("")}</ul>`;
  }

  function renderForm() {
    root.innerHTML = `
      <div class="su-shell">
        <header class="su-header">
          <div>
            <p class="su-eyebrow">${escapeHtml(tr("eyebrow"))}</p>
            <h1>${escapeHtml(tr("title"))}</h1>
            <p>${escapeHtml(tr("description"))}</p>
          </div>
          <div class="su-locale" aria-label="Language">
            ${LOCALES.map((locale) => `<button type="button" data-locale="${locale}" aria-pressed="${locale === state.locale}">${locale === "zh-Hans" ? "简" : locale === "zh-Hant" ? "繁" : locale.toUpperCase()}</button>`).join("")}
          </div>
        </header>

        <form class="su-final-form" data-final-upload-form novalidate>
          <section class="su-section">
            <h2>${escapeHtml(tr("workInfo"))}</h2>
            <div class="su-grid">
              <label class="su-field">
                <span>${escapeHtml(tr("workTitle"))}</span>
                <input name="title" maxlength="120" autocomplete="off" placeholder="${escapeHtml(tr("workTitlePlaceholder"))}" required />
              </label>
              <label class="su-field">
                <span>${escapeHtml(tr("originalLocale"))}</span>
                <select name="originalLocale">${localeOptions()}</select>
              </label>
              <label class="su-field">
                <span>${escapeHtml(tr("rightsType"))}</span>
                <select name="sourceClass" data-rights-type>
                  <option value="original">${escapeHtml(tr("rightsOriginal"))}</option>
                  <option value="public_domain">${escapeHtml(tr("rightsPublic"))}</option>
                  <option value="licensed_ip">${escapeHtml(tr("rightsLicensed"))}</option>
                </select>
              </label>
              <label class="su-field" data-rights-reference hidden>
                <span>${escapeHtml(tr("rightsReference"))}</span>
                <input name="rightsReference" maxlength="180" autocomplete="off" placeholder="${escapeHtml(tr("rightsReferencePlaceholder"))}" />
              </label>
            </div>
          </section>

          ${fileField("manuscripts", tr("manuscript"), tr("manuscriptAccept"), ".md,.txt,.docx,.pdf,.json")}
          ${fileField("metadata", tr("metadata"), tr("metadataAccept"), ".json,.csv")}
          ${fileField("visuals", tr("visuals"), tr("visualsAccept"), "image/jpeg,image/png,image/webp")}

          <label class="su-confirm">
            <input type="checkbox" name="finalConfirmed" />
            <span>${escapeHtml(tr("finalConfirm"))}</span>
          </label>

          <div class="su-submit-row">
            <p class="su-form-status" data-upload-status role="status"></p>
            <button type="submit" class="su-submit">${escapeHtml(tr("submit"))}</button>
          </div>
        </form>
      </div>`;
  }

  function refreshFileList(group) {
    const target = root.querySelector(`[data-file-list="${group}"]`);
    if (target) target.innerHTML = renderFileList(group);
  }

  function totalBytes() {
    return Object.values(state.files).flat().reduce((sum, file) => sum + file.size, 0);
  }

  function setStatus(message, kind = "") {
    const target = root.querySelector("[data-upload-status]");
    if (!target) return;
    target.textContent = message;
    target.dataset.kind = kind;
  }

  function reviewFileCount(group) {
    return String(state.files[group]?.length || 0);
  }

  function openReviewDialog(form) {
    if (root.querySelector("[data-upload-review]")) return;
    const dialog = document.createElement("div");
    dialog.className = "su-review-dialog";
    dialog.dataset.uploadReview = "";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "suReviewTitle");
    dialog.innerHTML = `
      <button type="button" class="su-review-backdrop" data-upload-review-cancel aria-label="Close"></button>
      <section class="su-review-panel">
        <div class="su-review-header">
          <div>
            <p>${escapeHtml(tr("eyebrow"))}</p>
            <h2 id="suReviewTitle">Review final submission</h2>
          </div>
          <button type="button" class="su-review-close" data-upload-review-cancel aria-label="Close">x</button>
        </div>
        <p class="su-review-description">${escapeHtml(tr("finalConfirm"))}</p>
        <dl class="su-review-summary">
          <div><dt>${escapeHtml(tr("workTitle"))}</dt><dd>${escapeHtml(form.elements.title.value.trim())}</dd></div>
          <div><dt>${escapeHtml(tr("originalLocale"))}</dt><dd>${escapeHtml(form.elements.originalLocale.value)}</dd></div>
          <div><dt>${escapeHtml(tr("rightsType"))}</dt><dd>${escapeHtml(form.elements.sourceClass.selectedOptions[0]?.textContent || "")}</dd></div>
          <div><dt>${escapeHtml(tr("manuscript"))}</dt><dd>${reviewFileCount("manuscripts")}</dd></div>
          <div><dt>${escapeHtml(tr("metadata"))}</dt><dd>${reviewFileCount("metadata")}</dd></div>
          <div><dt>${escapeHtml(tr("visuals"))}</dt><dd>${reviewFileCount("visuals")}</dd></div>
        </dl>
        <div class="su-review-actions">
          <button type="button" class="su-review-cancel" data-upload-review-cancel>Cancel</button>
          <button type="button" class="su-submit" data-upload-review-confirm>${escapeHtml(tr("submit"))}</button>
        </div>
      </section>`;
    root.appendChild(dialog);
    dialog.querySelector("[data-upload-review-confirm]")?.focus();
  }

  function closeReviewDialog() {
    root.querySelector("[data-upload-review]")?.remove();
    root.querySelector("button[type=submit]")?.focus();
  }

  function getToken() {
    if (typeof window.getAccessToken === "function") return window.getAccessToken();
    try {
      return JSON.parse(localStorage.getItem("lumina_auth") || "null")?.accessToken || "";
    } catch (_) {
      return "";
    }
  }

  function validate(form) {
    if (!form.elements.title.value.trim()) return tr("requiredTitle");
    if (!state.files.manuscripts.length) return tr("requiredManuscript");
    if (form.elements.sourceClass.value === "licensed_ip" && !form.elements.rightsReference.value.trim()) return tr("requiredRights");
    if (!form.elements.finalConfirmed.checked) return tr("requiredConfirm");
    if (totalBytes() > MAX_TOTAL_BYTES) return tr("tooLarge");
    return "";
  }

  function buildPayload(form) {
    const payload = new FormData();
    payload.append("title", form.elements.title.value.trim());
    payload.append("originalLocale", form.elements.originalLocale.value);
    payload.append("sourceClass", form.elements.sourceClass.value);
    payload.append("rightsReference", form.elements.rightsReference.value.trim());
    payload.append("submissionType", "final");
    state.files.manuscripts.forEach((file) => payload.append("manuscripts", file, file.name));
    state.files.metadata.forEach((file) => payload.append("metadata", file, file.name));
    state.files.visuals.forEach((file) => payload.append("visuals", file, file.name));
    return payload;
  }

  async function submit(form) {
    if (state.busy) return;
    const validationError = validate(form);
    if (validationError) return setStatus(validationError, "error");
    const token = getToken();
    if (!token) {
      setStatus(tr("loginRequired"), "error");
      if (typeof window.openAuthModal === "function") window.openAuthModal("login", { returnTo: { href: "/story-upload", label: tr("title") } });
      return;
    }

    state.busy = true;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    setStatus(tr("submitting"));
    try {
      const response = await fetch(`${API_ORIGIN}/api/v1/story-upload/intake`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: buildPayload(form),
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      renderSuccess();
    } catch (error) {
      setStatus(error?.status === 404 || error?.status === 501 ? tr("serviceUnavailable") : tr("submitFailed"), "error");
      button.disabled = false;
      state.busy = false;
    }
  }

  function renderSuccess() {
    root.innerHTML = `
      <section class="su-success">
        <span aria-hidden="true">✓</span>
        <h1>${escapeHtml(tr("submitted"))}</h1>
        <p>${escapeHtml(tr("submittedBody"))}</p>
        <button type="button" class="su-submit" data-upload-another>${escapeHtml(tr("uploadAnother"))}</button>
      </section>`;
  }

  root.addEventListener("change", (event) => {
    const input = event.target.closest("input[type=file]");
    if (input && state.files[input.name]) {
      state.files[input.name] = Array.from(input.files || []);
      refreshFileList(input.name);
      input.value = "";
      setStatus("");
      return;
    }
    if (event.target.matches("[data-rights-type]")) {
      const field = root.querySelector("[data-rights-reference]");
      field.hidden = event.target.value !== "licensed_ip";
      field.querySelector("input").required = event.target.value === "licensed_ip";
    }
  });

  root.addEventListener("click", async (event) => {
    if (event.target.closest("[data-upload-review-cancel]")) {
      closeReviewDialog();
      return;
    }
    if (event.target.closest("[data-upload-review-confirm]")) {
      const form = root.querySelector("[data-final-upload-form]");
      closeReviewDialog();
      if (form) submit(form);
      return;
    }
    const localeButton = event.target.closest("[data-locale]");
    if (localeButton) {
      const form = root.querySelector("[data-final-upload-form]");
      const values = form ? {
        title: form.elements.title.value,
        originalLocale: form.elements.originalLocale.value,
        sourceClass: form.elements.sourceClass.value,
        rightsReference: form.elements.rightsReference.value,
        finalConfirmed: form.elements.finalConfirmed.checked,
      } : null;
      state.locale = localeButton.dataset.locale;
      if (window.luminaI18n?.setLocale) await window.luminaI18n.setLocale(state.locale);
      renderForm();
      if (values) {
        const nextForm = root.querySelector("[data-final-upload-form]");
        Object.entries(values).forEach(([key, value]) => {
          if (nextForm.elements[key]?.type === "checkbox") nextForm.elements[key].checked = value;
          else if (nextForm.elements[key]) nextForm.elements[key].value = value;
        });
        nextForm.elements.sourceClass.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }
    const removeButton = event.target.closest("[data-remove-file]");
    if (removeButton) {
      const group = removeButton.dataset.removeFile;
      state.files[group].splice(Number(removeButton.dataset.fileIndex), 1);
      refreshFileList(group);
      setStatus("");
      return;
    }
    if (event.target.closest("[data-upload-another]")) {
      state.files = { manuscripts: [], metadata: [], visuals: [] };
      state.busy = false;
      renderForm();
    }
  });

  root.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-final-upload-form]");
    if (!form) return;
    event.preventDefault();
    const validationError = validate(form);
    if (validationError) return setStatus(validationError, "error");
    openReviewDialog(form);
  });

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && root.querySelector("[data-upload-review]")) {
      event.preventDefault();
      closeReviewDialog();
    }
  });

  renderForm();
})();
