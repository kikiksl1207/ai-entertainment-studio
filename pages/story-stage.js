(function initStoryStagePage() {
  "use strict";

  const STORY_FIXTURE = Object.freeze({
    prologue: {
      title: "무료 프롤로그",
      summary: "계정당 1회, 본인 또는 동반 캐릭터 한 명과 함께 첫 이야기를 무료로 열어볼 수 있어요.",
      runtime: "약 10분 분량",
      freePerAccount: 1,
      companionMax: 1,
    },
    chapters: [
      { no: 1, title: "첫 무대의 떨림", priceLumina: 120, summary: "데뷔 직전, 무대 뒤에서 시작되는 첫 장면." },
      { no: 2, title: "흔들리는 스포트라이트", priceLumina: 150, summary: "예상치 못한 사고로 달라지는 선택." },
      { no: 3, title: "다시, 처음처럼", priceLumina: 150, summary: "무너진 자리에서 다시 서로를 마주하는 순간." },
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
    reactions: {
      chapters: [
        { no: 1, rating: 4.7, readers: 312, comments: 48 },
        { no: 2, rating: 4.5, readers: 268, comments: 33 },
        { no: 3, rating: 4.8, readers: 241, comments: 51 },
      ],
      storyComments: [
        { author: "별빛_수아", paid: true, completed: true, text: "프롤로그만 보려다 시즌까지 갔어요. 장면마다 분위기가 달라서 몰입돼요." },
        { author: "조용한 관객", paid: true, completed: false, text: "챕터마다 선택지가 달라지는 게 좋아요. 다음 장면을 기다리게 돼요." },
        { author: "오늘의러너", paid: true, completed: true, text: "캐릭터가 없는 장면도 배경이 바뀌니까 흐름이 끊기지 않았어요." },
      ],
    },
  });

  const STORY_SCENE_COPY = Object.freeze({
    "storyStage.scene.assetFallback.default": {
      "ko-KR": "장면 연출을 준비 중이에요.",
      "ja-JP": "シーン演出を準備中です。",
      "en-US": "Preparing scene visuals.",
      "zh-CN": "正在准备场景演出。",
      "zh-Hant": "正在準備場景演出。",
    },
    "storyStage.scene.background.loading": {
      "ko-KR": "배경을 불러오는 중이에요.",
      "ja-JP": "背景を読み込み中です。",
      "en-US": "Loading background.",
      "zh-CN": "正在加载背景。",
      "zh-Hant": "正在載入背景。",
    },
    "storyStage.scene.background.missing": {
      "ko-KR": "기본 배경으로 장면을 이어갈게요.",
      "ja-JP": "基本の背景で続けます。",
      "en-US": "Using default background.",
      "zh-CN": "使用默认背景继续。",
      "zh-Hant": "使用預設背景繼續。",
    },
    "storyStage.scene.background.altDefault": {
      "ko-KR": "스토리 기본 배경",
      "ja-JP": "ストーリー基本背景",
      "en-US": "Default background",
      "zh-CN": "故事默认背景",
      "zh-Hant": "故事預設背景",
    },
    "storyStage.scene.character.loading": {
      "ko-KR": "캐릭터를 불러오는 중이에요.",
      "ja-JP": "キャラクターを読み込み中です。",
      "en-US": "Loading character.",
      "zh-CN": "正在加载角色。",
      "zh-Hant": "正在載入角色。",
    },
    "storyStage.scene.character.missing": {
      "ko-KR": "캐릭터 없이 장면을 이어갈게요.",
      "ja-JP": "キャラクターなしで続けます。",
      "en-US": "No character in this scene.",
      "zh-CN": "本场景没有角色。",
      "zh-Hant": "本場景沒有角色。",
    },
    "storyStage.scene.character.altDefault": {
      "ko-KR": "캐릭터 기본 이미지",
      "ja-JP": "キャラクター基本画像",
      "en-US": "Default character",
      "zh-CN": "角色默认图片",
      "zh-Hant": "角色預設圖片",
    },
    "storyStage.scene.visual.unavailable": {
      "ko-KR": "장면 연출을 불러오지 못했어요.",
      "ja-JP": "シーン演出を読み込めませんでした。",
      "en-US": "Scene could not load.",
      "zh-CN": "无法加载场景演出。",
      "zh-Hant": "無法載入場景演出。",
    },
    "storyStage.scene.preview.prev": {
      "ko-KR": "이전 장면",
      "ja-JP": "前のシーン",
      "en-US": "Previous scene",
      "zh-CN": "上一场景",
      "zh-Hant": "上一場景",
    },
    "storyStage.scene.preview.next": {
      "ko-KR": "다음 장면",
      "ja-JP": "次のシーン",
      "en-US": "Next scene",
      "zh-CN": "下一场景",
      "zh-Hant": "下一場景",
    },
    "storyStage.scene.retry": {
      "ko-KR": "다시 시도",
      "ja-JP": "再試行",
      "en-US": "Retry",
      "zh-CN": "重试",
      "zh-Hant": "重試",
    },
    "storyStage.preview.notice.title": {
      "ko-KR": "미리보기 화면",
      "ja-JP": "プレビュー画面",
      "en-US": "Preview screen",
      "zh-CN": "预览画面",
      "zh-Hant": "預覽畫面",
    },
    "storyStage.preview.notice.body": {
      "ko-KR": "이 화면은 저장되지 않는 읽기 전용 미리보기예요.",
      "ja-JP": "この画面は保存されない読み取り専用プレビューです。",
      "en-US": "This is a read-only preview and nothing is saved.",
      "zh-CN": "这是不会保存内容的只读预览。",
      "zh-Hant": "這是不會儲存內容的唯讀預覽。",
    },
    "storyStage.setup.visibility.private": {
      "ko-KR": "나만 보는 미리보기",
      "ja-JP": "自分だけのプレビュー",
      "en-US": "Private preview",
      "zh-CN": "仅自己可见的预览",
      "zh-Hant": "僅自己可見的預覽",
    },
    "storyStage.setup.eyebrow": {
      "ko-KR": "나 + AI",
      "ja-JP": "自分 + AI",
      "en-US": "Me + AI",
      "zh-CN": "我 + AI",
      "zh-Hant": "我 + AI",
    },
    "storyStage.scene.fixture.01": {
      "ko-KR": "첫 리허설 조명이 켜지고, 도현이 무대 중앙으로 걸어 나옵니다.",
      "ja-JP": "最初のリハーサル照明が灯り、ドヒョンがステージ中央へ歩き出します。",
      "en-US": "The first rehearsal light turns on, and Dohyun walks to center stage.",
      "zh-CN": "第一次排练灯亮起，道贤走向舞台中央。",
      "zh-Hant": "第一次排練燈亮起，道賢走向舞台中央。",
    },
    "storyStage.scene.fixture.02": {
      "ko-KR": "객석 불빛만 남은 장면입니다. 캐릭터 없이 감정의 여백을 보여줍니다.",
      "ja-JP": "客席の灯りだけが残るシーンです。キャラクターなしで余韻を見せます。",
      "en-US": "Only the audience lights remain, leaving room for the emotion without a character.",
      "zh-CN": "只剩观众席的灯光，没有角色也保留情绪的余白。",
      "zh-Hant": "只剩觀眾席的燈光，沒有角色也保留情緒的餘白。",
    },
    "storyStage.scene.fixture.03": {
      "ko-KR": "배경 에셋이 아직 준비되지 않아도 기본 장면으로 이야기를 이어갑니다.",
      "ja-JP": "背景アセットが未準備でも、基本シーンで物語を続けます。",
      "en-US": "If a background asset is not ready, the story continues with the default scene.",
      "zh-CN": "即使背景素材尚未准备好，也会用默认场景继续故事。",
      "zh-Hant": "即使背景素材尚未準備好，也會用預設場景繼續故事。",
    },
    "storyStage.branch.title": {
      "ko-KR": "분기 결과 카드",
      "ja-JP": "分岐結果カード",
      "en-US": "Branch result cards",
      "zh-CN": "分支结果卡",
      "zh-Hant": "分支結果卡",
    },
    "storyStage.branch.note": {
      "ko-KR": "재합류 전까지 사건, 관계, 위험, 정보, 아이템, 엔딩 조건 차이를 남겨요.",
      "ja-JP": "再合流前まで事件、関係、危険、情報、アイテム、終了条件の差を残します。",
      "en-US": "Each choice keeps event, relation, risk, info, item, and ending-condition differences before rejoining.",
      "zh-CN": "再汇合前保留事件、关系、风险、信息、道具和结局条件差异。",
      "zh-Hant": "再匯合前保留事件、關係、風險、資訊、道具和結局條件差異。",
    },
    "storyStage.branch.a.title": {
      "ko-KR": "기록을 먼저 확인",
      "ja-JP": "記録を先に確認",
      "en-US": "Check the record first",
      "zh-CN": "先确认记录",
      "zh-Hant": "先確認記錄",
    },
    "storyStage.branch.a.outcome": {
      "ko-KR": "숨은 정보가 열리고 전령의 신뢰가 올라가요.",
      "ja-JP": "隠れた情報が開き、伝令の信頼が上がります。",
      "en-US": "Hidden information opens and the messenger trusts you more.",
      "zh-CN": "隐藏信息开启，传令对你的信任提升。",
      "zh-Hant": "隱藏資訊開啟，傳令對你的信任提升。",
    },
    "storyStage.branch.a.rejoin": {
      "ko-KR": "S09 재합류 · 정보 조건 유지",
      "ja-JP": "S09で再合流 · 情報条件を維持",
      "en-US": "Rejoins at S09 · info condition kept",
      "zh-CN": "S09再汇合 · 保留信息条件",
      "zh-Hant": "S09再匯合 · 保留資訊條件",
    },
    "storyStage.branch.b.title": {
      "ko-KR": "전령을 따라 이동",
      "ja-JP": "伝令について移動",
      "en-US": "Follow the messenger",
      "zh-CN": "跟随传令移动",
      "zh-Hant": "跟隨傳令移動",
    },
    "storyStage.branch.b.outcome": {
      "ko-KR": "위험도가 오르지만 봉인된 지도를 얻어요.",
      "ja-JP": "危険度は上がりますが、封じられた地図を得ます。",
      "en-US": "Risk rises, but you gain the sealed map item.",
      "zh-CN": "风险上升，但获得封存地图道具。",
      "zh-Hant": "風險上升，但獲得封存地圖道具。",
    },
    "storyStage.branch.b.rejoin": {
      "ko-KR": "S09 재합류 · 아이템 조건 유지",
      "ja-JP": "S09で再合流 · アイテム条件を維持",
      "en-US": "Rejoins at S09 · item condition kept",
      "zh-CN": "S09再汇合 · 保留道具条件",
      "zh-Hant": "S09再匯合 · 保留道具條件",
    },
    "storyStage.branch.c.title": {
      "ko-KR": "해안으로 우회",
      "ja-JP": "海岸へ迂回",
      "en-US": "Detour to the shore",
      "zh-CN": "绕到海岸",
      "zh-Hant": "繞到海岸",
    },
    "storyStage.branch.c.outcome": {
      "ko-KR": "관계가 흔들리고 작가 결말이 없을 때만 AI 보조 결말 후보가 돼요.",
      "ja-JP": "関係が揺れ、作家終了がない場合だけAI補助終了候補になります。",
      "en-US": "The relation shifts, and an AI-assisted ending is only a candidate when no writer ending exists.",
      "zh-CN": "关系变化，只有没有作者结局时才成为AI辅助结局候选。",
      "zh-Hant": "關係變化，只有沒有作者結局時才成為AI輔助結局候選。",
    },
    "storyStage.branch.c.rejoin": {
      "ko-KR": "AI 보조 결말 후보 · 작가 결말이 없을 때만",
      "ja-JP": "AI補助終了候補 · 作家終了がない場合のみ",
      "en-US": "AI-assisted ending candidate · only when no writer ending exists",
      "zh-CN": "AI辅助结局候选 · 仅在没有作者结局时",
      "zh-Hant": "AI輔助結局候選 · 僅在沒有作者結局時",
    },
    "storyStage.branch.tag.event": {
      "ko-KR": "사건",
      "ja-JP": "事件",
      "en-US": "Event",
      "zh-CN": "事件",
      "zh-Hant": "事件",
    },
    "storyStage.branch.tag.relation": {
      "ko-KR": "관계",
      "ja-JP": "関係",
      "en-US": "Relation",
      "zh-CN": "关系",
      "zh-Hant": "關係",
    },
    "storyStage.branch.tag.risk": {
      "ko-KR": "위험",
      "ja-JP": "危険",
      "en-US": "Risk",
      "zh-CN": "风险",
      "zh-Hant": "風險",
    },
    "storyStage.branch.tag.info": {
      "ko-KR": "정보",
      "ja-JP": "情報",
      "en-US": "Info",
      "zh-CN": "信息",
      "zh-Hant": "資訊",
    },
    "storyStage.branch.tag.item": {
      "ko-KR": "아이템",
      "ja-JP": "アイテム",
      "en-US": "Item",
      "zh-CN": "道具",
      "zh-Hant": "道具",
    },
    "storyStage.branch.tag.ending": {
      "ko-KR": "엔딩 조건",
      "ja-JP": "終了条件",
      "en-US": "Ending condition",
      "zh-CN": "结局条件",
      "zh-Hant": "結局條件",
    },
  });

  const STORY_LOCALES = [
    { code: "ko", label: "KO" },
    { code: "en", label: "EN" },
    { code: "ja", label: "JA" },
    { code: "zh-Hans", label: "简" },
    { code: "zh-Hant", label: "繁" },
  ];

  const STORY_DISCOVERY_ITEMS = [
    {
      id: "imjin",
      titleKey: "storyStage.discovery.card.imjin.title",
      summaryKey: "storyStage.discovery.card.imjin.summary",
      statusKey: "storyStage.discovery.status.free",
      tags: ["History", "Tutorial"],
      metric: "4.8 · 1.2k",
      startLabel: "무료 프롤로그 시작",
      startSetting: "무료 프롤로그 · 동반 AI 1명 · 비공개 미리보기",
      updateText: "최근 장면/선택지 검수 완료",
      creator: "Cha Dohyun",
      similarTitleKey: "storyStage.discovery.card.stage.title",
      image: "/assets/brand/lumina-stage-banner.png",
    },
    {
      id: "stage",
      titleKey: "storyStage.discovery.card.stage.title",
      summaryKey: "storyStage.discovery.card.stage.summary",
      statusKey: "storyStage.discovery.status.ready",
      tags: ["Stage", "AI"],
      metric: "4.7 · 840",
      startLabel: "장면 미리보기",
      startSetting: "무료 시작 · 나 또는 AI 1명 · 저장 없는 preview",
      updateText: "신규 무대 배경 QA 완료",
      creator: "Cha Dohyun",
      similarTitleKey: "storyStage.discovery.card.imjin.title",
      image: "/assets/characters/cha-dohyun/reference-final-03.png",
    },
    {
      id: "myth",
      titleKey: "storyStage.discovery.card.myth.title",
      summaryKey: "storyStage.discovery.card.myth.summary",
      statusKey: "storyStage.discovery.status.ready",
      tags: ["Myth", "Safe"],
      metric: "4.6 · 620",
      startLabel: "안전 미리보기",
      startSetting: "읽기 전용 · 동반 AI 1명 · 구매 없음",
      updateText: "민감값/원문 노출 점검 완료",
      creator: "Choi Seojin",
      similarTitleKey: "storyStage.discovery.card.imjin.title",
      image: "/assets/characters/choi-seojin/cover.png",
    },
  ];

  const STORY_SCENE_FALLBACKS = [
    {
      sceneId: "fixture-scene-01",
      sceneTextKey: "storyStage.scene.fixture.01",
      sceneText: "첫 리허설 조명이 켜지고, 도현이 무대 중앙으로 걸어 나옵니다.",
      backgroundState: "ready",
      backgroundAsset: {
        assetId: "scene.background.rehearsal",
        url: "/assets/brand/lumina-stage-banner.png",
        labelKey: "storyStage.scene.background.altDefault",
      },
      fallbackKey: "storyStage.scene.assetFallback.default",
      characters: [
        {
          characterId: "cha-dohyun",
          artistSlug: "cha-dohyun",
          displayNameKey: "storyStage.scene.character.altDefault",
          assetId: "character.cha-dohyun.reference",
          url: "/assets/characters/cha-dohyun/reference-final-03.png",
          characterPose: "neutral",
          characterLayer: "foreground",
          entranceState: "entered",
        },
      ],
    },
    {
      sceneId: "fixture-scene-02",
      sceneTextKey: "storyStage.scene.fixture.02",
      sceneText: "객석 불빛만 남은 장면입니다. 캐릭터 없이 감정의 여백을 보여줍니다.",
      backgroundState: "ready",
      backgroundAsset: {
        assetId: "scene.background.quiet-stage",
        url: "/assets/characters/choi-seojin/cover.png",
        labelKey: "storyStage.scene.background.altDefault",
      },
      fallbackKey: "storyStage.scene.character.missing",
      characters: [],
    },
    {
      sceneId: "fixture-scene-03",
      sceneTextKey: "storyStage.scene.fixture.03",
      sceneText: "배경 에셋이 아직 준비되지 않아도 기본 장면으로 이야기를 이어갑니다.",
      backgroundState: "fallback",
      backgroundAsset: null,
      fallbackKey: "storyStage.scene.background.missing",
      characters: [
        {
          characterId: "choi-seojin",
          artistSlug: "choi-seojin",
          displayNameKey: "storyStage.scene.character.altDefault",
          assetId: "character.choi-seojin.placeholder",
          url: "/assets/characters/choi-seojin/thumb.png",
          characterPose: "listening",
          characterLayer: "midground",
          entranceState: "entered",
        },
      ],
    },
  ];

  const STORY_BRANCH_FIXTURE = [
    {
      label: "A",
      tone: "info",
      next: "기록 경로",
      titleKey: "storyStage.branch.a.title",
      outcomeKey: "storyStage.branch.a.outcome",
      rejoinKey: "storyStage.branch.a.rejoin",
      tagKeys: ["storyStage.branch.tag.event", "storyStage.branch.tag.info", "storyStage.branch.tag.relation"],
    },
    {
      label: "B",
      tone: "risk",
      next: "항구 경로",
      titleKey: "storyStage.branch.b.title",
      outcomeKey: "storyStage.branch.b.outcome",
      rejoinKey: "storyStage.branch.b.rejoin",
      tagKeys: ["storyStage.branch.tag.event", "storyStage.branch.tag.risk", "storyStage.branch.tag.item"],
    },
    {
      label: "C",
      tone: "ending",
      next: "해안 경로",
      titleKey: "storyStage.branch.c.title",
      outcomeKey: "storyStage.branch.c.outcome",
      rejoinKey: "storyStage.branch.c.rejoin",
      tagKeys: ["storyStage.branch.tag.relation", "storyStage.branch.tag.risk", "storyStage.branch.tag.ending"],
    },
  ];

  const STORY_BRANCH_IMPLEMENTATION_FIXTURE = [
    {
      label: "A",
      choiceKey: "storyUpload.choice.recordFirst",
      nextSceneId: "S05",
      sceneTitle: "Archive map room",
      bodySummary: "The player checks the record first and unlocks a safer clue path.",
      bodySummaryLabel: "기록을 먼저 확인해 더 안전한 단서 경로를 엽니다.",
      stateDelta: "infoGained + trustUp",
      stateLabel: "정보 확보 · 신뢰 상승",
      endingRoute: "E-SUB-01",
      endingType: "writer_sub_ending",
      endingLabel: "작가 서브 엔딩",
      backgroundId: "bg-war-room-map",
      backgroundState: "bg-war-room-map",
      backgroundAssetUrl: "/assets/brand/lumina-stage-banner.png",
      characterAssetId: "character.cha-dohyun.reference-final-03",
      characterAssetLabel: "Cha Dohyun guide pose",
      characterImage: "/assets/characters/cha-dohyun/reference-final-03.png",
      userSceneLabel: "기록 보관실",
      stateLabel: "정보 확보 · 신뢰 상승",
      endingLabel: "작가 서브 엔딩",
      backgroundLabel: "작전 지도실",
      rejoinLabel: "S09에서 합류",
      eventSummary: "Record clue opens the map-room path.",
      eventLabel: "기록 단서가 열립니다.",
      relationSummary: "Messenger trust rises before rejoin.",
      relationLabel: "전령의 신뢰가 높아집니다.",
      riskSummary: "Low risk, safer evidence route.",
      riskLabel: "낮은 위험으로 증거를 확인합니다.",
      infoSummary: "Hidden archive clue unlocked.",
      infoLabel: "숨은 보관실 단서를 얻습니다.",
      endingCandidate: "Author sub ending E-SUB-01",
      endingCandidateLabel: "작가가 준비한 보조 결말 후보 E-SUB-01",
      chatLine: "The record room lights up. The safer clue path is open.",
      chatLineLabel: "기록 보관실에 불이 들어오고 안전한 단서 경로가 열립니다.",
      rejoin: "S09",
      rejoinLabel: "S09에서 합류",
    },
    {
      label: "B",
      choiceKey: "storyUpload.choice.followMessenger",
      nextSceneId: "S06",
      sceneTitle: "Night harbor pursuit",
      bodySummary: "The player follows the messenger and takes a higher-risk item route.",
      bodySummaryLabel: "전령을 따라가며 더 위험하지만 아이템을 얻는 경로로 이동합니다.",
      stateDelta: "riskRaised + itemGained",
      stateLabel: "위험 상승 · 아이템 확보",
      endingRoute: "E-SUB-02",
      endingType: "writer_sub_ending",
      endingLabel: "작가 서브 엔딩",
      backgroundId: "bg-harbor-night",
      backgroundState: "bg-harbor-night",
      backgroundAssetUrl: "/assets/characters/cha-dohyun/cover.png",
      characterAssetId: "character.cha-dohyun.reference-final-08",
      characterAssetLabel: "Cha Dohyun pursuit pose",
      characterImage: "/assets/characters/cha-dohyun/reference-final-08.png",
      userSceneLabel: "밤 항구 추적",
      stateLabel: "위험 상승 · 아이템 확보",
      endingLabel: "작가 서브 엔딩",
      backgroundLabel: "밤 항구",
      rejoinLabel: "S09에서 합류",
      eventSummary: "Messenger chase moves the scene to the harbor.",
      eventLabel: "전령을 따라 항구로 이동합니다.",
      relationSummary: "Trust is unstable but active.",
      relationLabel: "신뢰가 흔들리지만 관계는 이어집니다.",
      riskSummary: "High risk, item route gained.",
      riskLabel: "위험이 커지고 봉인된 지도를 얻습니다.",
      infoSummary: "Sealed map item acquired.",
      infoLabel: "봉인된 지도 아이템을 확보합니다.",
      endingCandidate: "Author sub ending E-SUB-02",
      endingCandidateLabel: "작가가 준비한 보조 결말 후보 E-SUB-02",
      chatLine: "The harbor wind cuts in. Following them raises the risk.",
      chatLineLabel: "항구 바람이 거세지고 추적 선택의 위험이 커집니다.",
      rejoin: "S09",
      rejoinLabel: "S09에서 합류",
    },
    {
      label: "C",
      choiceKey: "storyUpload.choice.shoreDetour",
      nextSceneId: "S07",
      sceneTitle: "Fog shore detour",
      bodySummary: "The player detours to the shore and enters an unresolved branch.",
      bodySummaryLabel: "해안으로 우회해 아직 결말 검토가 필요한 분기로 들어갑니다.",
      stateDelta: "relationshipShift + aiFallbackCondition",
      stateLabel: "관계 변화 · AI 후보 조건",
      endingRoute: "E-AI-01",
      endingType: "ai_fallback_ending",
      endingLabel: "AI 보조 결말",
      backgroundId: "bg-fog-shore",
      backgroundState: "bg-fog-shore",
      backgroundAssetUrl: "/assets/characters/choi-seojin/cover.png",
      characterAssetId: "none",
      characterAssetLabel: "No character in this branch",
      characterImage: "",
      userSceneLabel: "안개 낀 해안 우회",
      stateLabel: "관계 변화 · 보조 결말 검토",
      endingLabel: "AI 보조 결말",
      backgroundLabel: "안개 해안",
      rejoinLabel: "보조 결말 검토 전 합류 없음",
      eventSummary: "The detour splits away before the rejoin.",
      eventLabel: "우회로가 합류 전에 갈라집니다.",
      relationSummary: "Relationship shifts without a writer ending.",
      relationLabel: "작가 결말이 없어 관계 흐름이 바뀝니다.",
      riskSummary: "Medium risk, unresolved route.",
      riskLabel: "중간 위험의 미해결 경로입니다.",
      infoSummary: "Missing author ending is visible.",
      infoLabel: "작가 결말이 없는 분기임을 확인합니다.",
      endingCandidate: "AI 보조 결말 후보 E-AI-01",
      endingCandidateLabel: "작가 결말이 없을 때만 쓰는 보조 결말 후보 E-AI-01",
      chatLine: "The shore goes quiet. This branch needs helper ending review.",
      chatLineLabel: "해안이 조용해지고 이 분기는 보조 결말 검토가 필요합니다.",
      rejoin: "No rejoin before helper ending review",
      rejoinLabel: "보조 결말 검토 전 합류 없음",
    },
  ];

  const STORY_ENDING_MINI_MAP = [
    {
      tone: "main",
      title: "작가 기본 엔딩",
      routeLabel: "공통 루트",
      summary: "작가가 지정한 중심 결말입니다. 기본 흐름을 따라가면 이 결말을 먼저 확인합니다.",
      from: "프롤로그",
      to: "기본 결말",
      note: "작가 확정",
    },
    {
      tone: "sub",
      title: "작가 서브 엔딩",
      routeLabel: "선택 A/B",
      summary: "선택으로 갈라진 루트에 작가가 따로 준비한 결말입니다.",
      from: "분기 선택",
      to: "보조 결말",
      note: "선택 루트",
    },
    {
      tone: "ai",
      title: "AI 보조 결말",
      routeLabel: "작가 결말 없음",
      summary: "작가 결말이 없는 분기에서만 임시 후보로 안내합니다.",
      from: "미해결 분기",
      to: "보조 후보",
      note: "검수 필요",
    },
  ];

  const STORY_RUNTIME_BRIDGE_COPY = {
    "ko-KR": {
      stateTitle: "75파트 상태 브리지",
      stateBody: "선택지 3개가 점수 대신 사용자용 상태 요약으로 누적됩니다.",
      endingTitle: "엔딩 문단 조립 브리지",
      endingBody: "큰 엔딩 타입과 평가/구조/기록/동행 후일담을 같은 구조로 조합합니다.",
      aiTitle: "런타임 AI 요약 브리지",
      aiBody: "전체 원고 대신 현재 파트 요약, 직전 선택, 상태 요약만 연결합니다.",
      bucket: "상태 묶음",
      progress: "진행도",
      guard: "가드",
      paragraph: "문단",
      mode: "연결 모드",
    },
    "en-US": {
      stateTitle: "75-part state bridge",
      stateBody: "Three choices accumulate as reader-facing state summaries instead of raw scores.",
      endingTitle: "Modular ending assembly bridge",
      endingBody: "Combine the major ending type with evaluation, rescue, record truth, and companion epilogue blocks.",
      aiTitle: "Runtime AI summary bridge",
      aiBody: "Pass only the current part summary, previous choice, and state summary instead of the full manuscript.",
      bucket: "State bucket",
      progress: "Progress",
      guard: "Guard",
      paragraph: "Paragraph",
      mode: "Connection mode",
    },
    "ja-JP": {
      stateTitle: "75パート状態ブリッジ",
      stateBody: "3つの選択肢を生スコアではなく読者向け状態要約として蓄積します。",
      endingTitle: "モジュール式終了組み立てブリッジ",
      endingBody: "大きな終了タイプと評価、救助、記録の真実、同行者後日談を同じ構造で組み合わせます。",
      aiTitle: "ランタイムAI要約ブリッジ",
      aiBody: "全文ではなく現在パート要約、直前選択、状態要約だけを渡します。",
      bucket: "状態グループ",
      progress: "進行度",
      guard: "ガード",
      paragraph: "段落",
      mode: "接続モード",
    },
    "zh-CN": {
      stateTitle: "75部分状态桥接",
      stateBody: "三个选择会累计为面向读者的状态摘要，而不是原始分数。",
      endingTitle: "模块化结局组装桥接",
      endingBody: "把主要结局类型、评价、救援、记录真相和同行者后日谈组合为同一结构。",
      aiTitle: "运行时AI摘要桥接",
      aiBody: "只传当前部分摘要、上一个选择和状态摘要，而不是完整稿件。",
      bucket: "状态组",
      progress: "进度",
      guard: "保护",
      paragraph: "段落",
      mode: "连接模式",
    },
    "zh-Hant": {
      stateTitle: "75部分狀態橋接",
      stateBody: "三個選擇會累計為面向讀者的狀態摘要，而不是原始分數。",
      endingTitle: "模組化結局組裝橋接",
      endingBody: "把主要結局類型、評價、救援、記錄真相和同行者後日談組合為同一結構。",
      aiTitle: "執行時AI摘要橋接",
      aiBody: "只傳目前部分摘要、上一個選擇和狀態摘要，而不是完整稿件。",
      bucket: "狀態組",
      progress: "進度",
      guard: "保護",
      paragraph: "段落",
      mode: "連接模式",
    },
  };

  const FREE_STORY_STATE_BRIDGE_FIXTURE = {
    books: 5,
    parts: 75,
    choiceCount: 3,
    routeModel: "state bucket",
    progressLabel: "Book 1 / Part 12 of 75",
    buckets: [
      { label: "Trust-led route", summary: "Record confidence and companion trust are high." },
      { label: "Danger route", summary: "Danger is rising, but the item path is open." },
      { label: "Truth-led route", summary: "Hidden record clues are ready for ending review." },
    ],
  };

  const MODULAR_ENDING_ASSEMBLY_FIXTURE = [
    { label: "Major ending", body: "Writer route ending stays first." },
    { label: "Yi evaluation", body: "Evaluation paragraph reflects the reader-facing state summary." },
    { label: "Civilian rescue", body: "Rescue paragraph changes by the safe route summary." },
    { label: "Record truth", body: "Truth paragraph uses discovered public clues only." },
    { label: "Companion epilogue", body: "Companion follow-up is assembled as a short afterword." },
  ];

  const RUNTIME_AI_SUMMARY_BRIDGE_FIXTURE = {
    currentPartSummary: "The fleet waits before the next foggy shore choice.",
    previousChoice: "The reader checked the record before moving.",
    stateSummary: "Trust-led route with low danger and one public clue.",
    budgetLabel: "Short connector only",
    outputGuard: "No free chat or long-form generation",
  };

  let _storyScenes = STORY_SCENE_FALLBACKS.slice();
  let _storySceneIndex = 0;

  function lumina(n) {
    return (Number(n) || 0).toLocaleString("ko-KR") + " L";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function storyLocale() {
    const locale = window.luminaI18n?.getRegionalLocale?.() || window.luminaI18n?.getLocale?.();
    if (locale) return locale;
    return document.documentElement.lang || "ko-KR";
  }

  function storyT(key) {
    const liveValue = window.luminaI18n?.t?.(key);
    if (liveValue && liveValue !== key) return liveValue;
    const locale = storyLocale();
    const entry = STORY_SCENE_COPY[key];
    return entry?.[locale] || entry?.["ko-KR"] || key;
  }

  function routeHandoffHref(storyId, entry) {
    return "/story-stage?storyId=" + encodeURIComponent(storyId || "imjin") + "&entry=" + encodeURIComponent(entry || "card");
  }

  function branchChoice(label) {
    return STORY_BRANCH_IMPLEMENTATION_FIXTURE.find((choice) => choice.label === label) || STORY_BRANCH_IMPLEMENTATION_FIXTURE[0];
  }

  function branchBackgroundStyle(choice) {
    const safeChoice = choice || STORY_BRANCH_IMPLEMENTATION_FIXTURE[0];
    const url = safeChoice.backgroundAssetUrl || "/assets/brand/lumina-stage-banner.png";
    return "linear-gradient(180deg, rgba(8, 5, 18, 0.04), rgba(8, 5, 18, 0.62)), url('" + escapeHtml(url) + "')";
  }

  function publicEndingLabel(choice) {
    const type = String(choice?.endingType || "");
    if (type === "ai_fallback_ending") return "AI 보조 결말 후보";
    if (type === "writer_sub_ending") return "작가 서브 엔딩 후보";
    return "작가 기본 엔딩";
  }

  function storyLocalT(key) {
    const locale = storyLocale();
    const entry = STORY_SCENE_COPY[key];
    return entry?.[locale] || entry?.["ko-KR"] || storyT(key);
  }

  function runtimeBridgeCopy() {
    const locale = storyLocale();
    return STORY_RUNTIME_BRIDGE_COPY[locale] || STORY_RUNTIME_BRIDGE_COPY["ko-KR"];
  }

  function applyStoryLocalCopy(scope) {
    const root = scope || document;
    root.querySelectorAll("[data-story-local-i18n]").forEach((node) => {
      const key = node.getAttribute("data-story-local-i18n");
      node.textContent = storyLocalT(key);
    });
  }

  function companionOptions() {
    const data = window.LuminaStaticData || null;
    const all = data && Array.isArray(data.characters) ? data.characters : [];
    return all
      .filter(a => a && (a.status === "public" || a.status === "debut"))
      .slice(0, 6)
      .map(a => ({ slug: a.slug, name: a.publicName || a.name || a.slug }));
  }

  function isFixturePreview() {
    const params = new URLSearchParams(window.location.search || "");
    return params.get("storySceneFixturePreview") === "1"
      || params.get("storyfixture") === "1"
      || params.get("scenefixture") === "1";
  }

  function normalizeAssetUrl(url) {
    const value = String(url || "").trim();
    if (!value) return "";
    if (value.startsWith("./assets/")) return "/" + value.slice(2);
    if (value.startsWith("assets/")) return "/" + value;
    return value;
  }

  function normalizeScene(scene, index) {
    const safeScene = scene && typeof scene === "object" ? scene : {};
    const bg = safeScene.backgroundAsset && typeof safeScene.backgroundAsset === "object"
      ? Object.assign({}, safeScene.backgroundAsset, { url: normalizeAssetUrl(safeScene.backgroundAsset.url || safeScene.backgroundAsset.publicUrl) })
      : null;
    const characters = Array.isArray(safeScene.characters) ? safeScene.characters : [];
    return {
      sceneId: String(safeScene.sceneId || safeScene.id || "scene-" + (index + 1)),
      sceneTextKey: safeScene.sceneTextKey ? String(safeScene.sceneTextKey) : "",
      sceneText: String(safeScene.sceneText || safeScene.text || ""),
      backgroundState: String(safeScene.backgroundState || (bg?.url ? "ready" : "fallback")),
      backgroundAsset: bg,
      fallbackKey: String(safeScene.fallbackKey || "storyStage.scene.assetFallback.default"),
      characters: characters.slice(0, 4).map((character, i) => ({
        characterId: String(character.characterId || character.id || "character-" + i),
        artistSlug: String(character.artistSlug || ""),
        displayNameKey: String(character.displayNameKey || "storyStage.scene.character.altDefault"),
        assetId: String(character.assetId || ""),
        url: normalizeAssetUrl(character.url || character.publicUrl || character.assetUrl),
        characterPose: String(character.characterPose || character.pose || "neutral"),
        characterLayer: String(character.characterLayer || character.layer || "midground"),
        entranceState: String(character.entranceState || "entered"),
      })),
    };
  }

  async function loadScenePreviewFixtures() {
    if (!isFixturePreview()) return STORY_SCENE_FALLBACKS.slice();
    try {
      const path = "/api/v1/story-sessions/fixtures/story-scene-preview/scenes";
      let response = null;
      if (typeof window.apiFetch === "function") {
        response = await window.apiFetch(path, { throwOnError: true });
      } else {
        const res = await fetch(path, { credentials: "omit" });
        if (res.ok) response = await res.json();
      }
      const scenes = Array.isArray(response) ? response : response?.scenes;
      if (Array.isArray(scenes) && scenes.length) return scenes.map(normalizeScene);
    } catch (_) {
      // Fixture preview must stay usable even before the backend branch is reflected on main.
    }
    return STORY_SCENE_FALLBACKS.slice();
  }

  function sceneStatusI18nKey(scene) {
    const bgState = String(scene?.backgroundState || "");
    if (bgState === "loading") return "storyStage.scene.background.loading";
    if (bgState === "missing" || bgState === "fallback") return "storyStage.scene.background.missing";
    if (!scene?.characters || scene.characters.length === 0) return "storyStage.scene.character.missing";
    return "";
  }

  function renderStoryScene(scene) {
    const stage = document.querySelector("[data-story-scene-stage]");
    if (!stage) return;

    const activeScene = normalizeScene(scene || STORY_SCENE_FALLBACKS[0], 0);
    const bg = activeScene.backgroundAsset;
    const hasBackground = bg && bg.url && activeScene.backgroundState === "ready";
    const visibleCharacters = activeScene.characters.filter(c => c.characterLayer !== "offscreen");
    const characterWithAsset = visibleCharacters.filter(c => c.url);
    const statusKey = sceneStatusI18nKey(activeScene);

    stage.dataset.sceneId = activeScene.sceneId;
    stage.dataset.bgState = hasBackground ? "ready" : "fallback";
    stage.dataset.hasCharacters = characterWithAsset.length > 0 ? "true" : "false";
    const bgWrap = stage.querySelector("[data-scene-bg]");
    const bgImg = stage.querySelector("[data-scene-bg-img]");
    const chars = stage.querySelector("[data-scene-characters]");
    const text = stage.querySelector("[data-scene-text]");
    const status = stage.querySelector("[data-scene-visual-status]");
    const fallback = stage.querySelector("[data-scene-fallback]");
    const fallbackCopy = stage.querySelector("[data-scene-fallback-copy]");
    const fallbackRetry = stage.querySelector("[data-scene-retry]");

    if (bgWrap) bgWrap.dataset.bgState = hasBackground ? "ready" : "fallback";
    if (bgImg) {
      if (hasBackground) {
        bgImg.hidden = false;
        bgImg.src = bg.url;
      } else {
        bgImg.hidden = true;
        bgImg.removeAttribute("src");
      }
      bgImg.alt = storyT(bg?.labelKey || "storyStage.scene.background.altDefault");
      bgImg.setAttribute("data-i18n-alt", bg?.labelKey || "storyStage.scene.background.altDefault");
    }

    if (chars) {
      chars.innerHTML = characterWithAsset.map((character, index) => {
        const side = index % 2 === 0 ? "left" : "right";
        return (
          '<img class="scene-char" src="' + escapeHtml(character.url) + '" ' +
          'data-layer="' + escapeHtml(character.characterLayer) + '" ' +
          'data-pose="' + escapeHtml(character.characterPose) + '" ' +
          'data-side="' + side + '" ' +
          'alt="' + escapeHtml(storyT(character.displayNameKey || "storyStage.scene.character.altDefault")) + '" ' +
          'data-i18n-alt="' + escapeHtml(character.displayNameKey || "storyStage.scene.character.altDefault") + '" ' +
          'loading="lazy" decoding="async" />'
        );
      }).join("");
    }

    if (text) text.textContent = activeScene.sceneTextKey ? storyT(activeScene.sceneTextKey) : activeScene.sceneText;
    if (status) {
      if (statusKey) {
        status.hidden = false;
        status.textContent = storyT(statusKey);
        status.dataset.i18n = statusKey;
      } else {
        status.hidden = true;
        status.textContent = "";
        status.removeAttribute("data-i18n");
      }
    }
    if (fallback) {
      const showFallback = !hasBackground || (visibleCharacters.length > 0 && characterWithAsset.length === 0);
      fallback.hidden = !showFallback;
      fallback.dataset.bgState = hasBackground ? "ready" : "fallback";
      if (fallbackCopy) {
        const fallbackKey = statusKey || activeScene.fallbackKey || "storyStage.scene.assetFallback.default";
        fallbackCopy.textContent = storyT(fallbackKey);
        fallbackCopy.dataset.i18n = fallbackKey;
      }
      if (fallbackRetry) {
        fallbackRetry.textContent = storyT("storyStage.scene.retry");
        fallbackRetry.dataset.i18n = "storyStage.scene.retry";
      }
    }

    const count = document.querySelector("[data-scene-count]");
    if (count) count.textContent = (_storySceneIndex + 1) + " / " + _storyScenes.length;
    window.luminaI18n?.apply?.(stage);
  }

  function renderScenePreviewShell(fixtureMode) {
    return `
      <section class="story-section story-scene-section" aria-labelledby="storySceneTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-scene">Scene Visual</span>
          <h2 id="storySceneTitle">장면 연출 미리보기</h2>
        </div>
        <section class="story-scene-stage" data-story-scene-stage data-scene-id="" aria-label="스토리 장면" aria-live="polite">
          <div class="scene-bg" data-scene-bg data-bg-state="ready">
            <img class="scene-bg-img" alt="" data-scene-bg-img data-i18n-alt="storyStage.scene.background.altDefault" />
          </div>
          <div class="scene-characters" data-scene-characters></div>
          <div class="scene-text-overlay">
            <p class="scene-text" data-scene-text></p>
          </div>
          <p class="scene-visual-status" data-scene-visual-status role="status" hidden></p>
          <div class="scene-fallback" data-scene-fallback data-bg-state="missing" hidden>
            <p class="scene-fallback-copy" data-scene-fallback-copy data-i18n="storyStage.scene.background.missing">기본 배경으로 장면을 이어갈게요.</p>
            <button class="scene-retry" type="button" data-scene-retry data-i18n="storyStage.scene.retry">다시 시도</button>
          </div>
        </section>
        <nav class="scene-preview-nav" data-fixture-only ${fixtureMode ? "" : "hidden"}>
          <button type="button" data-scene-prev data-i18n="storyStage.scene.preview.prev">이전 장면</button>
          <span class="scene-preview-count" data-scene-count>1 / 3</span>
          <button type="button" data-scene-next data-i18n="storyStage.scene.preview.next">다음 장면</button>
        </nav>
      </section>
    `;
  }

  function renderBranchFixtureShell() {
    return `
      <section class="story-section story-branch-section" aria-labelledby="storyBranchTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-scene">Branch</span>
          <h2 id="storyBranchTitle" data-story-local-i18n="storyStage.branch.title">${storyLocalT("storyStage.branch.title")}</h2>
        </div>
        <p class="story-muted story-branch-note" data-story-local-i18n="storyStage.branch.note">${storyLocalT("storyStage.branch.note")}</p>
        <div class="story-branch-grid">
          ${STORY_BRANCH_FIXTURE.map((branch) => `
            <article class="story-branch-card" data-branch-tone="${escapeHtml(branch.tone)}">
              <div class="story-branch-card-head">
                <b>${escapeHtml(branch.label)}</b>
                <strong>${escapeHtml(branch.next)}</strong>
              </div>
              <h3 data-story-local-i18n="${escapeHtml(branch.titleKey)}">${storyLocalT(branch.titleKey)}</h3>
              <p data-story-local-i18n="${escapeHtml(branch.outcomeKey)}">${storyLocalT(branch.outcomeKey)}</p>
              <div class="story-branch-tags">
                ${branch.tagKeys.map((key) => `<span data-story-local-i18n="${escapeHtml(key)}">${storyLocalT(key)}</span>`).join("")}
              </div>
              <em data-story-local-i18n="${escapeHtml(branch.rejoinKey)}">${storyLocalT(branch.rejoinKey)}</em>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderLocaleQaShell() {
    return `
      <section class="story-section story-locale-section" aria-labelledby="storyLocaleTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-extra" data-i18n="storyStage.locale.eyebrow">언어</span>
          <h2 id="storyLocaleTitle" data-i18n="storyStage.locale.heading">언어 선택</h2>
        </div>
        <div class="story-locale-panel">
          <p data-i18n="storyStage.locale.note">스토리 화면 문구를 원하는 언어로 바꿔 읽어보세요.</p>
          <div class="story-locale-buttons" role="group" aria-label="Story language selector">
            ${STORY_LOCALES.map(locale => `
              <button type="button" data-story-locale="${locale.code}" aria-pressed="false">${locale.label}</button>
            `).join("")}
          </div>
        </div>
      </section>
    `;
  }

  function renderDiscoveryShell() {
    const filters = [
      "storyStage.discovery.filter.recommended",
      "storyStage.discovery.filter.taste",
      "storyStage.discovery.filter.new",
      "storyStage.discovery.filter.ranking",
      "storyStage.discovery.filter.today",
      "storyStage.discovery.filter.genre",
    ];
    return `
      <section class="story-section story-discovery-section" aria-labelledby="storyDiscoveryTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-free">Discovery</span>
          <h2 id="storyDiscoveryTitle" data-i18n="storyStage.discovery.heading">스토리 찾기</h2>
        </div>
        <div class="story-filter-row" role="list" aria-label="Story filters">
          ${filters.map((key, index) => `
            <button type="button" class="story-filter-chip${index === 0 ? " is-active" : ""}" data-i18n="${key}" aria-pressed="${index === 0 ? "true" : "false"}">${storyT(key)}</button>
          `).join("")}
        </div>
        <div class="story-discovery-grid">
          ${STORY_DISCOVERY_ITEMS.map(item => `
            <article class="story-discovery-card" data-story-detail="${escapeHtml(item.id)}" data-story-id="${escapeHtml(item.id)}" tabindex="0" role="button" aria-label="${escapeHtml(storyT(item.titleKey))}">
              <div class="story-discovery-cover" style="background-image: linear-gradient(180deg, rgba(8,5,18,0.04), rgba(8,5,18,0.52)), url('${escapeHtml(item.image)}')"></div>
              <div class="story-discovery-body">
                <span class="story-discovery-status" data-i18n="${item.statusKey}">${storyT(item.statusKey)}</span>
                <h3 data-i18n="${item.titleKey}">${storyT(item.titleKey)}</h3>
                <p data-i18n="${item.summaryKey}">${storyT(item.summaryKey)}</p>
                <div class="story-discovery-meta">
                  <span>${escapeHtml(item.metric)}</span>
                  <span>${item.tags.map(escapeHtml).join(" · ")}</span>
                </div>
                <div class="story-discovery-actions">
                  <a class="story-cta story-cta-free story-route-link"
                     href="${escapeHtml(routeHandoffHref(item.id, "card"))}"
                     data-story-route-handoff="card"
                     data-story-id="${escapeHtml(item.id)}">무료 프롤로그 시작</a>
                  <button class="story-detail-open" type="button" data-story-detail-open="${escapeHtml(item.id)}">상세 보기</button>
                </div>
              </div>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderDetailShell() {
    return `
      <section class="story-detail-sheet" data-story-detail-sheet hidden aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="storyDetailTitle">
        <button class="story-detail-close" type="button" data-story-detail-close data-i18n-aria="storyStage.detail.close" aria-label="닫기">×</button>
        <div class="story-detail-cover" aria-hidden="true"></div>
        <div class="story-detail-body">
          <span class="story-eyebrow story-eyebrow-scene" data-i18n="storyStage.detail.heading">스토리 상세</span>
          <h2 id="storyDetailTitle" data-i18n="storyStage.discovery.card.imjin.title">임진왜란: 난중일기 프롤로그</h2>
          <p data-story-detail-summary data-i18n="storyStage.discovery.card.imjin.summary">전장의 기록 사이로 들어가 첫 선택을 해요.</p>
          <div class="story-detail-chip-row" data-story-detail-tags>
            <span>History</span>
            <span>Tutorial</span>
          </div>
          <div class="story-detail-stat-row" data-story-detail-stats>
            <span>4.8</span>
            <span>1.2k readers</span>
          </div>
          <dl class="story-detail-list">
            <div><dt data-i18n="storyStage.detail.creator">AI 아티스트</dt><dd data-story-detail-creator>Cha Dohyun</dd></div>
            <div><dt data-i18n="storyStage.detail.profile">대화 프로필</dt><dd data-i18n="storyStage.setup.note">무료 프롤로그는 나 또는 AI 아티스트 1명과 시작해요.</dd></div>
            <div><dt>시작 설정</dt><dd data-story-detail-settings>무료 프롤로그 · 동반 AI 1명 · 비공개 미리보기</dd></div>
            <div><dt>업데이트</dt><dd data-story-detail-updates>최근 장면/선택지 검수 완료</dd></div>
            <div><dt data-i18n="storyStage.detail.prologue">프롤로그 미리보기</dt><dd data-i18n="storyStage.tutorial.detail">역사 기록의 결을 살린 짧은 프롤로그예요. 외부 번역문이나 특정 게임 문구를 쓰지 않고, Lumina의 장면형 선택 흐름으로 시작합니다.</dd></div>
            <div><dt data-i18n="storyStage.detail.similar">비슷한 스토리</dt><dd data-story-detail-similar data-i18n="storyStage.discovery.card.stage.title">첫 무대의 떨림</dd></div>
          </dl>
          <div class="story-detail-actions">
            <a class="story-cta story-cta-free story-route-link" href="${escapeHtml(routeHandoffHref("imjin", "detail"))}" data-story-route-handoff="detail-start" data-story-detail-start data-i18n="storyStage.detail.cta.free">무료 프롤로그 시작</a>
            <a class="story-cta story-cta-extra story-route-link" href="${escapeHtml(routeHandoffHref("imjin", "continue"))}" data-story-route-handoff="detail-continue" data-story-detail-continue data-i18n="storyStage.detail.cta.continue">이어하기</a>
            <a class="story-cta story-cta-paid story-route-link" href="${escapeHtml(routeHandoffHref("imjin", "locked-preview"))}" data-story-route-handoff="detail-locked" data-story-detail-locked data-i18n="storyStage.detail.cta.locked">구매 필요</a>
          </div>
        </div>
      </section>
      <div class="story-detail-backdrop" data-story-detail-backdrop hidden></div>
    `;
  }

  function renderSetupShell() {
    return `
      <section class="story-section story-setup-section" aria-labelledby="storySetupTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-free">${storyLocalT("storyStage.setup.eyebrow")}</span>
          <h2 id="storySetupTitle" data-i18n="storyStage.setup.heading">나 + AI 동반 설정</h2>
        </div>
        <div class="story-setup-grid">
          <article class="story-setup-item">
            <strong data-i18n="storyStage.setup.profile">대화 프로필</strong>
            <p data-i18n="storyStage.setup.note">무료 프롤로그는 나 또는 AI 아티스트 1명과 시작해요.</p>
          </article>
          <article class="story-setup-item">
            <strong data-i18n="storyStage.setup.start">시작 설정</strong>
            <p data-i18n="storyStage.tutorial.status">프롤로그를 준비 중이에요.</p>
          </article>
          <article class="story-setup-item">
            <strong data-i18n="storyStage.setup.companion">동반 AI</strong>
            <p data-i18n="storyStage.player.status">배경 위에 대화와 선택지를 겹치지 않게 보여줘요.</p>
          </article>
          <article class="story-setup-item">
            <strong data-i18n="storyStage.setup.visibility">공개 범위</strong>
            <p>${storyLocalT("storyStage.setup.visibility.private")}</p>
          </article>
        </div>
      </section>
    `;
  }

  function renderPlayerShell() {
    const activeChoice = STORY_BRANCH_IMPLEMENTATION_FIXTURE[0];
    return `
      <section class="story-section story-player-section" aria-labelledby="storyPlayerTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-scene">Immersive MVP</span>
          <h2 id="storyPlayerTitle" data-i18n="storyStage.player.heading">장면 속에서 대화하기</h2>
        </div>
        <div class="story-player-shell"
             aria-label="몰입형 스토리 플레이어 미리보기"
             data-story-mode-chat-shell="true"
             data-active-choice="${escapeHtml(activeChoice.label)}"
             data-scene-id="${escapeHtml(activeChoice.nextSceneId)}"
             data-background-id="${escapeHtml(activeChoice.backgroundId)}"
             data-character-asset-id="${escapeHtml(activeChoice.characterAssetId)}">
          <div class="story-player-bg" role="img" aria-label="스토리 장면 배경" data-story-player-bg style="background-image: ${branchBackgroundStyle(activeChoice)}"></div>
          <img class="story-player-character" src="${escapeHtml(activeChoice.characterImage)}" alt="${escapeHtml(activeChoice.characterAssetLabel)}" data-story-player-character data-i18n-alt="storyStage.scene.character.altDefault" loading="lazy" decoding="async" />
          <div class="story-player-scene-pill" data-story-player-scene>${escapeHtml(activeChoice.userSceneLabel)} · ${escapeHtml(activeChoice.backgroundLabel)}</div>
          <div class="story-player-overlay">
            <p class="story-player-status" data-i18n="storyStage.player.status">배경 위에 대화와 선택지를 겹치지 않게 보여줘요.</p>
            <div class="story-player-chat" role="log" aria-live="polite">
              <p class="story-player-bubble is-ai" data-story-player-bubble>${escapeHtml(activeChoice.chatLineLabel)}</p>
            </div>
            <div class="story-player-choices" role="group" aria-label="스토리 선택지">
              ${STORY_BRANCH_IMPLEMENTATION_FIXTURE.map((choice, index) => `
                <button type="button"
                        data-story-player-choice="${escapeHtml(choice.label)}"
                        aria-pressed="${index === 0 ? "true" : "false"}"
                        class="${index === 0 ? "is-active" : ""}">
                  ${escapeHtml(choice.label)} · ${escapeHtml(choice.userSceneLabel)}
                </button>
              `).join("")}
            </div>
            <label class="story-player-input">
              <span data-i18n="storyStage.player.userPlaceholder">내 반응을 짧게 남기기</span>
              <input type="text" disabled aria-disabled="true" data-i18n-attr="placeholder:storyStage.player.userPlaceholder" placeholder="내 반응을 짧게 남기기" />
            </label>
          </div>
        </div>
      </section>
    `;
  }

  function renderBranchImplementationShell() {
    const activeChoice = STORY_BRANCH_IMPLEMENTATION_FIXTURE[0];
    return `
      <section class="story-section story-branch-implementation" aria-labelledby="storyBranchImplementationTitle" data-story-stage-fixture-preview="1">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-scene">선택 결과</span>
          <h2 id="storyBranchImplementationTitle">A/B/C 선택 결과 미리보기</h2>
        </div>
        <p class="story-muted">같은 분기점에서도 장면, 관계, 위험도, 정보, 결말 후보가 다르게 이어지는지 확인합니다.</p>
        <div class="story-branch-nav" role="group" aria-label="선택 결과 미리보기">
          ${STORY_BRANCH_IMPLEMENTATION_FIXTURE.map((choice, index) => `
            <button type="button"
                    data-story-branch-choice="${escapeHtml(choice.label)}"
                    aria-pressed="${index === 0 ? "true" : "false"}"
                    class="${index === 0 ? "is-active" : ""}">
              ${escapeHtml(choice.label)} · ${escapeHtml(choice.userSceneLabel)}
            </button>
          `).join("")}
        </div>
        <article class="story-choice-result"
                 data-story-choice-result
                 data-active-choice="${escapeHtml(activeChoice.label)}"
                 data-scene-id="${escapeHtml(activeChoice.nextSceneId)}"
                 data-background-id="${escapeHtml(activeChoice.backgroundId)}">
          <div class="story-choice-result-bg" data-choice-result-bg style="background-image: ${branchBackgroundStyle(activeChoice)}"></div>
          <div class="story-choice-result-body">
            <strong data-choice-result-scene>${escapeHtml(activeChoice.label)} · ${escapeHtml(activeChoice.userSceneLabel)}</strong>
            <p data-choice-result-summary>${escapeHtml(activeChoice.bodySummaryLabel)}</p>
            <dl class="story-choice-summary">
              <div><dt>사건</dt><dd data-choice-result-event>${escapeHtml(activeChoice.eventLabel)}</dd></div>
              <div><dt>관계</dt><dd data-choice-result-relation>${escapeHtml(activeChoice.relationLabel)}</dd></div>
              <div><dt>위험</dt><dd data-choice-result-risk>${escapeHtml(activeChoice.riskLabel)}</dd></div>
              <div><dt>정보</dt><dd data-choice-result-info>${escapeHtml(activeChoice.infoLabel)}</dd></div>
              <div><dt>결말 후보</dt><dd data-choice-result-ending>${escapeHtml(publicEndingLabel(activeChoice))}</dd></div>
              <div><dt>합류</dt><dd data-choice-result-rejoin>${escapeHtml(activeChoice.rejoinLabel)}</dd></div>
            </dl>
          </div>
        </article>
        <section class="story-ending-mini-map"
                 data-story-ending-mini-map="true"
                 aria-labelledby="storyEndingMiniMapTitle">
          <div class="story-ending-mini-map-head">
            <span>Ending map</span>
            <h3 id="storyEndingMiniMapTitle">결말 미니맵</h3>
            <p>작가 기본/서브/AI 보조 결말이 어디에서 갈라지는지 한눈에 확인합니다.</p>
          </div>
          <ol class="story-ending-map-lanes">
            ${STORY_ENDING_MINI_MAP.map((ending) => `
              <li class="story-ending-map-lane" data-ending-map-kind="${escapeHtml(ending.tone)}">
                <div class="story-ending-map-copy">
                  <span>${escapeHtml(ending.routeLabel)}</span>
                  <strong>${escapeHtml(ending.title)}</strong>
                  <p>${escapeHtml(ending.summary)}</p>
                </div>
                <div class="story-ending-map-flow" aria-label="${escapeHtml(ending.from + "에서 " + ending.to + "로 이어짐")}">
                  <span>${escapeHtml(ending.from)}</span>
                  <i aria-hidden="true"></i>
                  <span>${escapeHtml(ending.to)}</span>
                </div>
                <em>${escapeHtml(ending.note)}</em>
              </li>
            `).join("")}
          </ol>
        </section>
        <div class="story-branch-implementation-grid">
          ${STORY_BRANCH_IMPLEMENTATION_FIXTURE.map((choice) => `
            <article
              class="story-branch-implementation-card"
              data-story-branch-fixture-card="true"
              data-choice="${escapeHtml(choice.label)}"
              data-next-scene="${escapeHtml(choice.nextSceneId)}"
              data-state-delta="${escapeHtml(choice.stateDelta)}"
              data-ending-type="${escapeHtml(choice.endingType)}"
              data-ending-route="${escapeHtml(choice.endingRoute)}"
              data-background-id="${escapeHtml(choice.backgroundId)}"
              data-background-state="${escapeHtml(choice.backgroundState)}"
              data-character-asset-id="${escapeHtml(choice.characterAssetId)}"
            >
              <strong>선택 ${escapeHtml(choice.label)} · ${escapeHtml(choice.userSceneLabel)}</strong>
              <span>${escapeHtml(choice.backgroundLabel)}</span>
              <p>${escapeHtml(choice.bodySummaryLabel)}</p>
              <dl>
                <div><dt>변화</dt><dd>${escapeHtml(choice.stateLabel)}</dd></div>
                <div><dt>결말 후보</dt><dd>${escapeHtml(publicEndingLabel(choice))}</dd></div>
                <div><dt>배경</dt><dd>${escapeHtml(choice.backgroundLabel)}</dd></div>
                <div><dt>결과</dt><dd>${escapeHtml(choice.eventLabel)}</dd></div>
                <div><dt>합류</dt><dd>${escapeHtml(choice.rejoinLabel)}</dd></div>
              </dl>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderFreeStoryStateBridgeShell() {
    const copy = runtimeBridgeCopy();
    const state = FREE_STORY_STATE_BRIDGE_FIXTURE;
    return `
      <section class="story-section story-bridge-section"
               aria-labelledby="storyStateBridgeTitle"
               data-free-story-state-bridge="true"
               data-choice-count="${escapeHtml(state.choiceCount)}"
               data-book-count="${escapeHtml(state.books)}"
               data-part-count="${escapeHtml(state.parts)}"
               data-route-model="bucket">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-scene">${escapeHtml(copy.progress)}</span>
          <h2 id="storyStateBridgeTitle">${escapeHtml(copy.stateTitle)}</h2>
        </div>
        <p class="story-muted">${escapeHtml(copy.stateBody)}</p>
        <div class="story-bridge-grid">
          <article class="story-bridge-card">
            <span>${escapeHtml(copy.progress)}</span>
            <strong>${escapeHtml(state.progressLabel)}</strong>
            <p>5 books / 75 parts / 3 choices</p>
          </article>
          ${state.buckets.map((bucket) => `
            <article class="story-bridge-card">
              <span>${escapeHtml(copy.bucket)}</span>
              <strong>${escapeHtml(bucket.label)}</strong>
              <p>${escapeHtml(bucket.summary)}</p>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderModularEndingAssemblyBridgeShell() {
    const copy = runtimeBridgeCopy();
    return `
      <section class="story-section story-bridge-section"
               aria-labelledby="storyEndingAssemblyTitle"
               data-modular-ending-assembly-bridge="true"
               data-ai-ending-generation="polish-only"
               data-provider-requested="false">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-extra">${escapeHtml(copy.paragraph)}</span>
          <h2 id="storyEndingAssemblyTitle">${escapeHtml(copy.endingTitle)}</h2>
        </div>
        <p class="story-muted">${escapeHtml(copy.endingBody)}</p>
        <div class="story-ending-assembly-list">
          ${MODULAR_ENDING_ASSEMBLY_FIXTURE.map((block, index) => `
            <article class="story-ending-assembly-item">
              <b>${index + 1}</b>
              <div>
                <strong>${escapeHtml(block.label)}</strong>
                <p>${escapeHtml(block.body)}</p>
              </div>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderRuntimeAiPromptSummaryBridgeShell() {
    const copy = runtimeBridgeCopy();
    const runtime = RUNTIME_AI_SUMMARY_BRIDGE_FIXTURE;
    return `
      <section class="story-section story-bridge-section"
               aria-labelledby="storyRuntimeAiTitle"
               data-runtime-ai-prompt-summary-bridge="true"
               data-full-manuscript-attached="false"
               data-free-chat-enabled="false"
               data-provider-requested="false">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-react">AI</span>
          <h2 id="storyRuntimeAiTitle">${escapeHtml(copy.aiTitle)}</h2>
        </div>
        <p class="story-muted">${escapeHtml(copy.aiBody)}</p>
        <dl class="story-runtime-summary">
          <div><dt>${escapeHtml(copy.paragraph)}</dt><dd>${escapeHtml(runtime.currentPartSummary)}</dd></div>
          <div><dt>${escapeHtml(copy.bucket)}</dt><dd>${escapeHtml(runtime.stateSummary)}</dd></div>
          <div><dt>${escapeHtml(copy.mode)}</dt><dd>${escapeHtml(runtime.previousChoice)}</dd></div>
          <div><dt>${escapeHtml(copy.guard)}</dt><dd>${escapeHtml(runtime.budgetLabel)} · ${escapeHtml(runtime.outputGuard)}</dd></div>
        </dl>
      </section>
    `;
  }

  function renderTutorialShell() {
    return `
      <section class="story-section story-tutorial-section" aria-labelledby="storyTutorialTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-react">Tutorial</span>
          <h2 id="storyTutorialTitle" data-i18n="storyStage.tutorial.title">임진왜란: 난중일기 프롤로그</h2>
        </div>
        <article class="story-card story-tutorial-card">
          <p class="story-card-summary" data-i18n="storyStage.tutorial.short">첫 무료 장면에서 바다와 기록의 긴장을 따라가요.</p>
          <p class="story-muted" data-i18n="storyStage.tutorial.detail">역사 기록의 결을 살린 짧은 프롤로그예요. 외부 번역문이나 특정 게임 문구를 쓰지 않고, Lumina의 장면형 선택 흐름으로 시작합니다.</p>
          <button class="story-cta story-cta-free" type="button" aria-disabled="true" data-i18n="storyStage.tutorial.cta">무료 프롤로그 보기</button>
        </article>
      </section>
    `;
  }

  function renderStoryStage() {
    const root = document.getElementById("storyStageRoot");
    if (!root) return;

    const f = STORY_FIXTURE;
    const fixtureMode = isFixturePreview();
    const companions = companionOptions();
    const seasonSaving = Math.max(0, f.season.singleSumLumina - f.season.bundlePriceLumina);
    const companionChips = companions.length
      ? companions.map((c, i) => `
          <button class="story-companion-chip${i === 0 ? " is-selected" : ""}" type="button"
                  aria-pressed="${i === 0 ? "true" : "false"}" data-story-companion="${escapeHtml(c.slug)}">
            ${escapeHtml(c.name)}
          </button>`).join("")
      : `<p class="story-muted">공개 아티스트가 준비되면 동반 캐릭터로 선택할 수 있어요.</p>`;

    const firstScenePreview = fixtureMode ? renderScenePreviewShell(fixtureMode) : renderDiscoveryShell();
    const laterScenePreview = fixtureMode ? renderDiscoveryShell() : renderScenePreviewShell(fixtureMode);
    const localeQa = fixtureMode ? renderLocaleQaShell() : "";

    root.innerHTML = `
      <div class="story-preview-banner" role="note"
           data-story-stage-public-build-marker="story-stage-public-2026-07-05"
           data-reflection-status="public">
        <strong>${storyLocalT("storyStage.preview.notice.title")}</strong>
        <span>${storyLocalT("storyStage.preview.notice.body")}</span>
      </div>

      ${firstScenePreview}

      ${fixtureMode ? renderBranchFixtureShell() : ""}

      ${localeQa}

      ${renderDetailShell()}

      ${laterScenePreview}

      ${renderPlayerShell()}

      ${renderBranchImplementationShell()}

      ${renderFreeStoryStateBridgeShell()}

      ${renderModularEndingAssemblyBridgeShell()}

      ${renderRuntimeAiPromptSummaryBridgeShell()}

      ${renderSetupShell()}

      ${renderTutorialShell()}

      <section class="story-section" aria-labelledby="storyPrologueTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-free">무료 · 계정당 1회</span>
          <h2 id="storyPrologueTitle">${escapeHtml(f.prologue.title)}</h2>
        </div>
        <div class="story-card story-card-prologue">
          <p class="story-card-summary">${escapeHtml(f.prologue.summary)}</p>
          <ul class="story-meta-list">
            <li><strong>비용</strong><span class="story-free-pill">무료</span></li>
            <li><strong>제공</strong><span>계정당 ${f.prologue.freePerAccount}회</span></li>
            <li><strong>분량</strong><span>${escapeHtml(f.prologue.runtime)}</span></li>
          </ul>
          <div class="story-companion">
            <p class="story-companion-label">함께할 캐릭터 · 본인 또는 동반 1명</p>
            <div class="story-companion-chips" role="group" aria-label="동반 캐릭터 선택">
              <button class="story-companion-chip is-self is-selected" type="button" aria-pressed="true" data-story-companion="self">나</button>
              ${companionChips}
            </div>
            <p class="story-muted story-companion-hint">동반은 최대 ${f.prologue.companionMax}명까지 선택할 수 있어요.</p>
          </div>
          <a class="story-cta story-cta-free story-route-link" href="${escapeHtml(routeHandoffHref("imjin", "prologue"))}" data-story-route-handoff="prologue-start" data-story-id="imjin">무료로 시작 (미리보기)</a>
        </div>
      </section>

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
                <strong class="story-chapter-title">${escapeHtml(c.title)}</strong>
                <p class="story-chapter-summary">${escapeHtml(c.summary)}</p>
              </div>
              <div class="story-chapter-buy">
                <span class="story-price">${lumina(c.priceLumina)}</span>
                <button class="story-cta story-cta-paid" type="button" aria-disabled="true" data-story-preview="chapter-${c.no}">구매 (미리보기)</button>
              </div>
            </li>`).join("")}
        </ul>
      </section>

      <section class="story-section" aria-labelledby="storySeasonTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-paid">유료 · 시즌 묶음</span>
          <h2 id="storySeasonTitle">${escapeHtml(f.season.title)}</h2>
        </div>
        <div class="story-card story-card-season">
          <p class="story-card-summary">챕터 ${f.season.chapterCount}편을 한 번에. 이미 구매한 챕터가 있으면 그만큼 제외하고 결제해요.</p>
          <div class="story-season-price">
            <span class="story-price story-price-lg">${lumina(f.season.bundlePriceLumina)}</span>
            <span class="story-price-strike">${lumina(f.season.singleSumLumina)}</span>
            ${seasonSaving > 0 ? `<span class="story-save-pill">${lumina(seasonSaving)} 절약</span>` : ""}
          </div>
          <button class="story-cta story-cta-paid" type="button" aria-disabled="true" data-story-preview="season">시즌 구매 (미리보기)</button>
        </div>
      </section>

      <section class="story-section" aria-labelledby="storyVideoTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-extra">선택 · 추가 비용</span>
          <h2 id="storyVideoTitle">장면을 영상으로</h2>
        </div>
        <div class="story-card story-card-video">
          <div class="story-video-row">
            <span class="story-price">${lumina(f.video.perClipLumina)} <small>/ 1개</small></span>
            <button class="story-cta story-cta-extra" type="button" aria-disabled="true" data-story-preview="video">영상 만들기 (미리보기)</button>
          </div>
          <p class="story-note-extra">${escapeHtml(f.video.note)}</p>
        </div>
      </section>

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
          <p class="story-comments-head">스토리 전체 댓글 <span class="story-muted">· 구매한 사람만 남길 수 있어요</span></p>
          ${f.reactions.storyComments.map(cm => `
            <div class="story-comment">
              <div class="story-comment-top">
                <strong class="story-comment-author">${escapeHtml(cm.author)}</strong>
                ${cm.paid ? `<span class="story-buyer-badge">결제함</span>` : ""}
                ${cm.completed ? `<span class="story-read-badge is-done">완독</span>` : ""}
              </div>
              <p class="story-comment-text">${escapeHtml(cm.text)}</p>
            </div>`).join("")}
          <button class="story-cta story-cta-extra" type="button" aria-disabled="true" data-story-preview="comment">댓글 남기기 (구매 후 가능 · 미리보기)</button>
        </div>
      </section>
    `;

    bindStoryPreview(root);
    applyStoryLocalCopy(root);
    setStoryBranchChoice(root, "A");
    loadScenePreviewFixtures().then(scenes => {
      _storyScenes = scenes.map(normalizeScene);
      _storySceneIndex = 0;
      renderStoryScene(_storyScenes[0]);
    });
    window.luminaI18n?.apply?.(root);
  }

  function setStoryBranchChoice(root, label) {
    const choice = branchChoice(label);
    if (!root || !choice) return;
    root.querySelectorAll("[data-story-branch-choice], [data-story-player-choice]").forEach((button) => {
      const buttonLabel = button.dataset.storyBranchChoice || button.dataset.storyPlayerChoice;
      const active = buttonLabel === choice.label;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    root.querySelectorAll("[data-story-branch-fixture-card]").forEach((card) => {
      card.classList.toggle("is-active", card.dataset.choice === choice.label);
    });

    const shell = root.querySelector("[data-story-mode-chat-shell]");
    if (shell) {
      shell.dataset.activeChoice = choice.label;
      shell.dataset.sceneId = choice.nextSceneId;
      shell.dataset.backgroundId = choice.backgroundId;
      shell.dataset.characterAssetId = choice.characterAssetId;
    }
    const playerBg = root.querySelector("[data-story-player-bg]");
    if (playerBg) playerBg.style.backgroundImage = branchBackgroundStyle(choice);
    const playerScene = root.querySelector("[data-story-player-scene]");
    if (playerScene) playerScene.textContent = choice.userSceneLabel + " · " + choice.backgroundLabel;
    const playerBubble = root.querySelector("[data-story-player-bubble]");
    if (playerBubble) playerBubble.textContent = choice.chatLineLabel;
    const playerCharacter = root.querySelector("[data-story-player-character]");
    if (playerCharacter) {
      if (choice.characterImage) {
        playerCharacter.hidden = false;
        playerCharacter.src = choice.characterImage;
        playerCharacter.alt = choice.characterAssetLabel;
      } else {
        playerCharacter.hidden = true;
        playerCharacter.removeAttribute("src");
        playerCharacter.alt = choice.characterAssetLabel;
      }
      playerCharacter.dataset.characterAssetId = choice.characterAssetId;
    }

    const result = root.querySelector("[data-story-choice-result]");
    if (result) {
      result.dataset.activeChoice = choice.label;
      result.dataset.sceneId = choice.nextSceneId;
      result.dataset.backgroundId = choice.backgroundId;
    }
    const resultBg = root.querySelector("[data-choice-result-bg]");
    if (resultBg) resultBg.style.backgroundImage = branchBackgroundStyle(choice);
    const slots = [
      ["[data-choice-result-scene]", choice.label + " · " + choice.userSceneLabel],
      ["[data-choice-result-summary]", choice.bodySummaryLabel],
      ["[data-choice-result-event]", choice.eventLabel],
      ["[data-choice-result-relation]", choice.relationLabel],
      ["[data-choice-result-risk]", choice.riskLabel],
      ["[data-choice-result-info]", choice.infoLabel],
      ["[data-choice-result-ending]", publicEndingLabel(choice)],
      ["[data-choice-result-rejoin]", choice.rejoinLabel],
    ];
    slots.forEach(([selector, value]) => {
      const node = root.querySelector(selector);
      if (node) node.textContent = value;
    });
  }

  function bindStoryPreview(root) {
    if (root._storyPreviewBound) return;
    root._storyPreviewBound = true;

    root.addEventListener("click", (event) => {
      if (event.target.closest("[data-story-route-handoff]")) return;

      const branchButton = event.target.closest("[data-story-branch-choice], [data-story-player-choice]");
      if (branchButton) {
        event.preventDefault();
        setStoryBranchChoice(root, branchButton.dataset.storyBranchChoice || branchButton.dataset.storyPlayerChoice);
        return;
      }

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

      if (event.target.closest("[data-scene-prev]")) {
        _storySceneIndex = (_storySceneIndex + _storyScenes.length - 1) % _storyScenes.length;
        renderStoryScene(_storyScenes[_storySceneIndex]);
        return;
      }
      if (event.target.closest("[data-scene-next]")) {
        _storySceneIndex = (_storySceneIndex + 1) % _storyScenes.length;
        renderStoryScene(_storyScenes[_storySceneIndex]);
        return;
      }
      if (event.target.closest("[data-scene-retry]")) {
        renderStoryScene(_storyScenes[_storySceneIndex] || STORY_SCENE_FALLBACKS[0]);
        return;
      }

      const localeButton = event.target.closest("[data-story-locale]");
      if (localeButton) {
        const nextLocale = localeButton.dataset.storyLocale;
        root.querySelectorAll("[data-story-locale]").forEach(button => {
          button.setAttribute("aria-pressed", button === localeButton ? "true" : "false");
        });
        Promise.resolve(window.luminaI18n?.setLocale?.(nextLocale)).finally(() => {
          window.luminaI18n?.apply?.(root);
          applyStoryLocalCopy(root);
          renderStoryScene(_storyScenes[_storySceneIndex] || STORY_SCENE_FALLBACKS[0]);
        });
        return;
      }

      const filterChip = event.target.closest(".story-filter-chip");
      if (filterChip) {
        const row = filterChip.closest(".story-filter-row");
        if (row) row.querySelectorAll(".story-filter-chip").forEach(button => {
          const active = button === filterChip;
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-pressed", active ? "true" : "false");
        });
        return;
      }

      if (event.target.closest("[data-story-route-handoff]")) {
        return;
      }

      const detailCard = event.target.closest("[data-story-detail]");
      if (detailCard) {
        event.preventDefault();
        openStoryDetail(root, detailCard.dataset.storyDetail);
        return;
      }

      const detailButton = event.target.closest("[data-story-detail-open]");
      if (detailButton) {
        event.preventDefault();
        openStoryDetail(root, detailButton.dataset.storyDetailOpen);
        return;
      }

      if (event.target.closest("[data-story-detail-close]") || event.target.closest("[data-story-detail-backdrop]")) {
        event.preventDefault();
        closeStoryDetail(root);
        return;
      }

      const cta = event.target.closest("[data-story-preview]");
      if (cta) {
        event.preventDefault();
        showStoryPreviewToast();
      }
    });

    root.addEventListener("keydown", (event) => {
      const card = event.target.closest("[data-story-detail]");
      if (card && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        openStoryDetail(root, card.dataset.storyDetail);
      }
      if (event.key === "Escape") closeStoryDetail(root);
    });
  }

  function openStoryDetail(root, itemId) {
    const sheet = root.querySelector("[data-story-detail-sheet]");
    const backdrop = root.querySelector("[data-story-detail-backdrop]");
    if (!sheet || !backdrop) return;
    const item = STORY_DISCOVERY_ITEMS.find(story => story.id === itemId) || STORY_DISCOVERY_ITEMS[0];
    const title = sheet.querySelector("#storyDetailTitle");
    const cover = sheet.querySelector(".story-detail-cover");
    const summary = sheet.querySelector("[data-story-detail-summary]");
    const tags = sheet.querySelector("[data-story-detail-tags]");
    const stats = sheet.querySelector("[data-story-detail-stats]");
    const creator = sheet.querySelector("[data-story-detail-creator]");
    const settings = sheet.querySelector("[data-story-detail-settings]");
    const updates = sheet.querySelector("[data-story-detail-updates]");
    const similar = sheet.querySelector("[data-story-detail-similar]");
    if (title) {
      title.dataset.i18n = item.titleKey;
      title.textContent = storyT(item.titleKey);
    }
    if (summary) {
      summary.dataset.i18n = item.summaryKey;
      summary.textContent = storyT(item.summaryKey);
    }
    if (tags) {
      tags.innerHTML = item.tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join("");
    }
    if (stats) {
      const pieces = String(item.metric || "").split("·").map(piece => piece.trim()).filter(Boolean);
      stats.innerHTML = (pieces.length ? pieces : [item.metric || "Preview"]).map(piece => `<span>${escapeHtml(piece)}</span>`).join("");
    }
    if (creator) creator.textContent = item.creator || "Lumina AI";
    if (settings) settings.textContent = item.startSetting || "읽기 전용 미리보기";
    if (updates) updates.textContent = item.updateText || "최근 QA 완료";
    if (similar) {
      similar.dataset.i18n = item.similarTitleKey || "storyStage.discovery.card.imjin.title";
      similar.textContent = storyT(similar.dataset.i18n);
    }
    if (cover) {
      cover.style.backgroundImage = "linear-gradient(180deg, rgba(8,5,18,0.04), rgba(8,5,18,0.62)), url('" + item.image + "')";
    }
    const routeNode = sheet.querySelector("[data-story-detail-route]");
    if (routeNode) routeNode.textContent = routeHandoffHref(item.id, "detail");
    const startLink = sheet.querySelector("[data-story-detail-start]");
    if (startLink) {
      startLink.href = routeHandoffHref(item.id, "detail");
      startLink.dataset.storyId = item.id;
    }
    const continueLink = sheet.querySelector("[data-story-detail-continue]");
    if (continueLink) {
      continueLink.href = routeHandoffHref(item.id, "continue");
      continueLink.dataset.storyId = item.id;
    }
    const lockedLink = sheet.querySelector("[data-story-detail-locked]");
    if (lockedLink) {
      lockedLink.href = routeHandoffHref(item.id, "locked-preview");
      lockedLink.dataset.storyId = item.id;
    }
    sheet.hidden = false;
    sheet.setAttribute("aria-hidden", "false");
    backdrop.hidden = false;
    window.luminaI18n?.apply?.(sheet);
    requestAnimationFrame(() => sheet.querySelector("[data-story-detail-close]")?.focus({ preventScroll: true }));
  }

  function closeStoryDetail(root) {
    const sheet = root.querySelector("[data-story-detail-sheet]");
    const backdrop = root.querySelector("[data-story-detail-backdrop]");
    if (sheet) {
      sheet.hidden = true;
      sheet.setAttribute("aria-hidden", "true");
    }
    if (backdrop) backdrop.hidden = true;
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
    toast.textContent = "미리보기 화면에서는 결제, 정식 진행, 생성 요청을 실행하지 않습니다.";
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
  window.renderStoryScene = renderStoryScene;
  window.sceneStatusI18nKey = sceneStatusI18nKey;
})();
