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
      eyebrow: "Story upload",
      meta: "작품 기본 정보",
      scenes: "장면 목록",
      endings: "엔딩 요약",
      form: "장면 입력",
      import: "가져오기 미리보기",
      statusTitle: "검수 상태",
      status: {
        draft: "작성 중",
        needs_revision: "수정 필요",
        pm_review: "PM 검수",
        locale_ready: "다국어 준비",
        qa_ready: "QA 준비",
        publish_ready: "발행 준비",
        blocked: "막힘",
      },
      statusHint: {
        draft: "작가가 원고와 장면 정보를 정리 중이에요.",
        needs_revision: "수정 요청을 확인하고 장면 정보를 보완해요.",
        pm_review: "PM이 저작권과 구조를 확인 중이에요.",
        locale_ready: "에밀리가 다국어 문구와 길이를 확인해요.",
        qa_ready: "뷰어와 큐알이 모바일 화면을 확인해요.",
        publish_ready: "발행 전 최종 확인만 남았어요.",
        blocked: "막힌 사유를 확인해야 다음 단계로 갈 수 있어요.",
      },
      handoff: ["에밀리 다국어", "뷰어 visual", "큐알 QA"],
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
        authorSub: "작가 서브",
        ai: "AI 엔딩",
        subCount: "서브 엔딩",
      },
      importHead: ["장면", "분기", "엔딩", "배경", "등장", "상태"],
      importState: {
        ok: "확인됨",
        missing: "누락",
        copyright: "저작권 확인",
        pm: "PM 확인",
      },
      importFlags: [
        "배경/등장 누락 항목이 있어요.",
        "저작권 확인이 필요해요.",
        "PM 확인이 필요해요.",
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
        pm_review: "PM review",
        locale_ready: "Locale ready",
        qa_ready: "QA ready",
        publish_ready: "Ready",
        blocked: "Blocked",
      },
      statusHint: {
        draft: "The writer is preparing manuscript and scene notes.",
        needs_revision: "Review requested changes before the next pass.",
        pm_review: "PM is checking copyright and structure.",
        locale_ready: "Emily checks localized copy and text length.",
        qa_ready: "Viewer and QA check mobile screens.",
        publish_ready: "Only final confirmation remains.",
        blocked: "Resolve the blocking reason before moving on.",
      },
      handoff: ["Emily locale", "Viewer visual", "QA mobile"],
      labels: {
        storyTitle: "Title",
        genre: "Genre",
        free: "Free status",
        minimum: "Minimum",
        sceneId: "Scene ID",
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
        pm: "PM check",
      },
      importFlags: [
        "Some background or cast fields are missing.",
        "Copyright review is required.",
        "PM confirmation is required.",
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
      },
    },
    ja: {
      title: "作品アップロード",
      eyebrow: "Story upload",
      meta: "作品基本情報",
      scenes: "シーン一覧",
      endings: "エンディング要約",
      form: "シーン入力",
      import: "取り込みプレビュー",
      statusTitle: "確認ステータス",
      status: {
        draft: "作成中",
        needs_revision: "修正必要",
        pm_review: "PM確認",
        locale_ready: "多言語準備",
        qa_ready: "QA準備",
        publish_ready: "公開準備",
        blocked: "停止中",
      },
      statusHint: {
        draft: "作家が原稿とシーン情報を整理しています。",
        needs_revision: "修正依頼を確認して補完します。",
        pm_review: "PMが著作権と構成を確認しています。",
        locale_ready: "エミリーが多言語文言と長さを確認します。",
        qa_ready: "ビューアとQAがモバイル画面を確認します。",
        publish_ready: "公開前の最終確認だけが残っています。",
        blocked: "停止理由の確認が必要です。",
      },
      handoff: ["エミリー多言語", "ビューア確認", "QA確認"],
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
        pm: "PM確認",
      },
      importFlags: [
        "背景または登場人物に不足があります。",
        "著作権確認が必要です。",
        "PM確認が必要です。",
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
      },
    },
    "zh-Hans": {
      title: "作品上传",
      eyebrow: "Story upload",
      meta: "作品信息",
      scenes: "场景列表",
      endings: "结局摘要",
      form: "场景输入",
      import: "导入预览",
      statusTitle: "审核状态",
      status: {
        draft: "编写中",
        needs_revision: "需修改",
        pm_review: "PM审核",
        locale_ready: "多语言准备",
        qa_ready: "QA准备",
        publish_ready: "待发布",
        blocked: "受阻",
      },
      statusHint: {
        draft: "作者正在整理稿件和场景信息。",
        needs_revision: "请确认修改请求并补充信息。",
        pm_review: "PM正在确认版权和结构。",
        locale_ready: "Emily确认多语言文案和长度。",
        qa_ready: "Viewer和QA确认移动端画面。",
        publish_ready: "只剩发布前最终确认。",
        blocked: "需要先确认阻塞原因。",
      },
      handoff: ["Emily多语言", "Viewer视觉", "QA移动端"],
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
        pm: "PM确认",
      },
      importFlags: [
        "存在背景或登场角色缺失项。",
        "需要进行版权确认。",
        "需要PM确认。",
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
      },
    },
    "zh-Hant": {
      title: "作品上傳",
      eyebrow: "Story upload",
      meta: "作品資訊",
      scenes: "場景列表",
      endings: "結局摘要",
      form: "場景輸入",
      import: "匯入預覽",
      statusTitle: "審核狀態",
      status: {
        draft: "撰寫中",
        needs_revision: "需修改",
        pm_review: "PM審核",
        locale_ready: "多語準備",
        qa_ready: "QA準備",
        publish_ready: "待發布",
        blocked: "受阻",
      },
      statusHint: {
        draft: "作者正在整理稿件與場景資訊。",
        needs_revision: "請確認修改要求並補充資訊。",
        pm_review: "PM正在確認版權與結構。",
        locale_ready: "Emily確認多語文案與長度。",
        qa_ready: "Viewer與QA確認行動版畫面。",
        publish_ready: "只剩發布前最終確認。",
        blocked: "需要先確認阻塞原因。",
      },
      handoff: ["Emily多語", "Viewer視覺", "QA行動版"],
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
        pm: "PM確認",
      },
      importFlags: [
        "存在背景或登場角色缺失項。",
        "需要進行版權確認。",
        "需要PM確認。",
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
      referenceTitle: "PM/QA reference",
      referenceNote: "검수자가 확인하는 읽기 전용 위치예요. 서비스 CTA가 아니며 저장하지 않아요.",
      referenceLinks: [
        { label: "Daily board", href: "/story-upload?cloudQa=pm-daily" },
        { label: "Story upload", href: "/story-upload?cloudQa=upload-panel" },
        { label: "Scene preview", href: "/story-stage?sceneFixture=1" },
      ],
      importHead: ["Scene ID", "Branch ID", "Ending type", "Part count", "Branch summary limit", "State"],
      choices: [
        { label: "A", tone: "info", text: "기록을 먼저 확인한다", next: "S05", result: "정보 + 신뢰 상승", rejoin: "S09 재합류", tags: ["정보", "신뢰"] },
        { label: "B", tone: "risk", text: "전령을 따라간다", next: "S06", result: "위험 + 아이템 획득", rejoin: "S09 재합류", tags: ["위험", "아이템"] },
        { label: "C", tone: "ending", text: "해안으로 우회한다", next: "S07", result: "관계 변화 + AI fallback 조건", rejoin: "E-AI 후보", tags: ["관계", "엔딩"] },
      ],
      endings: ["E-MAIN · 작가 기본 엔딩", "E-SUB · 작가 서브 엔딩", "E-AI · AI fallback 엔딩"],
      endingCards: [
        { type: "author_main", title: "작가 기본 엔딩", body: "작가가 지정한 중심 루트의 결말이에요." },
        { type: "author_sub", title: "작가 서브 엔딩", body: "작가가 별도로 준비한 선택 루트 결말이에요." },
        { type: "ai", title: "AI fallback 엔딩", body: "작가 엔딩이 없는 보조 분기에서만 임시로 이어져요." },
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
      onboardingBody: "Write the long manuscript first, then mark only the branch points as choices.",
      onboardingSteps: ["Manuscript", "Branch points", "Scene links"],
      referenceTitle: "PM/QA reference",
      referenceNote: "Read-only checkpoints for reviewers. These are not service CTAs and nothing is saved.",
      referenceLinks: [
        { label: "Daily board", href: "/story-upload?cloudQa=pm-daily" },
        { label: "Story upload", href: "/story-upload?cloudQa=upload-panel" },
        { label: "Scene preview", href: "/story-stage?sceneFixture=1" },
      ],
      importHead: ["Scene ID", "Branch ID", "Ending type", "Part count", "Branch summary limit", "State"],
      choices: [
        { label: "A", tone: "info", text: "Check the record first", next: "S05", result: "Info + trust up", rejoin: "Rejoins at S09", tags: ["Info", "Trust"] },
        { label: "B", tone: "risk", text: "Follow the messenger", next: "S06", result: "Risk + item gained", rejoin: "Rejoins at S09", tags: ["Risk", "Item"] },
        { label: "C", tone: "ending", text: "Detour to the shore", next: "S07", result: "Relation shift + AI fallback condition", rejoin: "E-AI candidate", tags: ["Relation", "Ending"] },
      ],
      endings: ["E-MAIN · Author main ending", "E-SUB · Author sub ending", "E-AI · AI fallback ending"],
      endingCards: [
        { type: "author_main", title: "Author main ending", body: "The writer's primary route ending." },
        { type: "author_sub", title: "Author sub ending", body: "A writer-prepared ending for a side route." },
        { type: "ai", title: "AI fallback ending", body: "A helper ending only for branches without writer endings." },
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
      onboardingBody: "長い本文原稿を先に書き、分岐点だけを選択肢として示します。",
      onboardingSteps: ["本文原稿", "分岐点", "シーン接続"],
      referenceTitle: "PM/QA reference",
      referenceNote: "検収担当者向けの読み取り専用位置です。サービスCTAではなく保存もしません。",
      referenceLinks: [
        { label: "Daily board", href: "/story-upload?cloudQa=pm-daily" },
        { label: "Story upload", href: "/story-upload?cloudQa=upload-panel" },
        { label: "Scene preview", href: "/story-stage?sceneFixture=1" },
      ],
      importHead: ["Scene ID", "Branch ID", "Ending type", "Part count", "Branch summary limit", "State"],
      choices: [
        { label: "A", tone: "info", text: "記録を先に確認する", next: "S05", result: "情報 + 信頼上昇", rejoin: "S09で再合流", tags: ["情報", "信頼"] },
        { label: "B", tone: "risk", text: "伝令について行く", next: "S06", result: "危険 + アイテム取得", rejoin: "S09で再合流", tags: ["危険", "アイテム"] },
        { label: "C", tone: "ending", text: "海岸へ迂回する", next: "S07", result: "関係変化 + AI fallback条件", rejoin: "E-AI候補", tags: ["関係", "終了"] },
      ],
      endings: ["E-MAIN · 作家基本終了", "E-SUB · 作家サブ終了", "E-AI · AI fallback終了"],
      endingCards: [
        { type: "author_main", title: "作家基本終了", body: "作家が指定した中心ルートの結末です。" },
        { type: "author_sub", title: "作家サブ終了", body: "作家が別途用意した選択ルートの結末です。" },
        { type: "ai", title: "AI fallback終了", body: "作家終了がない補助分岐でだけ一時的に続きます。" },
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
      referenceTitle: "PM/QA reference",
      referenceNote: "供检收人员查看的只读位置。不是服务CTA，也不会保存。",
      referenceLinks: [
        { label: "Daily board", href: "/story-upload?cloudQa=pm-daily" },
        { label: "Story upload", href: "/story-upload?cloudQa=upload-panel" },
        { label: "Scene preview", href: "/story-stage?sceneFixture=1" },
      ],
      importHead: ["Scene ID", "Branch ID", "Ending type", "Part count", "Branch summary limit", "State"],
      choices: [
        { label: "A", tone: "info", text: "先确认记录", next: "S05", result: "信息 + 信任提升", rejoin: "S09再汇合", tags: ["信息", "信任"] },
        { label: "B", tone: "risk", text: "跟随传令", next: "S06", result: "风险 + 获得道具", rejoin: "S09再汇合", tags: ["风险", "道具"] },
        { label: "C", tone: "ending", text: "绕到海岸", next: "S07", result: "关系变化 + AI fallback条件", rejoin: "E-AI候选", tags: ["关系", "结局"] },
      ],
      endings: ["E-MAIN · 作者主线结局", "E-SUB · 作者支线结局", "E-AI · AI fallback结局"],
      endingCards: [
        { type: "author_main", title: "作者主线结局", body: "作者指定的主路线结局。" },
        { type: "author_sub", title: "作者支线结局", body: "作者另外准备的选择路线结局。" },
        { type: "ai", title: "AI fallback结局", body: "只在没有作者结局的辅助分支中临时衔接。" },
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
      referenceTitle: "PM/QA reference",
      referenceNote: "供檢收人員查看的唯讀位置。不是服務CTA，也不會儲存。",
      referenceLinks: [
        { label: "Daily board", href: "/story-upload?cloudQa=pm-daily" },
        { label: "Story upload", href: "/story-upload?cloudQa=upload-panel" },
        { label: "Scene preview", href: "/story-stage?sceneFixture=1" },
      ],
      importHead: ["Scene ID", "Branch ID", "Ending type", "Part count", "Branch summary limit", "State"],
      choices: [
        { label: "A", tone: "info", text: "先確認記錄", next: "S05", result: "資訊 + 信任提升", rejoin: "S09再匯合", tags: ["資訊", "信任"] },
        { label: "B", tone: "risk", text: "跟隨傳令", next: "S06", result: "風險 + 獲得道具", rejoin: "S09再匯合", tags: ["風險", "道具"] },
        { label: "C", tone: "ending", text: "繞到海岸", next: "S07", result: "關係變化 + AI fallback條件", rejoin: "E-AI候選", tags: ["關係", "結局"] },
      ],
      endings: ["E-MAIN · 作者主線結局", "E-SUB · 作者支線結局", "E-AI · AI fallback結局"],
      endingCards: [
        { type: "author_main", title: "作者主線結局", body: "作者指定的主路線結局。" },
        { type: "author_sub", title: "作者支線結局", body: "作者另外準備的選擇路線結局。" },
        { type: "ai", title: "AI fallback結局", body: "只在沒有作者結局的輔助分支中臨時銜接。" },
      ],
    },
  };

  const sampleScenes = [
    { id: "S01", title: "기록의 방", state: "pm_review" },
    { id: "S02", title: "첫 분기", state: "locale_ready" },
    { id: "S03", title: "공통 장면", state: "qa_ready" },
    { id: "S09", title: "재합류 장면", state: "qa_ready" },
  ];

  const importRows = [
    { scene: "S01", branch: "ROOT", ending: "author_main", part: "10", summary: "<= 2,000", state: "ok" },
    { scene: "S05", branch: "B-A", ending: "author_sub", part: "10", summary: "<= 2,000", state: "ok" },
    { scene: "S07", branch: "B-C", ending: "ai_fallback", part: "10", summary: "<= 2,000", state: "pm" },
  ];

  const aiFallbackEvidence = {
    branch: "B-C",
    ending: "ai_fallback",
    policy: "writer-ending-missing-only",
    writerEndingConfigured: "false",
    fallbackReasonKey: "storyUpload.ending.aiFallback.writerMissing",
    providerGeneratedAtIntake: "false",
  };

  const endingValidationEvidence = {
    authorMainCount: "1",
    authorSubCount: "2",
    authorSubMin: "2",
    authorSubMax: "10",
    aiFallbackPolicy: aiFallbackEvidence.policy,
    writerEndingConfigured: aiFallbackEvidence.writerEndingConfigured,
    providerGeneratedAtIntake: aiFallbackEvidence.providerGeneratedAtIntake,
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

  function renderUploadWorkspace(localeCode) {
    const locale = UI[localeCode] || UI.ko;
    const qa = QA_COPY[localeCode] || QA_COPY.ko;
    document.documentElement.lang = localeMap[localeCode] || "ko-KR";

    root.innerHTML = `
      <div class="su-shell">
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

        <section class="su-grid">
          <div class="su-section">
            <h2>${escapeHtml(locale.scenes)}</h2>
            <ul class="su-scene-list">
              ${sampleScenes.map((scene) => `<li class="su-scene-item"><span>${escapeHtml(scene.id)}</span><strong>${escapeHtml(scene.title)} · ${escapeHtml(locale.status[scene.state])}</strong></li>`).join("")}
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
                data-provider-generated-at-intake="false">
              <dt>AI fallback condition</dt>
              <dd>writer ending missing only · allowed only when the writer has not configured an ending for this branch.</dd>
              <dt>Branch evidence</dt>
              <dd>${escapeHtml(aiFallbackEvidence.branch)} · ${escapeHtml(aiFallbackEvidence.policy)} · ${escapeHtml(aiFallbackEvidence.fallbackReasonKey)}</dd>
              <dt>Provider generation</dt>
              <dd>${escapeHtml(aiFallbackEvidence.providerGeneratedAtIntake)}</dd>
            </dl>
            <dl class="su-ending-validation-evidence"
                data-author-main-count="${escapeHtml(endingValidationEvidence.authorMainCount)}"
                data-author-sub-count="${escapeHtml(endingValidationEvidence.authorSubCount)}"
                data-author-sub-min="${escapeHtml(endingValidationEvidence.authorSubMin)}"
                data-author-sub-max="${escapeHtml(endingValidationEvidence.authorSubMax)}"
                data-ai-fallback-policy="${escapeHtml(endingValidationEvidence.aiFallbackPolicy)}"
                data-writer-ending-configured="${escapeHtml(endingValidationEvidence.writerEndingConfigured)}"
                data-provider-generated-at-intake="${escapeHtml(endingValidationEvidence.providerGeneratedAtIntake)}">
              <dt>Author ending count</dt>
              <dd>author_main exact ${escapeHtml(endingValidationEvidence.authorMainCount)} · author_sub ${escapeHtml(endingValidationEvidence.authorSubMin)}-${escapeHtml(endingValidationEvidence.authorSubMax)} when provided</dd>
              <dt>AI fallback evidence</dt>
              <dd>${escapeHtml(endingValidationEvidence.aiFallbackPolicy)} · writerEndingConfigured=${escapeHtml(endingValidationEvidence.writerEndingConfigured)} · providerGeneratedAtIntake=${escapeHtml(endingValidationEvidence.providerGeneratedAtIntake)}</dd>
            </dl>
          </div>
        </section>

        <section class="su-section">
          <h2>${escapeHtml(locale.form)}</h2>
          <form class="su-scene-form" aria-label="Scene upload preview form">
            <div class="su-row">
              <label class="su-field"><span>${escapeHtml(locale.labels.sceneId)}</span><input name="sceneId" value="S04" readonly /></label>
              <label class="su-field"><span>${escapeHtml(locale.labels.sceneTitle)}</span><input name="sceneTitle" value="새 분기 장면" readonly /></label>
            </div>
            <details open>
              <summary>${escapeHtml(locale.labels.background)}</summary>
              <div>
                <textarea name="background" rows="2" readonly>${escapeHtml(locale.sample.background)}</textarea>
                <input name="bgImageMemo" value="${escapeHtml(locale.sample.bgMemo)}" readonly />
              </div>
            </details>
            <details>
              <summary>${escapeHtml(locale.labels.cast)}</summary>
              <div><input value="이순신, 기록관, 전령" readonly /></div>
            </details>
            <label class="su-field"><span>${escapeHtml(locale.labels.body)}</span><textarea name="body" rows="8" class="su-body" readonly>${escapeHtml(locale.sample.body)}</textarea></label>
            <div class="su-choices" aria-label="${escapeHtml(locale.labels.choices)}">
              ${qa.choices.map((choice) => `<div class="su-choice-row"><input value="${escapeHtml(choice.label)}" readonly /><input value="${escapeHtml(choice.text)}" readonly /><input value="${escapeHtml(choice.next)}" readonly /></div>`).join("")}
              <button class="su-action" type="button" disabled aria-disabled="true">${escapeHtml(locale.labels.addChoice)}</button>
            </div>
            <div class="su-row">
              <label class="su-field"><span>${escapeHtml(locale.labels.nextScene)}</span><input name="nextScene" value="S05" readonly /></label>
              <label class="su-field"><span>${escapeHtml(locale.labels.endingLink)}</span><input value="E-S1" readonly /></label>
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
                  <tr>
                    <td>${escapeHtml(row.scene)}</td>
                    <td>${escapeHtml(row.branch)}</td>
                    <td>${escapeHtml(row.ending)}</td>
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
