(function (global) {
  "use strict";

  const TEXT = {
    ko: {
      nav: "계약 설정", title: "내 콘텐츠 권리 계약", intro: "로그인 계정이 당사자인 계약 설정만 표시합니다.", refresh: "새로고침",
      ready: "계약 설정을 불러올 준비가 되었습니다.", loading: "계약 설정을 불러오는 중입니다.", empty: "표시할 계약 설정이 없습니다.", error: "계약 설정을 불러오지 못했습니다.", forbidden: "이 계약을 볼 권한이 없습니다.",
      contract: "계약", revision: "버전", draft: "설정 초안", approved_configuration: "설정 승인됨", author: "작가", rights_holder: "OTT 권리자", sales_agency: "영업/에이전시", ownShare: "내 배분율",
      contentVersion: "콘텐츠 버전", exclusivity: "독점 범위", exclusive: "독점", nonexclusive: "비독점", media: "허용 미디어", regions: "지역", period: "계약 기간", effective: "설정 적용 기준", rights: "허용 권리", yes: "허용", no: "허용 안 함",
      sale: "판매", ai: "AI 변환", reuse: "생성 결과 재사용", policies: "미결정 정책", unresolved: "정책 확정 전", pendingTitle: "정산 대기", pendingBody: "사용량, 취소, 정산 기준, 세전 예상액, 원천징수 및 지급 후 금액은 현재 API에서 제공하지 않습니다.",
      legacyTitle: "기존 미리보기 분리", legacyBody: "비용 차감 후 80% 미리보기는 이 콘텐츠 권리 계약 또는 유효 정산 스냅샷이 아닙니다.",
      adminTitle: "콘텐츠 권리 계약 설정", adminBoundary: "설정 승인은 법적 활성화, 정산 발생 또는 지급 승인이 아닙니다.", newDraft: "새 설정 초안", reviseDraft: "설정 버전 개정", save: "설정 초안 저장", saveRevision: "새 설정 버전 저장", history: "설정 버전 및 이력", saved: "설정 버전을 저장했습니다.", invalid: "필수 항목과 배분 조건을 확인해 주세요.", prepareRevision: "개정 준비", companyShare: "회사 내부 잔여", internalCost: "AI/영상 생성 내부 비용", internalCostValue: "회사 내부 비용, 창작자 몫 미차감", allShares: "전체 배분", policyBoundary: "VAT, 유료/보너스 포인트, 환불 역산, 포인트 사용 정책은 정책 확정 전입니다. 지급액은 생성하지 않습니다.",
      workType: "작품 유형", workId: "작품 ID", creatorRole: "권리자 역할", creatorUserId: "권리자 사용자 ID", creatorBps: "권리자 비율 (bps)", agencyIdentifier: "영업/에이전시 식별자 (선택)", agencyUserId: "영업/에이전시 사용자 ID (선택)", agencyBps: "영업/에이전시 비율 (bps)", startsAt: "시작 시각", endsAt: "종료 시각 (선택)", effectiveFrom: "설정 적용 기준 시각"
    },
    en: {
      nav: "Contract settings", title: "My content-rights contracts", intro: "Only configurations where this account is a party are shown.", refresh: "Refresh",
      ready: "Ready to load contract settings.", loading: "Loading contract settings.", empty: "No contract settings are available.", error: "Contract settings could not be loaded.", forbidden: "You do not have access to this contract.",
      contract: "Contract", revision: "Version", draft: "Configuration draft", approved_configuration: "Configuration approved", author: "Author", rights_holder: "OTT rights holder", sales_agency: "Sales/agency", ownShare: "My share",
      contentVersion: "Content version", exclusivity: "Exclusivity", exclusive: "Exclusive", nonexclusive: "Non-exclusive", media: "Permitted media", regions: "Regions", period: "Contract period", effective: "Configuration effective from", rights: "Permitted rights", yes: "Allowed", no: "Not allowed",
      sale: "Sale", ai: "AI transformation", reuse: "Generated-result reuse", policies: "Unresolved policies", unresolved: "Policy pending", pendingTitle: "Settlement pending", pendingBody: "Usage, cancellations, settlement basis, estimated pre-tax, withholding, and after-withholding amounts are not provided by the current API.",
      legacyTitle: "Legacy preview kept separate", legacyBody: "The fixed after-cost 80% preview is not this content-rights contract or an effective settlement snapshot.",
      adminTitle: "Content-rights contract configuration", adminBoundary: "Configuration approval is not legal activation, settlement accrual, or payout approval.", newDraft: "New configuration draft", reviseDraft: "Revise configuration version", save: "Save configuration draft", saveRevision: "Save new configuration version", history: "Configuration versions and history", saved: "Configuration version saved.", invalid: "Check the required fields and allocation rules.", prepareRevision: "Prepare revision", companyShare: "Company internal remainder", internalCost: "AI/video internal cost", internalCostValue: "Company internal cost; not deducted from creator share", allShares: "Full allocation", policyBoundary: "VAT, paid/bonus points, refund reversal, and point-use policies are pending. No payout amount is generated.",
      workType: "Work type", workId: "Work ID", creatorRole: "Rights-holder role", creatorUserId: "Rights-holder user ID", creatorBps: "Rights-holder share (bps)", agencyIdentifier: "Sales/agency identifier (optional)", agencyUserId: "Sales/agency user ID (optional)", agencyBps: "Sales/agency share (bps)", startsAt: "Starts at", endsAt: "Ends at (optional)", effectiveFrom: "Configuration effective from"
    },
    ja: {
      nav: "契約設定", title: "自分のコンテンツ権利契約", intro: "このアカウントが当事者の契約設定のみ表示します。", refresh: "更新",
      ready: "契約設定を読み込む準備ができました。", loading: "契約設定を読み込み中です。", empty: "表示できる契約設定はありません。", error: "契約設定を読み込めませんでした。", forbidden: "この契約を表示する権限がありません。",
      contract: "契約", revision: "バージョン", draft: "設定下書き", approved_configuration: "設定承認済み", author: "作家", rights_holder: "OTT権利者", sales_agency: "営業・代理店", ownShare: "自分の配分率",
      contentVersion: "コンテンツ版", exclusivity: "独占範囲", exclusive: "独占", nonexclusive: "非独占", media: "許可メディア", regions: "地域", period: "契約期間", effective: "設定適用基準", rights: "許可権利", yes: "許可", no: "不許可",
      sale: "販売", ai: "AI変換", reuse: "生成結果の再利用", policies: "未確定ポリシー", unresolved: "ポリシー確定前", pendingTitle: "精算待ち", pendingBody: "利用量、取消、精算基準、税引前見込、源泉徴収、控除後金額は現在のAPIでは提供されません。",
      legacyTitle: "従来プレビューを分離", legacyBody: "費用控除後80%のプレビューは、この権利契約または有効な精算スナップショットではありません。",
      adminTitle: "コンテンツ権利契約設定", adminBoundary: "設定承認は法的有効化、精算発生、支払承認ではありません。", newDraft: "新規設定下書き", reviseDraft: "設定バージョン改訂", save: "設定下書きを保存", saveRevision: "新しい設定版を保存", history: "設定バージョンと履歴", saved: "設定バージョンを保存しました。", invalid: "必須項目と配分条件を確認してください。", prepareRevision: "改訂を準備", companyShare: "会社内部残余", internalCost: "AI・動画内部費用", internalCostValue: "会社内部費用、創作者配分から控除しない", allShares: "全配分", policyBoundary: "VAT、有料・ボーナスポイント、返金、ポイント利用方針は未確定です。支払額は生成しません。",
      workType: "作品種別", workId: "作品ID", creatorRole: "権利者役割", creatorUserId: "権利者ユーザーID", creatorBps: "権利者比率 (bps)", agencyIdentifier: "営業・代理店識別子（任意）", agencyUserId: "営業・代理店ユーザーID（任意）", agencyBps: "営業・代理店比率 (bps)", startsAt: "開始日時", endsAt: "終了日時（任意）", effectiveFrom: "設定適用基準日時"
    },
    "zh-Hans": {
      nav: "合同设置", title: "我的内容权利合同", intro: "仅显示当前账号作为当事方的合同设置。", refresh: "刷新",
      ready: "已准备加载合同设置。", loading: "正在加载合同设置。", empty: "没有可显示的合同设置。", error: "无法加载合同设置。", forbidden: "你无权查看此合同。",
      contract: "合同", revision: "版本", draft: "设置草案", approved_configuration: "设置已批准", author: "作者", rights_holder: "OTT权利人", sales_agency: "销售/代理", ownShare: "我的分配比例",
      contentVersion: "内容版本", exclusivity: "独家范围", exclusive: "独家", nonexclusive: "非独家", media: "允许媒体", regions: "地区", period: "合同期限", effective: "设置生效基准", rights: "允许权利", yes: "允许", no: "不允许",
      sale: "销售", ai: "AI转换", reuse: "生成结果复用", policies: "未确定政策", unresolved: "政策确定前", pendingTitle: "等待结算", pendingBody: "当前API不提供使用量、取消、结算依据、税前预估、预扣税及扣税后金额。",
      legacyTitle: "旧版预览已隔离", legacyBody: "扣除成本后80%的预览不是本内容权利合同，也不是有效结算快照。",
      adminTitle: "内容权利合同设置", adminBoundary: "设置批准不代表法律生效、结算计提或付款批准。", newDraft: "新设置草案", reviseDraft: "修订设置版本", save: "保存设置草案", saveRevision: "保存新设置版本", history: "设置版本与历史", saved: "设置版本已保存。", invalid: "请检查必填项和分配规则。", prepareRevision: "准备修订", companyShare: "公司内部剩余", internalCost: "AI/视频内部成本", internalCostValue: "公司内部成本，不从创作者份额扣除", allShares: "完整分配", policyBoundary: "VAT、付费/奖励积分、退款冲回和积分使用政策尚未确定。不生成付款金额。",
      workType: "作品类型", workId: "作品ID", creatorRole: "权利人角色", creatorUserId: "权利人用户ID", creatorBps: "权利人比例 (bps)", agencyIdentifier: "销售/代理标识（可选）", agencyUserId: "销售/代理用户ID（可选）", agencyBps: "销售/代理比例 (bps)", startsAt: "开始时间", endsAt: "结束时间（可选）", effectiveFrom: "设置生效基准时间"
    },
    "zh-Hant": {
      nav: "合約設定", title: "我的內容權利合約", intro: "僅顯示目前帳號作為當事方的合約設定。", refresh: "重新整理",
      ready: "已準備載入合約設定。", loading: "正在載入合約設定。", empty: "沒有可顯示的合約設定。", error: "無法載入合約設定。", forbidden: "你無權檢視此合約。",
      contract: "合約", revision: "版本", draft: "設定草稿", approved_configuration: "設定已核准", author: "作者", rights_holder: "OTT權利人", sales_agency: "銷售/代理", ownShare: "我的分配比例",
      contentVersion: "內容版本", exclusivity: "獨家範圍", exclusive: "獨家", nonexclusive: "非獨家", media: "允許媒體", regions: "地區", period: "合約期間", effective: "設定生效基準", rights: "允許權利", yes: "允許", no: "不允許",
      sale: "銷售", ai: "AI轉換", reuse: "生成結果重用", policies: "未確定政策", unresolved: "政策確定前", pendingTitle: "等待結算", pendingBody: "目前API不提供使用量、取消、結算依據、稅前預估、預扣稅及扣稅後金額。",
      legacyTitle: "舊版預覽已隔離", legacyBody: "扣除成本後80%的預覽不是本內容權利合約，也不是有效結算快照。",
      adminTitle: "內容權利合約設定", adminBoundary: "設定核准不代表法律生效、結算計提或付款核准。", newDraft: "新設定草稿", reviseDraft: "修訂設定版本", save: "儲存設定草稿", saveRevision: "儲存新設定版本", history: "設定版本與歷史", saved: "設定版本已儲存。", invalid: "請檢查必填項和分配規則。", prepareRevision: "準備修訂", companyShare: "公司內部剩餘", internalCost: "AI/影片內部成本", internalCostValue: "公司內部成本，不從創作者份額扣除", allShares: "完整分配", policyBoundary: "VAT、付費/獎勵點數、退款沖回及點數使用政策尚未確定。不產生付款金額。",
      workType: "作品類型", workId: "作品ID", creatorRole: "權利人角色", creatorUserId: "權利人使用者ID", creatorBps: "權利人比例 (bps)", agencyIdentifier: "銷售/代理識別碼（選填）", agencyUserId: "銷售/代理使用者ID（選填）", agencyBps: "銷售/代理比例 (bps)", startsAt: "開始時間", endsAt: "結束時間（選填）", effectiveFrom: "設定生效基準時間"
    }
  };

  function locale() {
    const candidate = global.luminaI18n?.getLocale?.() || (() => { try { return localStorage.getItem("lumina_locale"); } catch (_) { return "ko"; } })();
    if (/^en/i.test(candidate)) return "en";
    if (/^ja/i.test(candidate)) return "ja";
    if (/zh-(?:Hant|TW|HK|MO)/i.test(candidate)) return "zh-Hant";
    if (/^zh/i.test(candidate)) return "zh-Hans";
    return "ko";
  }

  function t(key) { return TEXT[locale()]?.[key] || TEXT.en[key] || TEXT.ko[key] || key; }
  function esc(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;"); }
  function percent(bps) { return `${(Number(bps || 0) / 100).toLocaleString(locale(), { maximumFractionDigits: 2 })}%`; }
  function date(value) { if (!value) return "-"; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? "-" : new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short" }).format(parsed); }

  function partyView(contract, userId) {
    if (!contract || !userId) return null;
    const versions = (contract.versions || []).flatMap((version) => {
      const ownParty = (version.parties || []).find((party) => party.userId === userId);
      if (!ownParty) return [];
      const ownBps = ownParty.role === "sales_agency" ? version.shares?.salesAgencyBps : version.shares?.authorRightsHolderBps;
      return [{
        id: version.id, revision: version.revision, role: ownParty.role, agencyIdentifier: ownParty.role === "sales_agency" ? ownParty.agencyIdentifier : null,
        ownBps, contentVersionId: version.contentVersionId, exclusivity: version.exclusivity, media: [...(version.media || [])], regions: [...(version.regions || [])],
        startsAt: version.startsAt, endsAt: version.endsAt, effectiveFrom: version.effectiveFrom, approvalState: version.approvalState,
        saleAllowed: version.saleAllowed === true, aiTransformationAllowed: version.aiTransformationAllowed === true, generatedResultReuseAllowed: version.generatedResultReuseAllowed === true,
        policies: { pointUsage: version.policy?.pointUsage, refundReversal: version.policy?.refundReversal, paidPoints: version.policy?.paidPoints, bonusPoints: version.policy?.bonusPoints, vat: version.policy?.vat }
      }];
    });
    if (!versions.length) return null;
    return { id: contract.id, workType: contract.workType, workId: contract.workId, versions };
  }

  function toIso(value) { return value ? new Date(value).toISOString() : null; }
  function configuration(values) {
    const agencyBps = Number(values.salesAgencyShareBps || 0);
    const creatorBps = Number(values.authorRightsHolderShareBps);
    const media = Array.isArray(values.media) ? values.media : [];
    const regions = String(values.regions || "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
    if (!values.workId || !values.contentVersionId || !values.creatorUserId || !values.startsAt || !values.effectiveFrom || !media.length || !regions.length || !Number.isInteger(creatorBps) || !Number.isInteger(agencyBps)) throw new Error("invalid");
    if (creatorBps < 0 || creatorBps > 5000 || agencyBps < 0 || agencyBps > 1000 || creatorBps + agencyBps > 5500) throw new Error("invalid");
    if ((agencyBps > 0) !== Boolean(values.agencyIdentifier && values.agencyUserId)) throw new Error("invalid");
    const parties = [{ role: values.creatorRole, userId: values.creatorUserId, agencyIdentifier: null }];
    if (agencyBps > 0) parties.push({ role: "sales_agency", userId: values.agencyUserId, agencyIdentifier: values.agencyIdentifier });
    return {
      contentVersionId: values.contentVersionId, exclusivity: values.exclusivity, media, regions,
      startsAt: toIso(values.startsAt), endsAt: values.endsAt ? toIso(values.endsAt) : null, effectiveFrom: toIso(values.effectiveFrom),
      saleAllowed: Boolean(values.saleAllowed), aiTransformationAllowed: Boolean(values.aiTransformationAllowed), generatedResultReuseAllowed: Boolean(values.generatedResultReuseAllowed),
      authorRightsHolderShareBps: creatorBps, salesAgencyShareBps: agencyBps,
      pointUsagePolicy: "unresolved", refundReversalPolicy: "unresolved", paidPointPolicy: "unresolved", bonusPointPolicy: "unresolved", vatPolicy: "unresolved",
      internalGenerationCostTreatment: "company_internal_cost_not_deducted_from_creator_share", parties
    };
  }

  global.LuminaContentRightsUI = { t, esc, percent, date, locale, partyView, configuration };
})(window);
