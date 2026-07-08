(function initStoryUploadPage() {
  "use strict";

  const root = document.getElementById("storyUploadRoot");
  if (!root) return;

  const LOCALES = [
    { code: "ko", label: "KO" },
    { code: "en", label: "EN" },
    { code: "ja", label: "JA" },
    { code: "zh-Hans", label: "简" },
    { code: "zh-Hant", label: "繁" },
  ];

  const UI = {
    ko: {
      title: "작품 업로드",
      eyebrow: "스토리 업로드",
      meta: "작품 기본 정보",
      scenes: "장면 목록",
      endings: "엔딩 요약",
      form: "장면 입력",
      import: "가져오기 미리보기",
      statusTitle: "검수 상태",
      status: {
        draft: "작성 중",
        needs_revision: "수정 필요",
        pm_review: "구조 검토",
        locale_ready: "다국어 준비",
        qa_ready: "화면 확인",
        publish_ready: "발행 준비",
        blocked: "막힘",
      },
      statusHint: {
        draft: "작가가 원고와 장면 정보를 정리 중이에요.",
        needs_revision: "수정 요청을 확인하고 장면 정보를 보완해요.",
        pm_review: "저작권과 이야기 구조를 확인 중이에요.",
        locale_ready: "다국어 문구와 길이를 확인해요.",
        qa_ready: "모바일 화면과 버튼 폭을 확인해요.",
        publish_ready: "발행 전 최종 확인만 남았어요.",
        blocked: "막힌 사유를 확인해야 다음 단계로 갈 수 있어요.",
      },
      handoff: ["문구 길이 확인", "모바일 화면 확인", "공개 전 최종 점검"],
      labels: {
        storyTitle: "제목",
        genre: "장르",
        free: "무료 여부",
        minimum: "최소 분량",
        sceneId: "장면 ID",
        sceneTitle: "장면 제목",
        background: "배경",
        bgMemo: "배경 이미지 메모",
        cast: "등장 캐릭터",
        body: "본문",
        choices: "선택지",
        nextScene: "다음 장면",
        endingLink: "엔딩 연결",
        saveSoon: "저장 (준비 중)",
        addChoice: "선택지 추가",
      },
      ending: {
        authorMain: "작가 기본",
        authorSub: "작가 보조",
        ai: "AI 초안",
        subCount: "보조 엔딩",
      },
      importHead: ["장면", "분기", "엔딩", "배경", "등장", "상태"],
      importState: {
        ok: "확인됨",
        missing: "누락",
        copyright: "저작권 확인",
        pm: "검토 필요",
      },
      importFlags: [
        "배경/등장 누락 항목이 있어요.",
        "저작권 확인이 필요해요.",
        "구조 확인이 필요해요.",
      ],
      importSave: "가져오기 (준비 중)",
      sample: {
        storyTitle: "임진왜란: 난중일기 프롤로그",
        genre: "역사 튜토리얼",
        free: "무료 프롤로그",
        minimum: "장면 3개 이상",
        background: "전장 기록 사이로 낮은 북소리가 들려요.",
        bgMemo: "촛불, 종이 지도, 낮은 연기",
        body: "긴 본문 원고를 먼저 붙여 넣고, 분기점과 이어질 장면을 아래 선택지로 정리해요.",
        sceneTitle: "새 분기 장면",
        cast: "이순신, 기록관, 전령",
      },
      preview: {
        title: "작가 업로드 미리보기",
        body: "원고 분량, 분기 요약, 결말 후보를 저장 없이 확인합니다.",
        manuscriptRules: "원고 기준",
        partLengthLabel: "파트 분량",
        branchSummaryLabel: "분기 요약",
        baseFormatLabel: "기본 구성",
        partLengthValue: "약 10,000자",
        branchSummaryValue: "최대 2,000자",
        baseFormatValue: "10파트 단편극",
        endingSetup: "결말 설정",
        publicMaterials: "공개 가능한 장면 자료",
        character: "캐릭터",
        endingCriteriaTitle: "작가 결말 기준",
        endingCriteriaBody: "기본 결말 {main}개 · 보조 결말은 필요 시 {min}-{max}개까지 확인합니다.",
        aiCriteriaTitle: "AI 초안 후보 기준",
        aiCriteriaBody: "작가 결말이 없는 분기에서만 표시하고, 업로드 미리보기에서는 생성 요청을 실행하지 않습니다.",
        mainRouteBadgeTitle: "작가 공식 메인 루트",
        mainRouteBadgeBody: "대표 결말 1개를 AI 초안과 분리해 먼저 고정합니다.",
        mainRouteBadgeMeta: "공개 미리보기에는 route 문자열 대신 사용자용 이름만 보여줍니다.",
        routeInputValue: "작가 기본 결말",
      },
    },
    en: {
      title: "Story Upload",
      eyebrow: "Story upload",
      meta: "Story basics",
      scenes: "Scene list",
      endings: "Ending summary",
      form: "Scene input",
      import: "Import preview",
      statusTitle: "Review status",
      status: {
        draft: "Draft",
        needs_revision: "Revise",
        pm_review: "Structure review",
        locale_ready: "Locale ready",
        qa_ready: "Screen check",
        publish_ready: "Ready",
        blocked: "Blocked",
      },
      statusHint: {
        draft: "The writer is preparing manuscript and scene notes.",
        needs_revision: "Review requested changes before the next pass.",
        pm_review: "Copyright and story structure are being checked.",
        locale_ready: "Localized copy and text length are being checked.",
        qa_ready: "Mobile screens and button widths are being checked.",
        publish_ready: "Only final confirmation remains.",
        blocked: "Resolve the blocking reason before moving on.",
      },
      handoff: ["Copy length check", "Mobile screen check", "Final pre-publish check"],
      labels: {
        storyTitle: "Title",
        genre: "Genre",
        free: "Free status",
        minimum: "Minimum",
        sceneId: "Scene",
        sceneTitle: "Scene title",
        background: "Background",
        bgMemo: "Image note",
        cast: "Cast",
        body: "Body",
        choices: "Choices",
        nextScene: "Next scene",
        endingLink: "Ending link",
        saveSoon: "Save (soon)",
        addChoice: "Add choice",
      },
      ending: {
        authorMain: "Main",
        authorSub: "Sub",
        ai: "AI ending",
        subCount: "Sub endings",
      },
      importHead: ["Scene", "Branch", "Ending", "Background", "Cast", "State"],
      importState: {
        ok: "Checked",
        missing: "Missing",
        copyright: "Copyright",
        pm: "Needs review",
      },
      importFlags: [
        "Some background or cast fields are missing.",
        "Copyright review is required.",
        "Structure review is required.",
      ],
      importSave: "Import (soon)",
      sample: {
        storyTitle: "Imjin War: Nanjung Diary Prologue",
        genre: "History tutorial",
        free: "Free prologue",
        minimum: "At least 3 scenes",
        background: "A low drumbeat moves through wartime records.",
        bgMemo: "Candlelight, paper map, low smoke",
        body: "Paste the long manuscript first, then organize branch points and next scenes as choices.",
        sceneTitle: "New branch scene",
        cast: "Yi Sun-sin, archivist, messenger",
      },
      preview: {
        title: "Writer Upload Preview",
        body: "Check manuscript length, branch summaries, and ending candidates without saving.",
        manuscriptRules: "Manuscript rules",
        partLengthLabel: "Part length",
        branchSummaryLabel: "Branch summary",
        baseFormatLabel: "Base format",
        partLengthValue: "About 10,000 characters",
        branchSummaryValue: "Up to 2,000 characters",
        baseFormatValue: "10-part short play",
        endingSetup: "Ending setup",
        publicMaterials: "Public scene materials",
        character: "Character",
        endingCriteriaTitle: "Writer ending rules",
        endingCriteriaBody: "{main} primary ending · {min}-{max} side endings when needed.",
        aiCriteriaTitle: "AI draft candidate rules",
        aiCriteriaBody: "Shown only for branches without writer endings. Preview never runs generation requests.",
        mainRouteBadgeTitle: "Writer official main route",
        mainRouteBadgeBody: "One representative ending is fixed separately from AI drafts.",
        mainRouteBadgeMeta: "The public preview shows a friendly name instead of a route string.",
        routeInputValue: "Writer main ending",
      },
    },
    ja: {
      title: "作品アップロード",
      eyebrow: "ストーリーアップロード",
      meta: "作品基本情報",
      scenes: "シーン一覧",
      endings: "エンディング要約",
      form: "シーン入力",
      import: "取り込みプレビュー",
      statusTitle: "確認ステータス",
      status: {
        draft: "作成中",
        needs_revision: "修正必要",
        pm_review: "構成確認",
        locale_ready: "多言語準備",
        qa_ready: "画面確認",
        publish_ready: "公開準備",
        blocked: "停止中",
      },
      statusHint: {
        draft: "作家が原稿とシーン情報を整理しています。",
        needs_revision: "修正依頼を確認して補完します。",
        pm_review: "著作権と構成を確認しています。",
        locale_ready: "多言語文言と長さを確認しています。",
        qa_ready: "モバイル画面とボタン幅を確認しています。",
        publish_ready: "公開前の最終確認だけが残っています。",
        blocked: "停止理由の確認が必要です。",
      },
      handoff: ["文言の長さ確認", "モバイル画面確認", "公開前の最終確認"],
      labels: {
        storyTitle: "タイトル",
        genre: "ジャンル",
        free: "無料状態",
        minimum: "最小分量",
        sceneId: "シーンID",
        sceneTitle: "シーン名",
        background: "背景",
        bgMemo: "背景画像メモ",
        cast: "登場人物",
        body: "本文",
        choices: "選択肢",
        nextScene: "次シーン",
        endingLink: "終了接続",
        saveSoon: "保存（準備中）",
        addChoice: "選択肢追加",
      },
      ending: {
        authorMain: "作家基本",
        authorSub: "作家サブ",
        ai: "AI終了",
        subCount: "サブ終了",
      },
      importHead: ["シーン", "分岐", "終了", "背景", "登場", "状態"],
      importState: {
        ok: "確認済み",
        missing: "不足",
        copyright: "権利確認",
        pm: "確認必要",
      },
      importFlags: [
        "背景または登場人物に不足があります。",
        "著作権確認が必要です。",
        "構成確認が必要です。",
      ],
      importSave: "取り込み（準備中）",
      sample: {
        storyTitle: "壬辰倭乱：乱中日記プロローグ",
        genre: "歴史チュートリアル",
        free: "無料プロローグ",
        minimum: "3シーン以上",
        background: "戦記の間に低い太鼓の音が響きます。",
        bgMemo: "ろうそく、紙の地図、薄い煙",
        body: "長い本文原稿を先に入れ、分岐点と次のシーンを選択肢で整理します。",
        sceneTitle: "新しい分岐シーン",
        cast: "李舜臣、記録官、伝令",
      },
      preview: {
        title: "作家アップロードプレビュー",
        body: "原稿分量、分岐要約、終了候補を保存せず確認します。",
        manuscriptRules: "原稿基準",
        partLengthLabel: "パート分量",
        branchSummaryLabel: "分岐要約",
        baseFormatLabel: "基本構成",
        partLengthValue: "約10,000字",
        branchSummaryValue: "最大2,000字",
        baseFormatValue: "10パート短編劇",
        endingSetup: "終了設定",
        publicMaterials: "公開可能なシーン素材",
        character: "キャラクター",
        endingCriteriaTitle: "作家終了基準",
        endingCriteriaBody: "基本終了{main}件・補助終了は必要に応じて{min}-{max}件まで確認します。",
        aiCriteriaTitle: "AI下書き候補基準",
        aiCriteriaBody: "作家終了がない分岐だけに表示し、プレビューでは生成リクエストを実行しません。",
        mainRouteBadgeTitle: "作家公式メインルート",
        mainRouteBadgeBody: "代表終了1件をAI下書きと分けて先に固定します。",
        mainRouteBadgeMeta: "公開プレビューにはルート文字列ではなくユーザー向け名だけを表示します。",
        routeInputValue: "作家基本終了",
      },
    },
    "zh-Hans": {
      title: "作品上传",
      eyebrow: "故事上传",
      meta: "作品信息",
      scenes: "场景列表",
      endings: "结局摘要",
      form: "场景输入",
      import: "导入预览",
      statusTitle: "审核状态",
      status: {
        draft: "编写中",
        needs_revision: "需修改",
        pm_review: "结构审核",
        locale_ready: "多语言准备",
        qa_ready: "画面确认",
        publish_ready: "待发布",
        blocked: "受阻",
      },
      statusHint: {
        draft: "作者正在整理稿件和场景信息。",
        needs_revision: "请确认修改请求并补充信息。",
        pm_review: "正在确认版权和故事结构。",
        locale_ready: "正在确认多语言文案和长度。",
        qa_ready: "正在确认移动端画面和按钮宽度。",
        publish_ready: "只剩发布前最终确认。",
        blocked: "需要先确认阻塞原因。",
      },
      handoff: ["文案长度确认", "移动端画面确认", "发布前最终确认"],
      labels: {
        storyTitle: "标题",
        genre: "类型",
        free: "免费状态",
        minimum: "最低量",
        sceneId: "场景ID",
        sceneTitle: "场景标题",
        background: "背景",
        bgMemo: "背景图备注",
        cast: "登场角色",
        body: "正文",
        choices: "选项",
        nextScene: "下一场景",
        endingLink: "连接结局",
        saveSoon: "保存（准备中）",
        addChoice: "添加选项",
      },
      ending: {
        authorMain: "作者主线",
        authorSub: "作者支线",
        ai: "AI结局",
        subCount: "支线结局",
      },
      importHead: ["场景", "分支", "结局", "背景", "登场", "状态"],
      importState: {
        ok: "已确认",
        missing: "缺失",
        copyright: "版权确认",
        pm: "需审核",
      },
      importFlags: [
        "存在背景或登场角色缺失项。",
        "需要进行版权确认。",
        "需要结构确认。",
      ],
      importSave: "导入（准备中）",
      sample: {
        storyTitle: "壬辰倭乱：乱中日记序章",
        genre: "历史教程",
        free: "免费序章",
        minimum: "至少3个场景",
        background: "战时记录之间传来低沉鼓声。",
        bgMemo: "烛光、纸地图、低烟",
        body: "先粘贴长篇正文稿，再用选项整理分支点和后续场景。",
        sceneTitle: "新分支场景",
        cast: "李舜臣、记录官、传令",
      },
      preview: {
        title: "作者上传预览",
        body: "无需保存即可确认稿件长度、分支摘要和结局候选。",
        manuscriptRules: "稿件标准",
        partLengthLabel: "部分长度",
        branchSummaryLabel: "分支摘要",
        baseFormatLabel: "基础结构",
        partLengthValue: "约10,000字",
        branchSummaryValue: "最多2,000字",
        baseFormatValue: "10部分短剧",
        endingSetup: "结局设置",
        publicMaterials: "可公开场景素材",
        character: "角色",
        endingCriteriaTitle: "作者结局标准",
        endingCriteriaBody: "主线结局{main}个；支线结局按需确认{min}-{max}个。",
        aiCriteriaTitle: "AI 草稿候选标准",
        aiCriteriaBody: "仅在没有作者结局的分支显示；预览不会执行生成请求。",
        mainRouteBadgeTitle: "作者官方主路线",
        mainRouteBadgeBody: "先固定 1 个代表结局，并与 AI 草稿分开。",
        mainRouteBadgeMeta: "公开预览只显示用户可读名称，不显示路线字符串。",
        routeInputValue: "作者主线结局",
      },
    },
    "zh-Hant": {
      title: "作品上傳",
      eyebrow: "故事上傳",
      meta: "作品資訊",
      scenes: "場景列表",
      endings: "結局摘要",
      form: "場景輸入",
      import: "匯入預覽",
      statusTitle: "審核狀態",
      status: {
        draft: "撰寫中",
        needs_revision: "需修改",
        pm_review: "結構審核",
        locale_ready: "多語準備",
        qa_ready: "畫面確認",
        publish_ready: "待發布",
        blocked: "受阻",
      },
      statusHint: {
        draft: "作者正在整理稿件與場景資訊。",
        needs_revision: "請確認修改要求並補充資訊。",
        pm_review: "正在確認版權與故事結構。",
        locale_ready: "正在確認多語文案與長度。",
        qa_ready: "正在確認行動版畫面與按鈕寬度。",
        publish_ready: "只剩發布前最終確認。",
        blocked: "需要先確認阻塞原因。",
      },
      handoff: ["文案長度確認", "行動版畫面確認", "發布前最終確認"],
      labels: {
        storyTitle: "標題",
        genre: "類型",
        free: "免費狀態",
        minimum: "最低量",
        sceneId: "場景ID",
        sceneTitle: "場景標題",
        background: "背景",
        bgMemo: "背景圖備註",
        cast: "登場角色",
        body: "正文",
        choices: "選項",
        nextScene: "下一場景",
        endingLink: "連接結局",
        saveSoon: "儲存（準備中）",
        addChoice: "新增選項",
      },
      ending: {
        authorMain: "作者主線",
        authorSub: "作者支線",
        ai: "AI結局",
        subCount: "支線結局",
      },
      importHead: ["場景", "分支", "結局", "背景", "登場", "狀態"],
      importState: {
        ok: "已確認",
        missing: "缺失",
        copyright: "版權確認",
        pm: "需審核",
      },
      importFlags: [
        "存在背景或登場角色缺失項。",
        "需要進行版權確認。",
        "需要結構確認。",
      ],
      importSave: "匯入（準備中）",
      sample: {
        storyTitle: "壬辰倭亂：亂中日記序章",
        genre: "歷史教程",
        free: "免費序章",
        minimum: "至少3個場景",
        background: "戰時記錄之間傳來低沉鼓聲。",
        bgMemo: "燭光、紙地圖、低煙",
        body: "先貼上長篇正文稿，再用選項整理分支點與後續場景。",
        sceneTitle: "新分支場景",
        cast: "李舜臣、記錄官、傳令",
      },
      preview: {
        title: "作者上傳預覽",
        body: "無需儲存即可確認稿件長度、分支摘要和結局候選。",
        manuscriptRules: "稿件標準",
        partLengthLabel: "部分長度",
        branchSummaryLabel: "分支摘要",
        baseFormatLabel: "基礎結構",
        partLengthValue: "約10,000字",
        branchSummaryValue: "最多2,000字",
        baseFormatValue: "10部分短劇",
        endingSetup: "結局設定",
        publicMaterials: "可公開場景素材",
        character: "角色",
        endingCriteriaTitle: "作者結局標準",
        endingCriteriaBody: "主線結局{main}個；支線結局按需確認{min}-{max}個。",
        aiCriteriaTitle: "AI 草稿候選標準",
        aiCriteriaBody: "僅在沒有作者結局的分支顯示；預覽不會執行生成請求。",
        mainRouteBadgeTitle: "作者官方主路線",
        mainRouteBadgeBody: "先固定 1 個代表結局，並與 AI 草稿分開。",
        mainRouteBadgeMeta: "公開預覽只顯示使用者可讀名稱，不顯示路線字串。",
        routeInputValue: "作者主線結局",
      },
    },
  };

  const QA_COPY = {
    ko: {
      planTitle: "파트/분기 기준",
      partLength: "1파트 약 10,000자",
      branchSummary: "분기 설명/요약 2,000자 이내",
      partCount: "10파트 기본 단편극",
      branchTitle: "나무뿌리형 분기 결과",
      branchNote: "선택별 관계, 위험, 아이템, 정보, 엔딩 조건을 분리해 재합류 전 차이를 남겨요.",
      onboardingTitle: "작가 업로드 안내",
      onboardingBody: "긴 본문 원고를 먼저 쓰고, 분기점만 선택지로 표시해요.",
      onboardingSteps: ["본문 원고", "분기점", "장면 연결"],
      referenceTitle: "검수 참고 링크",
      referenceNote: "검수자가 확인하는 읽기 전용 위치예요. 서비스 CTA가 아니며 저장하지 않아요.",
      referenceLinks: [
        { label: "오늘의 보드", href: "/story-upload?cloudQa=pm-daily" },
        { label: "업로드 미리보기", href: "/story-upload?cloudQa=upload-panel" },
        { label: "장면 미리보기", href: "/story-stage?storySceneFixturePreview=1" },
      ],
      aiFallbackEvidence: {
        title: "AI 초안 후보 안내",
        conditionLabel: "허용 조건",
        conditionText: "작가 결말이 없는 분기에서만 보류 후보로 표시돼요.",
        branchLabel: "분기 상태",
        branchText: "해안 우회 분기는 작가 결말이 아직 설정되지 않았어요.",
        providerLabel: "초안 상태",
        providerText: "가져오기 미리보기에서는 자동 생성을 실행하지 않아요.",
      },
      endingLabels: {
        author_main: "작가 기본 엔딩",
        author_sub: "작가 보조 엔딩",
        ai_fallback: "AI 초안 후보",
      },
      importHead: ["장면", "분기", "결말", "파트 수", "분기 요약 제한", "상태"],
      choices: [
        { label: "A", tone: "info", text: "기록을 먼저 확인한다", next: "기록 보관실", result: "정보 + 신뢰 상승", rejoin: "후반 합류 장면", tags: ["정보", "신뢰"] },
        { label: "B", tone: "risk", text: "전령을 따라간다", next: "밤 항구 추적", result: "위험 + 아이템 획득", rejoin: "후반 합류 장면", tags: ["위험", "아이템"] },
        { label: "C", tone: "ending", text: "해안으로 우회한다", next: "안개 해안 우회", result: "관계 변화 + 보류 후보 조건", rejoin: "AI 초안 후보", tags: ["관계", "보류"] },
      ],
      endings: ["작가 기본 엔딩", "작가 보조 엔딩", "AI 초안 후보"],
      endingCards: [
        { type: "author_main", title: "작가 기본 엔딩", body: "작가가 지정한 중심 루트의 결말이에요." },
        { type: "author_sub", title: "작가 보조 엔딩", body: "작가가 별도로 준비한 선택 루트 결말이에요." },
        { type: "ai", title: "AI 초안 후보", body: "작가 엔딩이 없는 분기에서만 보류 후보로 보여요. 공식 결말처럼 보이지 않게 검수 대기 상태를 유지합니다." },
      ],
    },
    en: {
      planTitle: "Part and branch rules",
      partLength: "About 10,000 characters per part",
      branchSummary: "Branch summary stays within 2,000 characters",
      partCount: "10 parts form the default short play",
      branchTitle: "Root-style branch outcomes",
      branchNote: "Each choice keeps relation, risk, item, info, and ending-condition changes before any rejoin.",
      onboardingTitle: "Writer upload guide",
      onboardingBody: "Draft the long manuscript; mark only branch points.",
      onboardingSteps: ["Manuscript", "Branch points", "Scene links"],
      referenceTitle: "Review links",
      referenceNote: "Read-only checkpoints for reviewers. These are not service CTAs and nothing is saved.",
      referenceLinks: [
        { label: "Daily board", href: "/story-upload?cloudQa=pm-daily" },
        { label: "Upload preview", href: "/story-upload?cloudQa=upload-panel" },
        { label: "Scene preview", href: "/story-stage?storySceneFixturePreview=1" },
      ],
      aiFallbackEvidence: {
        title: "AI draft candidate note",
        conditionLabel: "Allowed when",
        conditionText: "Shown as a pending candidate only when a branch has no writer ending.",
        branchLabel: "Branch status",
        branchText: "The shore-detour branch has no writer ending configured yet.",
        providerLabel: "Draft status",
        providerText: "This import preview does not run automatic generation.",
      },
      endingLabels: {
        author_main: "Writer primary ending",
        author_sub: "Writer side ending",
        ai_fallback: "AI draft candidate",
      },
      importHead: ["Scene", "Branch", "Ending", "Part count", "Branch summary limit", "State"],
      choices: [
        { label: "A", tone: "info", text: "Check the record first", next: "Archive room", result: "Info + trust up", rejoin: "Later rejoin scene", tags: ["Info", "Trust"] },
        { label: "B", tone: "risk", text: "Follow the messenger", next: "Night harbor pursuit", result: "Risk + item gained", rejoin: "Later rejoin scene", tags: ["Risk", "Item"] },
        { label: "C", tone: "ending", text: "Detour to the shore", next: "Foggy shore detour", result: "Relation shift + pending draft rule", rejoin: "AI draft candidate", tags: ["Relation", "Pending"] },
      ],
      endings: ["Writer primary ending", "Writer side ending", "AI draft candidate"],
      endingCards: [
        { type: "author_main", title: "Writer primary ending", body: "The writer's primary route ending." },
        { type: "author_sub", title: "Writer side ending", body: "A writer-prepared ending for a side route." },
        { type: "ai", title: "AI draft candidate", body: "A pending draft candidate shown only for branches without writer endings, never as an official ending." },
      ],
    },
    ja: {
      planTitle: "パート/分岐基準",
      partLength: "1パート約10,000字",
      branchSummary: "分岐説明/要約は2,000字以内",
      partCount: "10パートが基本短編劇",
      branchTitle: "木の根型の分岐結果",
      branchNote: "再合流前に、選択ごとの関係、危険、アイテム、情報、終了条件の差を残します。",
      onboardingTitle: "作家アップロード案内",
      onboardingBody: "長い本文原稿を書き、分岐点だけ選択肢にします。",
      onboardingSteps: ["本文原稿", "分岐点", "シーン接続"],
      referenceTitle: "レビュー用リンク",
      referenceNote: "検収担当者向けの読み取り専用位置です。サービスCTAではなく保存もしません。",
      referenceLinks: [
        { label: "今日のボード", href: "/story-upload?cloudQa=pm-daily" },
        { label: "アップロードプレビュー", href: "/story-upload?cloudQa=upload-panel" },
        { label: "シーンプレビュー", href: "/story-stage?storySceneFixturePreview=1" },
      ],
      aiFallbackEvidence: {
        title: "AI下書き候補の案内",
        conditionLabel: "許可条件",
        conditionText: "作家のエンディングがない分岐だけ保留候補として表示されます。",
        branchLabel: "分岐状態",
        branchText: "海岸迂回分岐には作家エンディングがまだ設定されていません。",
        providerLabel: "下書き状態",
        providerText: "この取込プレビューでは自動生成を実行しません。",
      },
      endingLabels: {
        author_main: "作家基本終了",
        author_sub: "作家サブ終了",
        ai_fallback: "AI下書き候補",
      },
      importHead: ["シーン", "分岐", "終了種別", "パート数", "分岐要約上限", "状態"],
      choices: [
        { label: "A", tone: "info", text: "記録を先に確認する", next: "記録の部屋", result: "情報 + 信頼上昇", rejoin: "後半の再合流場面", tags: ["情報", "信頼"] },
        { label: "B", tone: "risk", text: "伝令について行く", next: "夜の港追跡", result: "危険 + アイテム取得", rejoin: "後半の再合流場面", tags: ["危険", "アイテム"] },
        { label: "C", tone: "ending", text: "海岸へ迂回する", next: "霧の海岸迂回", result: "関係変化 + 保留候補条件", rejoin: "AI下書き候補", tags: ["関係", "保留"] },
      ],
      endings: ["作家基本終了", "作家サブ終了", "AI下書き候補"],
      endingCards: [
        { type: "author_main", title: "作家基本終了", body: "作家が指定した中心ルートの結末です。" },
        { type: "author_sub", title: "作家サブ終了", body: "作家が別途用意した選択ルートの結末です。" },
        { type: "ai", title: "AI下書き候補", body: "作家終了がない分岐だけに保留候補として表示され、公式終了には見せません。" },
      ],
    },
    "zh-Hans": {
      planTitle: "分部/分支标准",
      partLength: "每部分约10,000字",
      branchSummary: "分支说明/摘要控制在2,000字内",
      partCount: "10部分为默认短剧",
      branchTitle: "树根型分支结果",
      branchNote: "即使之后再汇合，也保留各选项的关系、风险、道具、信息和结局条件差异。",
      onboardingTitle: "作者上传指引",
      onboardingBody: "先写长篇正文稿，再只把分支点标为选项。",
      onboardingSteps: ["正文稿", "分支点", "场景连接"],
      referenceTitle: "审核参考链接",
      referenceNote: "供检收人员查看的只读位置。不是服务CTA，也不会保存。",
      referenceLinks: [
        { label: "今日看板", href: "/story-upload?cloudQa=pm-daily" },
        { label: "上传预览", href: "/story-upload?cloudQa=upload-panel" },
        { label: "场景预览", href: "/story-stage?storySceneFixturePreview=1" },
      ],
      aiFallbackEvidence: {
        title: "AI 草稿候选说明",
        conditionLabel: "允许条件",
        conditionText: "仅在没有作者结局的分支以待定候选显示。",
        branchLabel: "分支状态",
        branchText: "海岸绕行分支尚未设置作者结局。",
        providerLabel: "草稿状态",
        providerText: "此预览不会运行自动生成。",
      },
      endingLabels: {
        author_main: "作者主线结局",
        author_sub: "作者支线结局",
        ai_fallback: "AI 草稿候选",
      },
      importHead: ["场景", "分支", "结局类型", "部分数", "分支摘要上限", "状态"],
      choices: [
        { label: "A", tone: "info", text: "先确认记录", next: "记录室", result: "信息 + 信任提升", rejoin: "后段汇合场景", tags: ["信息", "信任"] },
        { label: "B", tone: "risk", text: "跟随传令", next: "夜间港口追踪", result: "风险 + 获得道具", rejoin: "后段汇合场景", tags: ["风险", "道具"] },
        { label: "C", tone: "ending", text: "绕到海岸", next: "雾中海岸绕行", result: "关系变化 + 待定候选条件", rejoin: "AI 草稿候选", tags: ["关系", "待定"] },
      ],
      endings: ["作者主线结局", "作者支线结局", "AI 草稿候选"],
      endingCards: [
        { type: "author_main", title: "作者主线结局", body: "作者指定的主路线结局。" },
        { type: "author_sub", title: "作者支线结局", body: "作者另外准备的选择路线结局。" },
        { type: "ai", title: "AI 草稿候选", body: "只在没有作者结局的分支中作为待定候选显示，不会显示成正式结局。" },
      ],
    },
    "zh-Hant": {
      planTitle: "分部/分支標準",
      partLength: "每部分約10,000字",
      branchSummary: "分支說明/摘要控制在2,000字內",
      partCount: "10部分為預設短劇",
      branchTitle: "樹根型分支結果",
      branchNote: "即使之後再匯合，也保留各選項的關係、風險、道具、資訊和結局條件差異。",
      onboardingTitle: "作者上傳指引",
      onboardingBody: "先寫長篇正文稿，再只把分支點標為選項。",
      onboardingSteps: ["正文稿", "分支點", "場景連接"],
      referenceTitle: "審核參考連結",
      referenceNote: "供檢收人員查看的唯讀位置。不是服務CTA，也不會儲存。",
      referenceLinks: [
        { label: "今日看板", href: "/story-upload?cloudQa=pm-daily" },
        { label: "上傳預覽", href: "/story-upload?cloudQa=upload-panel" },
        { label: "場景預覽", href: "/story-stage?storySceneFixturePreview=1" },
      ],
      aiFallbackEvidence: {
        title: "AI 草稿候選說明",
        conditionLabel: "允許條件",
        conditionText: "僅在沒有作者結局的分支以待定候選顯示。",
        branchLabel: "分支狀態",
        branchText: "海岸繞行分支尚未設定作者結局。",
        providerLabel: "草稿狀態",
        providerText: "此預覽不會執行自動生成。",
      },
      endingLabels: {
        author_main: "作者主線結局",
        author_sub: "作者支線結局",
        ai_fallback: "AI 草稿候選",
      },
      importHead: ["場景", "分支", "結局類型", "部分數", "分支摘要上限", "狀態"],
      choices: [
        { label: "A", tone: "info", text: "先確認記錄", next: "記錄室", result: "資訊 + 信任提升", rejoin: "後段匯合場景", tags: ["資訊", "信任"] },
        { label: "B", tone: "risk", text: "跟隨傳令", next: "夜間港口追蹤", result: "風險 + 獲得道具", rejoin: "後段匯合場景", tags: ["風險", "道具"] },
        { label: "C", tone: "ending", text: "繞到海岸", next: "霧中海岸繞行", result: "關係變化 + 待定候選條件", rejoin: "AI 草稿候選", tags: ["關係", "待定"] },
      ],
      endings: ["作者主線結局", "作者支線結局", "AI 草稿候選"],
      endingCards: [
        { type: "author_main", title: "作者主線結局", body: "作者指定的主路線結局。" },
        { type: "author_sub", title: "作者支線結局", body: "作者另外準備的選擇路線結局。" },
        { type: "ai", title: "AI 草稿候選", body: "只在沒有作者結局的分支中作為待定候選顯示，不會顯示成正式結局。" },
      ],
    },
  };

  const sampleScenes = [
    { id: "S01", title: { ko: "기록의 방", en: "Archive room", ja: "記録の部屋", "zh-Hans": "记录室", "zh-Hant": "記錄室" }, state: "pm_review" },
    { id: "S02", title: { ko: "첫 분기", en: "First branch", ja: "最初の分岐", "zh-Hans": "第一个分支", "zh-Hant": "第一個分支" }, state: "locale_ready" },
    { id: "S03", title: { ko: "공통 장면", en: "Shared scene", ja: "共通シーン", "zh-Hans": "共用场景", "zh-Hant": "共用場景" }, state: "qa_ready" },
    { id: "S09", title: { ko: "재합류 장면", en: "Rejoin scene", ja: "再合流シーン", "zh-Hans": "再汇合场景", "zh-Hant": "再匯合場景" }, state: "qa_ready" },
  ];

  const importRows = [
    {
      scene: "S01",
      sceneLabel: { ko: "기록의 방", en: "Archive room", ja: "記録の部屋", "zh-Hans": "记录室", "zh-Hant": "記錄室" },
      branch: "ROOT",
      branchLabel: { ko: "기본 흐름", en: "Main flow", ja: "基本フロー", "zh-Hans": "主流程", "zh-Hant": "主流程" },
      ending: "author_main",
      part: "10",
      summary: "<= 2,000",
      state: "ok",
    },
    {
      scene: "S05",
      sceneLabel: { ko: "기록 보관실", en: "Archive map room", ja: "記録保管室", "zh-Hans": "档案地图室", "zh-Hant": "檔案地圖室" },
      branch: "B-A",
      branchLabel: { ko: "기록 선택 분기", en: "Record-choice branch", ja: "記録選択分岐", "zh-Hans": "记录选择分支", "zh-Hant": "記錄選擇分支" },
      ending: "author_sub",
      part: "10",
      summary: "<= 2,000",
      state: "ok",
    },
    {
      scene: "S07",
      sceneLabel: { ko: "안개 해안 우회", en: "Foggy shore detour", ja: "霧の海岸迂回", "zh-Hans": "雾中海岸绕行", "zh-Hant": "霧中海岸繞行" },
      branch: "B-C",
      branchLabel: { ko: "해안 우회 분기", en: "Shore-detour branch", ja: "海岸迂回分岐", "zh-Hans": "海岸绕行分支", "zh-Hant": "海岸繞行分支" },
      ending: "ai_fallback",
      part: "10",
      summary: "<= 2,000",
      state: "pm",
    },
  ];

  const aiFallbackEvidence = {
    branch: "B-C",
    ending: "ai_fallback",
    policy: "writer_ending_missing_only",
    writerEndingConfigured: "false",
    fallbackReason: "writer_ending_missing",
    providerGeneratedAtIntake: "false",
  };

  const endingValidationEvidence = {
    authorMainCount: "1",
    authorSubCount: "2",
    authorSubMin: "2",
    authorSubMax: "10",
    aiFallbackPolicy: "writer-ending-missing-only",
    writerEndingConfigured: aiFallbackEvidence.writerEndingConfigured,
    providerGeneratedAtIntake: aiFallbackEvidence.providerGeneratedAtIntake,
  };

  const AUTHOR_PREVIEW_FIXTURE = {
    partLength: "10000",
    branchSummaryLimit: "2000",
    shortDramaParts: "10",
    endings: [
      {
        label: { ko: "작가 기본 결말", en: "Writer primary ending", ja: "作家基本終了", "zh-Hans": "作者主线结局", "zh-Hant": "作者主線結局" },
        count: "1",
        state: "configured",
        stateLabel: { ko: "설정됨", en: "Set", ja: "設定済み", "zh-Hans": "已设置", "zh-Hant": "已設定" },
      },
      {
        label: { ko: "작가 보조 결말", en: "Writer side ending", ja: "作家補助終了", "zh-Hans": "作者支线结局", "zh-Hant": "作者支線結局" },
        count: "2",
        state: "configured",
        stateLabel: { ko: "설정됨", en: "Set", ja: "設定済み", "zh-Hans": "已设置", "zh-Hant": "已設定" },
      },
      {
        label: { ko: "AI 초안 후보", en: "AI draft candidate", ja: "AI下書き候補", "zh-Hans": "AI 草稿候选", "zh-Hant": "AI 草稿候選" },
        count: "1",
        state: "missing-writer-ending-only",
        stateLabel: { ko: "작가 결말이 없을 때만 사용", en: "Only without writer ending", ja: "作家終了がない時のみ", "zh-Hans": "仅无作者结局时使用", "zh-Hant": "僅無作者結局時使用" },
      },
    ],
    backgrounds: [
      { scene: "S05", assetId: "bg-war-room-map", label: { ko: "작전 지도실", en: "War map room", ja: "作戦地図室", "zh-Hans": "作战地图室", "zh-Hant": "作戰地圖室" } },
      { scene: "S06", assetId: "bg-harbor-night", label: { ko: "밤 항구 추적", en: "Night harbor pursuit", ja: "夜の港追跡", "zh-Hans": "夜间港口追踪", "zh-Hant": "夜間港口追蹤" } },
      { scene: "S07", assetId: "bg-fog-shore", label: { ko: "안개 해안 우회", en: "Foggy shore detour", ja: "霧の海岸迂回", "zh-Hans": "雾中海岸绕行", "zh-Hant": "霧中海岸繞行" } },
    ],
    characters: [
      { assetId: "character.cha-dohyun.reference-final-03", label: { ko: "차도현 안내 컷", en: "Cha Dohyun guide cut", ja: "チャ・ドヒョン案内カット", "zh-Hans": "车道贤引导图", "zh-Hant": "車道賢引導圖" } },
      { assetId: "none", label: { ko: "해안 우회는 캐릭터 없이 진행 가능", en: "The shore detour can proceed without a character", ja: "海岸迂回はキャラクターなしで進行可", "zh-Hans": "海岸绕行可无角色进行", "zh-Hant": "海岸繞行可無角色進行" } },
    ],
  };

  const localeMap = {
    ko: "ko-KR",
    en: "en-US",
    ja: "ja-JP",
    "zh-Hans": "zh-CN",
    "zh-Hant": "zh-Hant",
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function localText(value, localeCode) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value[localeCode] || value.ko || value.en || "";
    }
    return value;
  }

  function fillPreviewTemplate(template, values) {
    return String(template || "").replace(/\{(main|min|max)\}/g, (_, key) => values[key] || "");
  }

  function field(label, value) {
    return `<li><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></li>`;
  }

  function renderAuthorGuide(qa) {
    return `
      <div class="su-author-guide">
        <div>
          <h3>${escapeHtml(qa.onboardingTitle)}</h3>
          <p>${escapeHtml(qa.onboardingBody)}</p>
        </div>
        <ol>
          ${qa.onboardingSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}
        </ol>
      </div>
    `;
  }

  function renderReferencePanel(qa) {
    return `
      <aside class="su-reference-panel" aria-label="${escapeHtml(qa.referenceTitle)}">
        <div>
          <h2>${escapeHtml(qa.referenceTitle)}</h2>
          <p>${escapeHtml(qa.referenceNote)}</p>
        </div>
        <nav>
          ${qa.referenceLinks.map((link) => `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`).join("")}
        </nav>
      </aside>
    `;
  }

  function endingLabel(qa, value) {
    return qa.endingLabels?.[value] || value;
  }

  function publicSceneLabel(scene, localeCode) {
    return localText(scene?.title, localeCode) || scene?.id || "";
  }

  function renderUploadWorkspace(localeCode) {
    const locale = UI[localeCode] || UI.ko;
    const qa = QA_COPY[localeCode] || QA_COPY.ko;
    const preview = locale.preview || UI.ko.preview;
    const endingRuleValues = {
      main: endingValidationEvidence.authorMainCount,
      min: endingValidationEvidence.authorSubMin,
      max: endingValidationEvidence.authorSubMax,
    };
    document.documentElement.lang = localeMap[localeCode] || "ko-KR";

    root.innerHTML = `
      <div class="su-shell"
           data-story-upload-public-build-marker="story-upload-public-2026-07-05"
           data-reflection-status="public"
           data-part-length-target="10000"
           data-branch-summary-limit="2000"
           data-short-drama-part-count="10">
        <header class="su-header">
          <div class="su-title-group">
            <p class="su-eyebrow">${escapeHtml(locale.eyebrow)}</p>
            <h1 class="su-title">${escapeHtml(locale.title)}</h1>
          </div>
          <div class="su-locale" aria-label="Story upload locale">
            ${LOCALES.map((item) => `<button type="button" data-su-locale="${item.code}" aria-pressed="${item.code === localeCode ? "true" : "false"}">${item.label}</button>`).join("")}
          </div>
        </header>

        <section class="su-grid" aria-label="Story upload overview">
          <div class="su-section">
            <h2>${escapeHtml(locale.meta)}</h2>
            <ul class="su-meta-list">
              ${field(locale.labels.storyTitle, locale.sample.storyTitle)}
              ${field(locale.labels.genre, locale.sample.genre)}
              ${field(locale.labels.free, locale.sample.free)}
              ${field(locale.labels.minimum, locale.sample.minimum)}
              ${field(qa.planTitle, `${qa.partLength} · ${qa.partCount}`)}
              ${field(locale.labels.choices, qa.branchSummary)}
            </ul>
            ${renderAuthorGuide(qa)}
          </div>
          <div class="su-panel su-review-status" data-status="locale_ready">
            <h2>${escapeHtml(locale.statusTitle)}</h2>
            <span class="su-status-pill">${escapeHtml(locale.status.locale_ready)}</span>
            <p class="su-status-hint">${escapeHtml(locale.statusHint.locale_ready)}</p>
            <div class="su-status-handoff">${locale.handoff.map((item) => `<span class="su-chip">${escapeHtml(item)}</span>`).join("")}</div>
          </div>
        </section>

        <section class="su-section su-author-preview-panel"
                 data-author-upload-preview-panel="true"
                 data-part-length="${escapeHtml(AUTHOR_PREVIEW_FIXTURE.partLength)}"
                 data-branch-summary-limit="${escapeHtml(AUTHOR_PREVIEW_FIXTURE.branchSummaryLimit)}"
                 data-short-drama-parts="${escapeHtml(AUTHOR_PREVIEW_FIXTURE.shortDramaParts)}">
          <div class="su-author-preview-head">
            <h2>${escapeHtml(preview.title)}</h2>
            <p>${escapeHtml(preview.body)}</p>
          </div>
          <div class="su-preview-grid">
            <article class="su-preview-card" data-preview-kind="length">
              <strong>${escapeHtml(preview.manuscriptRules)}</strong>
              <dl>
                <div><dt>${escapeHtml(preview.partLengthLabel)}</dt><dd>${escapeHtml(preview.partLengthValue)}</dd></div>
                <div><dt>${escapeHtml(preview.branchSummaryLabel)}</dt><dd>${escapeHtml(preview.branchSummaryValue)}</dd></div>
                <div><dt>${escapeHtml(preview.baseFormatLabel)}</dt><dd>${escapeHtml(preview.baseFormatValue)}</dd></div>
              </dl>
            </article>
            <article class="su-preview-card" data-preview-kind="ending">
              <strong>${escapeHtml(preview.endingSetup)}</strong>
              <ul>
                ${AUTHOR_PREVIEW_FIXTURE.endings.map((ending) => `
                  <li data-ending-state="${escapeHtml(ending.state)}">
                    <span>${escapeHtml(localText(ending.label, localeCode))}</span>
                    <b>${escapeHtml(ending.count)}</b>
                    <em>${escapeHtml(localText(ending.stateLabel, localeCode))}</em>
                  </li>
                `).join("")}
              </ul>
            </article>
            <article class="su-main-route-badge" data-creator-main-route-badge="true">
              <span>${escapeHtml(preview.mainRouteBadgeTitle)}</span>
              <strong>${escapeHtml(preview.routeInputValue)}</strong>
              <p>${escapeHtml(preview.mainRouteBadgeBody)}</p>
              <em>${escapeHtml(preview.mainRouteBadgeMeta)}</em>
            </article>
            <article class="su-preview-card" data-preview-kind="safe-assets">
              <strong>${escapeHtml(preview.publicMaterials)}</strong>
              <dl>
                ${AUTHOR_PREVIEW_FIXTURE.backgrounds.map((asset) => `
                  <div data-safe-background-id="${escapeHtml(asset.assetId)}">
                    <dt>${escapeHtml(locale.labels.background)}</dt>
                    <dd>${escapeHtml(localText(asset.label, localeCode))}</dd>
                  </div>
                `).join("")}
                ${AUTHOR_PREVIEW_FIXTURE.characters.map((asset) => `
                  <div data-safe-character-id="${escapeHtml(asset.assetId)}">
                    <dt>${escapeHtml(preview.character)}</dt>
                    <dd>${escapeHtml(localText(asset.label, localeCode))}</dd>
                  </div>
                `).join("")}
              </dl>
            </article>
          </div>
        </section>

        <section class="su-grid">
          <div class="su-section">
            <h2>${escapeHtml(locale.scenes)}</h2>
            <ul class="su-scene-list">
              ${sampleScenes.map((scene) => `<li class="su-scene-item"><span>${escapeHtml(publicSceneLabel(scene, localeCode))}</span><strong>${escapeHtml(localText(scene.title, localeCode))} · ${escapeHtml(locale.status[scene.state])}</strong></li>`).join("")}
            </ul>
          </div>
          <div class="su-section">
            <h2>${escapeHtml(locale.endings)}</h2>
            <div class="su-ending-summary su-ending-cards">
              ${qa.endingCards.map((ending) => `
                <article class="su-ending-card" data-ending="${escapeHtml(ending.type)}">
                  <span class="su-ending-badge" data-ending="${escapeHtml(ending.type)}">${escapeHtml(ending.title)}</span>
                  <p>${escapeHtml(ending.body)}</p>
                </article>
              `).join("")}
            </div>
            <details class="su-ending-list">
              <summary>${escapeHtml(locale.ending.subCount)} <b>${qa.endings.length}</b></summary>
              <ul>
                ${qa.endings.map((ending) => `<li>${escapeHtml(ending)}</li>`).join("")}
              </ul>
            </details>
            <dl class="su-ai-fallback-evidence"
                data-ending="${escapeHtml(aiFallbackEvidence.ending)}"
                data-ai-fallback-policy="writer-ending-missing-only"
                data-writer-ending-configured="false"
                data-provider-generated-at-intake="${escapeHtml(aiFallbackEvidence.providerGeneratedAtIntake)}"
                data-fallback-reason-key="${escapeHtml(aiFallbackEvidence.fallbackReason)}">
              <dt>${escapeHtml(qa.aiFallbackEvidence.title)}</dt>
              <dd>${escapeHtml(qa.aiFallbackEvidence.conditionText)}</dd>
              <dt>${escapeHtml(qa.aiFallbackEvidence.branchLabel)}</dt>
              <dd>${escapeHtml(qa.aiFallbackEvidence.branchText)}</dd>
              <dt>${escapeHtml(qa.aiFallbackEvidence.providerLabel)}</dt>
              <dd>${escapeHtml(qa.aiFallbackEvidence.providerText)}</dd>
            </dl>
            <dl class="su-ending-validation-evidence"
                data-author-main-count="${escapeHtml(endingValidationEvidence.authorMainCount)}"
                data-author-sub-count="${escapeHtml(endingValidationEvidence.authorSubCount)}"
                data-author-sub-min="${escapeHtml(endingValidationEvidence.authorSubMin)}"
                data-author-sub-max="${escapeHtml(endingValidationEvidence.authorSubMax)}"
                data-ai-fallback-policy="${escapeHtml(endingValidationEvidence.aiFallbackPolicy)}"
                data-writer-ending-configured="${escapeHtml(endingValidationEvidence.writerEndingConfigured)}"
                data-provider-generated-at-intake="${escapeHtml(endingValidationEvidence.providerGeneratedAtIntake)}">
              <dt>${escapeHtml(preview.endingCriteriaTitle)}</dt>
              <dd>${escapeHtml(fillPreviewTemplate(preview.endingCriteriaBody, endingRuleValues))}</dd>
              <dt>${escapeHtml(preview.aiCriteriaTitle)}</dt>
              <dd>${escapeHtml(preview.aiCriteriaBody)}</dd>
            </dl>
          </div>
        </section>

        <section class="su-section">
          <h2>${escapeHtml(locale.form)}</h2>
          <form class="su-scene-form" aria-label="Scene upload preview form">
            <div class="su-row">
              <label class="su-field"><span>${escapeHtml(locale.labels.sceneId)}</span><input name="sceneId" value="S04" readonly /></label>
              <label class="su-field"><span>${escapeHtml(locale.labels.sceneTitle)}</span><input name="sceneTitle" value="${escapeHtml(locale.sample.sceneTitle)}" readonly /></label>
            </div>
            <details open
                     data-public-asset-id="scene.background.upload-preview"
                     data-public-asset-label="storyUpload.preview.background"
                     data-scene-use="background">
              <summary>${escapeHtml(locale.labels.background)}</summary>
              <div>
                <textarea name="background" rows="2" readonly>${escapeHtml(locale.sample.background)}</textarea>
                <input name="bgImageMemo" value="${escapeHtml(locale.sample.bgMemo)}" readonly />
              </div>
            </details>
            <details
              data-public-asset-id="character.upload-preview.cast"
              data-public-asset-label="storyUpload.preview.cast"
              data-scene-use="character">
              <summary>${escapeHtml(locale.labels.cast)}</summary>
              <div><input value="${escapeHtml(locale.sample.cast)}" readonly /></div>
            </details>
            <label class="su-field"><span>${escapeHtml(locale.labels.body)}</span><textarea name="body" rows="8" class="su-body" readonly>${escapeHtml(locale.sample.body)}</textarea></label>
            <div class="su-choices" aria-label="${escapeHtml(locale.labels.choices)}">
              ${qa.choices.map((choice) => `<div class="su-choice-row"><input value="${escapeHtml(choice.label)}" readonly /><input value="${escapeHtml(choice.text)}" readonly /><input value="${escapeHtml(choice.next)}" readonly /></div>`).join("")}
              <button class="su-action" type="button" disabled aria-disabled="true">${escapeHtml(locale.labels.addChoice)}</button>
            </div>
            <div class="su-row">
              <label class="su-field"><span>${escapeHtml(locale.labels.nextScene)}</span><input name="nextScene" value="${escapeHtml(qa.choices[0]?.next || "")}" readonly /></label>
              <label class="su-field"><span>${escapeHtml(locale.labels.endingLink)}</span><input value="${escapeHtml(preview.routeInputValue)}" readonly /></label>
            </div>
            <button type="button" class="su-save" disabled aria-disabled="true">${escapeHtml(locale.labels.saveSoon)}</button>
          </form>
        </section>

        <section class="su-section">
          <h2>${escapeHtml(qa.branchTitle)}</h2>
          <p class="su-muted">${escapeHtml(qa.branchNote)}</p>
          <div class="su-branch-tree">
            ${qa.choices.map((choice) => `
              <article class="su-branch-card" data-branch-tone="${escapeHtml(choice.tone)}">
                <div class="su-branch-head">
                  <b>${escapeHtml(choice.label)}</b>
                  <strong>${escapeHtml(choice.next)}</strong>
                </div>
                <p>${escapeHtml(choice.text)}</p>
                <span>${escapeHtml(choice.result)}</span>
                <div class="su-branch-tags">${choice.tags.map((tag) => `<small>${escapeHtml(tag)}</small>`).join("")}</div>
                <em>${escapeHtml(choice.rejoin)}</em>
              </article>
            `).join("")}
          </div>
        </section>

        ${renderReferencePanel(qa)}

        <section class="su-section">
          <h2>${escapeHtml(locale.import)}</h2>
          <div class="su-import-wrap">
            <table class="su-import-preview">
              <thead><tr>${qa.importHead.map((head) => `<th>${escapeHtml(head)}</th>`).join("")}</tr></thead>
              <tbody>
                ${importRows.map((row) => `
                  <tr
                    data-ending-type="${escapeHtml(row.ending)}"
                    data-ai-fallback-policy="${row.ending === "ai_fallback" ? "writer-ending-missing-only" : "writer-route-wins"}"
                    data-writer-ending-configured="${row.ending === "ai_fallback" ? "false" : "true"}"
                    data-provider-generated-at-intake="false"
                  >
                    <td>${escapeHtml(localText(row.sceneLabel, localeCode))}</td>
                    <td>${escapeHtml(localText(row.branchLabel, localeCode))}</td>
                    <td data-ending-type="${escapeHtml(row.ending)}">${escapeHtml(endingLabel(qa, row.ending))}</td>
                    <td>${escapeHtml(row.part)}</td>
                    <td>${escapeHtml(row.summary)}</td>
                    <td>${escapeHtml(locale.importState[row.state])}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
          <ul class="su-import-flags">
            ${locale.importFlags.map((flag) => `<li>${escapeHtml(flag)}</li>`).join("")}
          </ul>
          <button type="button" class="su-import-save" disabled aria-disabled="true">${escapeHtml(locale.importSave)}</button>
        </section>
      </div>
    `;

    root.querySelectorAll("[data-su-locale]").forEach((button) => {
      button.addEventListener("click", () => renderUploadWorkspace(button.dataset.suLocale));
    });
  }

  window.renderUploadWorkspace = renderUploadWorkspace;
  renderUploadWorkspace("ko");
})();
