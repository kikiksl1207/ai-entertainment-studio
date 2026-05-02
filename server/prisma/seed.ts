import { createHash } from 'crypto';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const launchedAt = new Date('2026-04-27T00:00:00.000Z');

const artists = [
  {
    slug: 'yoon-serin',
    displayName: '윤세린',
    sortOrder: 10,
    tagline: '강렬한 첫인상과 퍼포먼스가 돋보이는 메인 비주얼',
    summary: '차갑고 미래적인 무드 안에서 무대를 장악하는 Lumina Stage의 대표 캐릭터.',
    keywords: ['시크', '퍼포먼스', '비주얼'],
    story:
      '서울 강남에서 태어난 윤세린은 모델 출신의 AI 아티스트로, 절제된 분위기와 강한 시선으로 팬을 사로잡는다.',
    visualKeywords: ['강한 시선', '네온 무대감', '하이엔드 뷰티'],
    primaryColor: '#7c3aed',
    secondaryColor: '#111827',
  },
  {
    slug: 'han-seoyul',
    displayName: '한서율',
    sortOrder: 20,
    tagline: '밝고 안정적인 필터 감성의 아이돌형 캐릭터',
    summary: '팬에게 편안한 에너지를 주는 대중형 메인 캐릭터.',
    keywords: ['필터', '대중성', '청량'],
    story:
      '경기 분당에서 자란 한서율은 청량한 비주얼과 밝은 반응으로 누구에게나 쉽게 다가가는 무드메이커형 아티스트다.',
    visualKeywords: ['밝은 에너지', '청량 필터', '라이프스타일'],
    primaryColor: '#f59e0b',
    secondaryColor: '#2563eb',
  },
  {
    slug: 'park-doa',
    displayName: '박도아',
    sortOrder: 30,
    tagline: '친근함과 생활감이 강한 커뮤니티형 스타',
    summary: '먹방 반응과 일상 대화에 강한 소통형 캐릭터.',
    keywords: ['친근함', '리액션', '생활감'],
    story:
      '부산 해운대에서 자란 박도아는 먹방, 리액션, 일상 브이로그 감각으로 팬들과 먼저 말을 주고받는 캐릭터다.',
    visualKeywords: ['편안한 미소', '생활감', '커뮤니티 반응'],
    primaryColor: '#f97316',
    secondaryColor: '#22c55e',
  },
  {
    slug: 'choi-seojin',
    displayName: '최서진',
    sortOrder: 40,
    tagline: '럭셔리 에디토리얼에 강한 프리미엄 메인',
    summary: '광고, 화보, 브랜드 무드가 강한 프리미엄 라인 간판 캐릭터.',
    keywords: ['럭셔리', '에디토리얼', '프리미엄'],
    story:
      '서울 성남에서 태어난 최서진은 배우와 패션 모델의 경계를 오가는 프리미엄 라인의 상징적인 아티스트다.',
    visualKeywords: ['하이엔드', '에디토리얼', '성숙한 존재감'],
    primaryColor: '#334155',
    secondaryColor: '#d4af37',
  },
  {
    slug: 'oh-hyerin',
    displayName: '오혜린',
    sortOrder: 50,
    tagline: '깊은 감정선과 위로를 전하는 감성 메인보컬',
    summary: '음원, 팬레터, 감성 대화에 강한 팬코어형 보컬 캐릭터.',
    keywords: ['감성보컬', '위로', '팬코어'],
    story:
      '오혜린은 조용한 새벽 감성과 맑은 목소리로 팬에게 오래 남는 위로를 전하는 Lumina Stage의 감성 보컬 아티스트다.',
    visualKeywords: ['아련한 눈빛', '페일 라벤더', '요정미'],
    primaryColor: '#c4b5fd',
    secondaryColor: '#64748b',
  },
  {
    slug: 'cha-dohyun',
    displayName: '차도현',
    sortOrder: 60,
    tagline: '젠더리스 하이패션과 무대 장악력이 강한 첫 남성 아티스트',
    summary: '패션, 무대, 숏폼, 팬덤 확장을 함께 담당하는 남성 공개 라인 대표 캐릭터.',
    keywords: ['하이패션', '아티스트성', '스웨그'],
    story:
      '차도현은 실험적인 스타일과 압도적인 무대 태도로 Lumina Stage의 남성 라인업을 여는 하이패션 K-pop 아티스트다.',
    visualKeywords: ['날카로운 눈매', '젠더리스 패션', '체인 레이어링'],
    primaryColor: '#111827',
    secondaryColor: '#a855f7',
  },
  {
    slug: 'seo-yuan',
    displayName: 'Seo Yuan',
    sortOrder: 70,
    tagline: 'Natural luxury beauty and lifestyle muse',
    summary:
      'A graceful premium model character for skincare, fragrance, and calm lifestyle content.',
    keywords: ['natural luxury', 'beauty', 'lifestyle'],
    story:
      'Seo Yuan is a clean, elegant Lumina Stage artist built around transparent beauty, fragrance, and premium lifestyle imagery.',
    visualKeywords: ['soft oval face', 'dewy skin', 'minimal ivory styling'],
    primaryColor: '#f8fafc',
    secondaryColor: '#94a3b8',
  },
] as const;

const profileFactsBySlug = {
  'yoon-serin': {
    birthDate: '2001-03-14',
    displayBirthDate: '2001년 3월 14일',
    hometown: '서울 강남구',
    height: '169cm',
    bloodType: 'A형',
    mbti: 'INTJ',
    debut: '2024년 Lumina Stage 1기',
    position: '메인 비주얼 / 퍼포먼스 센터',
    characterType: '시크 퍼포먼스형',
    fandomNameCandidate: 'Serinist',
    fandomNameStatus: '운영 후보',
    fanPoint: '차가운 시선, 절제된 표정, 무대 위 집중력',
    speechKeywords: ['차분함', '짧고 선명한 표현', '감정을 쉽게 드러내지 않는 자신감'],
    hobbies: ['영화 감상', '향수 수집', '새벽 드라이브'],
    favoriteGifts: ['블랙 로즈', '무대 조명', '니치 향수'],
    signatureItems: ['커스텀 인이어', '와인 퍼플 마이크', '슬림 이어커프'],
    representativeContent: ['퍼포먼스 숏폼', '무대 화보', '프리미엄 무드 필름'],
    adCategory: '뷰티 · 향수 · 패션 필름',
    premiumPoint: '무대 뒤 독점 컷, 스페셜 퍼포먼스 영상, 고급 스테이지 룩',
    unlockItem: '와인 퍼플 스테이지 의상',
    boostPoint: '메인픽 경쟁에 강한 첫 유입 비주얼',
    representativeColors: ['Deep Plum', 'Black Purple'],
    relationshipPosition: '메인 라인의 차가운 중심축',
    publicOneLiner:
      '차가운 시선과 완벽한 무대 장악력으로 Lumina Stage의 첫인상을 책임지는 메인 비주얼.',
  },
  'han-seoyul': {
    birthDate: '2002-08-09',
    displayBirthDate: '2002년 8월 9일',
    hometown: '경기도 성남시 분당구',
    height: '171cm',
    bloodType: 'O형',
    mbti: 'ENFJ',
    debut: '2024년 Lumina Stage 1기',
    position: '메인 센터 / 대중성 확장형 아이돌',
    characterType: '럭셔리 러블리 센터형',
    fandomNameCandidate: 'Yulight',
    fandomNameStatus: '운영 후보',
    fanPoint: '화사한 아이컨택, 안정적인 센터감, 팬을 편하게 만드는 밝은 에너지',
    speechKeywords: ['밝음', '다정함', '프로다운 안정감', '은근한 장난기'],
    hobbies: ['셀프 카메라 연구', '디저트 카페 탐방', '무대 의상 스크랩'],
    favoriteGifts: ['로즈골드 마이크', '리본 장식', '샴페인 플라워'],
    signatureItems: ['핑크 골드 핸드 마이크', '블러시 핑크 인이어', '진주 리본 핀'],
    representativeContent: ['센터 직캠', '필터 무드 숏폼', '팬서비스 클립'],
    adCategory: '메인스트림 뷰티 · 아이돌 무대 · 팬미팅 캠페인',
    premiumPoint: '센터 단독 직캠, 화보형 팬서비스 컷, 스페셜 무대 클립',
    unlockItem: '샴페인 핑크 크리스털 무대룩',
    boostPoint: '대중 투표와 메인픽 경쟁에 강한 화사한 센터 이미지',
    representativeColors: ['Champagne Gold', 'Blush Pink'],
    relationshipPosition: '메인 라인의 밝은 중심축',
    publicOneLiner:
      '화사한 비주얼과 안정적인 스타성으로 Lumina Stage의 대중성을 넓히는 센터형 캐릭터.',
  },
  'park-doa': {
    birthDate: '2001-11-22',
    displayBirthDate: '2001년 11월 22일',
    hometown: '부산 해운대구',
    height: '160cm',
    bloodType: 'B형',
    mbti: 'ESFP',
    debut: '2024년 Lumina Stage 1기',
    position: '스트리머 라인 / 커뮤니티 전환형 캐릭터',
    characterType: '생활형 소통 리액션형',
    fandomNameCandidate: 'Doable',
    fandomNameStatus: '운영 후보',
    fanPoint: '반달 눈웃음, 큰 리액션, 팬과 바로 친구가 되는 친근함',
    speechKeywords: ['밝음', '솔직함', '리액션 큼', '장난스럽고 편한 말투'],
    hobbies: ['맛집 지도 만들기', '라이브 채팅 읽기', '편의점 신상 리뷰'],
    favoriteGifts: ['하트 머그컵', '대형 디저트', '귀여운 헤드셋'],
    signatureItems: ['게이밍 헤드셋', '콘덴서 마이크', '코랄 오버핏 후드'],
    representativeContent: ['먹방 리액션', '일상 브이로그', '댓글 반응 숏폼'],
    adCategory: '캐주얼 푸드 · 생활용품 · 커뮤니티 이벤트',
    premiumPoint: '팬 이름 불러주는 리액션 영상, 특별 먹방 리액션, 커뮤니티 감사 메시지',
    unlockItem: '100만 팬 기념 리본 블라우스',
    boostPoint: '팬 참여와 댓글 반응을 가장 쉽게 끌어내는 친근함',
    representativeColors: ['Warm Coral', 'Juicy Orange'],
    relationshipPosition: '팬과 가장 가까운 생활형 친구 포지션',
    publicOneLiner:
      '큰 리액션과 따뜻한 생활감으로 팬을 가장 편하게 끌어들이는 Lumina Stage의 소통형 캐릭터.',
  },
  'choi-seojin': {
    birthDate: '1992-12-03',
    displayBirthDate: '1992년 12월 3일',
    hometown: '서울 성동구',
    height: '170cm',
    bloodType: 'AB형',
    mbti: 'ENTJ',
    debut: '2024년 Lumina Stage 1기',
    position: '프리미엄 메인 / 배우 라인 / 브랜드 간판',
    characterType: '성숙한 럭셔리 카리스마형',
    fandomNameCandidate: 'Seojin Atelier',
    fandomNameStatus: '운영 후보',
    fanPoint: '여유로운 카리스마, 깊은 눈빛, 고급스러운 존재감',
    speechKeywords: ['낮고 안정적', '여유 있음', '단정함', '가끔 따뜻한 언니미'],
    hobbies: ['전시 관람', '와인 노트 정리', '클래식 필름 감상'],
    favoriteGifts: ['샴페인 플라워', '블랙 클러치', '스테이트먼트 주얼리'],
    signatureItems: ['볼드 주얼리', '크리스털 잔', '블랙 실크 드레스'],
    representativeContent: ['프리미엄 화보', '브랜드 무드 필름', '레드카펫 숏폼'],
    adCategory: '럭셔리 뷰티 · 주얼리 · 시계 · 레드카펫 필름',
    premiumPoint: '독점 화보 컷, 프라이빗 브랜드 필름, 레드카펫 백스테이지',
    unlockItem: '딥 블랙 실크 이브닝 드레스',
    boostPoint: '고급감과 브랜드 신뢰도를 올리는 프리미엄 존재감',
    representativeColors: ['Deep Black', 'Champagne Gold'],
    relationshipPosition: '메인 라인의 프리미엄 권위와 무게감',
    publicOneLiner:
      '우아한 카리스마와 프리미엄 존재감으로 Lumina Stage의 브랜드 가치를 끌어올리는 간판 캐릭터.',
  },
  'oh-hyerin': {
    birthDate: '2000-06-06',
    displayBirthDate: '2000년 6월 6일',
    hometown: '제주특별자치도 제주시',
    height: '158cm',
    bloodType: 'A형',
    mbti: 'INFJ',
    debut: '2024년 Lumina Stage 1기',
    position: '감성 메인보컬 / 음원 퀸 / 팬덤 코어 담당',
    characterType: '감성 보컬 위로형',
    fandomNameCandidate: 'Hyerin Note',
    fandomNameStatus: '운영 후보',
    fanPoint: '촉촉한 눈빛, 조용한 위로, 오래 남는 목소리',
    speechKeywords: ['조심스러움', '따뜻함', '느린 호흡', '진심 어린 문장'],
    hobbies: ['새벽 산책', '가사 메모', '빈티지 다이어리 꾸미기'],
    favoriteGifts: ['라벤더 편지지', '따뜻한 머그잔', '작은 큐빅 귀걸이'],
    signatureItems: ['스탠딩 마이크', '가죽 다이어리', '페일 라벤더 시폰 드레스'],
    representativeContent: ['감성 보컬 클립', '팬레터 무드 숏폼', '음성 답장'],
    adCategory: '감성 음원 · 다이어리 굿즈 · 소프트 뷰티 · 힐링 캠페인',
    premiumPoint: '팬 이름이 들어간 음성 답장, 새벽 라이브 무드 필름, 감성 보컬 스페셜 컷',
    unlockItem: '페일 라벤더 보컬 스테이지 드레스',
    boostPoint: '조용하지만 오래 남는 팬코어와 충성도',
    representativeColors: ['Pale Lavender', 'Ash Beige'],
    relationshipPosition: '메인 라인의 감정선과 위로를 담당하는 보컬 축',
    publicOneLiner:
      '맑고 깊은 목소리로 팬에게 조용한 위로를 건네는 Lumina Stage의 감성 메인보컬.',
  },
  'cha-dohyun': {
    birthDate: '1999-09-17',
    displayBirthDate: '1999년 9월 17일',
    hometown: '서울 마포구',
    height: '178cm',
    bloodType: 'B형',
    mbti: 'ENTP',
    debut: '2024년 Lumina Stage 1기',
    position: '하이패션 K-pop 아티스트 / 남성 메인 비주얼 후보',
    characterType: '젠더리스 하이패션 아티스트형',
    fandomNameCandidate: 'Dohyverse',
    fandomNameStatus: '운영 후보',
    fanPoint: '실험적인 스타일, 반항적인 스머크, 무대 위 스웨그',
    speechKeywords: ['자신감', '위트', '짧은 농담', '감각적인 표현'],
    hobbies: ['빈티지 숍 탐방', '커스텀 액세서리 제작', '밤 산책 플레이리스트 만들기'],
    favoriteGifts: ['실버 체인', '커스텀 마이크', '아방가르드 재킷'],
    signatureItems: ['진주/실버 체인 레이어링', '볼드 링', '틴트 선글라스'],
    representativeContent: ['하이패션 티저', '스테이지 스웨그 숏폼', '매거진 화보'],
    adCategory: '스트릿 럭셔리 · 하이패션 · 액세서리 · 아티스트 필름',
    premiumPoint: '단독 매거진 컷, 커스텀 무대 영상, 스타일링 해금 콘텐츠',
    unlockItem: '블랙 트위드 하이패션 스테이지 재킷',
    boostPoint: '첫 남성 캐릭터로서 여성 팬 유입과 스타일 워너비 반응을 동시에 테스트',
    representativeColors: ['Obsidian Black', 'Metallic Silver', 'Deep Purple'],
    relationshipPosition: '남성 라인업의 첫 공개 얼굴이자 패션 아티스트 축',
    publicOneLiner:
      '젠더리스 하이패션과 반항적인 무대 태도로 Lumina Stage의 남성 라인업을 여는 아티스트.',
  },
  'seo-yuan': {
    birthDate: '2000-02-18',
    displayBirthDate: '2000-02-18',
    hometown: 'Seoul',
    height: '168cm',
    bloodType: 'A',
    mbti: 'ISFJ',
    debut: 'Lumina Stage candidate',
    position: 'Natural luxury beauty and lifestyle muse',
    characterType: 'premium model',
    fandomNameCandidate: 'Yuandear',
    fandomNameStatus: 'candidate',
    fanPoint: 'calm smile, clean beauty, graceful lifestyle mood',
    speechKeywords: ['calm', 'warm', 'polished'],
    hobbies: ['fragrance notes', 'home styling', 'skincare routine'],
    favoriteGifts: ['ivory flowers', 'fragrance card', 'silk ribbon'],
    signatureItems: ['silk blouse', 'oatmeal cardigan', 'minimal pearl earrings'],
    representativeContent: ['skincare portrait', 'fragrance mood film', 'premium lifestyle cut'],
    adCategory: 'skincare, fragrance, lifestyle',
    premiumPoint: 'clean beauty close-up and calm luxury lifestyle film',
    unlockItem: 'ivory silk campaign styling',
    boostPoint: 'premium natural beauty line candidate',
    representativeColors: ['Pure White', 'Oatmeal Beige', 'Pale Sky Blue'],
    relationshipPosition: 'natural luxury candidate line',
    publicOneLiner:
      'A calm natural-luxury muse for skincare, fragrance, and premium lifestyle content.',
  },
} as const;

const shortforms = [
  ['yoon-serin-main-visual-teaser', '메인 비주얼 티저', 'yoon-serin', '첫 진입용 메인 비주얼 쇼츠', 'thumb'],
  ['yoon-serin-concept-performance', '콘셉트 퍼포먼스', 'yoon-serin', '무대 장악력과 퍼포먼스 이미지를 강화하는 쇼츠', 'cover'],
  ['han-seoyul-filter-mood-look', '필터 무드 룩', 'han-seoyul', '정면 비주얼과 대중성 확장에 맞춘 필터형 쇼츠', 'thumb'],
  ['han-seoyul-light-filter-teaser', '청량 필터 쇼츠', 'han-seoyul', '밝고 반짝이는 필터 무드로 첫인상을 여는 쇼츠', 'cover'],
  ['park-doa-friendly-reaction', '친근 리액션 쇼츠', 'park-doa', '생활형 리액션과 팬 반응을 대화로 연결하는 쇼츠', 'thumb'],
  ['park-doa-mukbang-reaction-teaser', '먹방 리액션 티저', 'park-doa', '친근한 먹방 시리즈 무드로 공감과 참여를 끌어내는 쇼츠', 'cover'],
  ['choi-seojin-editorial-core', '에디토리얼 코어 무드', 'choi-seojin', '브랜드 제안과 화보형 무드를 보여주는 프리미엄 쇼츠', 'thumb'],
  ['choi-seojin-brand-mood-film', '브랜드 무드 필름', 'choi-seojin', '광고와 화보 적합성을 보여주는 프리미엄 라인 쇼츠', 'cover'],
  ['oh-hyerin-emotional-vocal', '감성 보컬 클립', 'oh-hyerin', '감성 보컬과 위로형 분위기를 보여주는 음원형 쇼츠', 'thumb'],
  ['oh-hyerin-midnight-letter', '새벽 팬레터 무드', 'oh-hyerin', '팬레터와 감성 챗으로 이어지는 조용한 새벽 무드 쇼츠', 'cover'],
  ['cha-dohyun-high-fashion-teaser', '하이패션 아티스트 티저', 'cha-dohyun', '첫 남성 아티스트의 하이패션 무드와 무대 존재감을 보여주는 쇼츠', 'thumb'],
  ['cha-dohyun-stage-swag', '스테이지 스웨그', 'cha-dohyun', '젠더리스 패션과 무대 장악력을 강조하는 퍼포먼스 쇼츠', 'cover'],
] as const;

const galleryDirsBySlug = {
  'yoon-serin': ['reference-final'],
  'han-seoyul': ['.'],
  'park-doa': ['reference-final'],
  'seo-yuan': ['.'],
  'choi-seojin': ['.'],
  'cha-dohyun': ['.'],
} as const;

const publicSeedArtistSlugs = new Set(Object.keys(galleryDirsBySlug));

async function main() {
  const artistBySlug = new Map<string, { id: string; displayName: string }>();
  const assetByKey = new Map<string, { id: string }>();

  for (const artist of artists) {
    const status = isPublicSeedArtist(artist.slug) ? 'active' : 'draft';
    const row = await prisma.artist.upsert({
      where: { slug: artist.slug },
      update: {
        displayName: artist.displayName,
        status,
        sortOrder: artist.sortOrder,
        updatedAt: new Date(),
      },
      create: {
        slug: artist.slug,
        displayName: artist.displayName,
        status,
        sortOrder: artist.sortOrder,
        launchedAt,
      },
    });

    if (status === 'active') {
      artistBySlug.set(artist.slug, row);
    }

    await prisma.artistPublicProfile.upsert({
      where: { artistId: row.id },
      update: {
        tagline: artist.tagline,
        summary: artist.summary,
        personalityKeywords: [...artist.keywords],
        publicStory: artist.story,
        publicMetadata: {
          seed: true,
          profileFacts: profileFactsBySlug[artist.slug],
        },
        updatedAt: new Date(),
      },
      create: {
        artistId: row.id,
        tagline: artist.tagline,
        summary: artist.summary,
        personalityKeywords: [...artist.keywords],
        publicStory: artist.story,
        publicMetadata: {
          seed: true,
          profileFacts: profileFactsBySlug[artist.slug],
        },
      },
    });

    await prisma.artistVisualProfile.upsert({
      where: { artistId: row.id },
      update: {
        visualKeywords: [...artist.visualKeywords],
        primaryColor: artist.primaryColor,
        secondaryColor: artist.secondaryColor,
        updatedAt: new Date(),
      },
      create: {
        artistId: row.id,
        visualKeywords: [...artist.visualKeywords],
        primaryColor: artist.primaryColor,
        secondaryColor: artist.secondaryColor,
      },
    });

    await prisma.artistContentProfile.upsert({
      where: { artistId: row.id },
      update: {
        contentTone: artist.tagline,
        allowedTopics: [...artist.keywords],
        blockedTopics: ['민감한 성적 묘사', '혐오 표현', '개인정보 요구'],
        operatingNotes: 'MVP seed profile',
        updatedAt: new Date(),
      },
      create: {
        artistId: row.id,
        contentTone: artist.tagline,
        allowedTopics: [...artist.keywords],
        blockedTopics: ['민감한 성적 묘사', '혐오 표현', '개인정보 요구'],
        operatingNotes: 'MVP seed profile',
      },
    });

    for (const usageType of ['cover', 'thumb'] as const) {
      const storageKey = `assets/characters/${artist.slug}/${usageType}.png`;
      if (!assetStorageKeyExists(storageKey)) {
        continue;
      }

      const asset = await upsertImageAsset(storageKey, `${artist.displayName} ${usageType}`);
      assetByKey.set(storageKey, asset);

      await prisma.artistAsset.upsert({
        where: {
          artistId_assetId_usageType: {
            artistId: row.id,
            assetId: asset.id,
            usageType,
          },
        },
        update: { isPrimary: true, sortOrder: usageType === 'cover' ? 10 : 20 },
        create: {
          artistId: row.id,
          assetId: asset.id,
          usageType,
          isPrimary: true,
          sortOrder: usageType === 'cover' ? 10 : 20,
        },
      });
    }

    for (const [index, storageKey] of getGalleryImageKeys(artist.slug).entries()) {
      const asset = await upsertImageAsset(storageKey, `${artist.displayName} gallery ${index + 1}`);
      assetByKey.set(storageKey, asset);

      await prisma.artistAsset.upsert({
        where: {
          artistId_assetId_usageType: {
            artistId: row.id,
            assetId: asset.id,
            usageType: 'gallery',
          },
        },
        update: { isPrimary: false, sortOrder: 100 + index },
        create: {
          artistId: row.id,
          assetId: asset.id,
          usageType: 'gallery',
          isPrimary: false,
          sortOrder: 100 + index,
        },
      });
    }
  }

  for (const [slug, title, artistSlug, description, assetRole] of shortforms) {
    const artist = artistBySlug.get(artistSlug);
    if (!artist) continue;

    const storageKey = `assets/characters/${artistSlug}/${assetRole}.png`;
    const asset =
      assetByKey.get(storageKey) ??
      (assetStorageKeyExists(storageKey) ? await upsertImageAsset(storageKey, title) : null);
    const shortform = await prisma.shortform.upsert({
      where: { slug },
      update: {
        title,
        description,
        artistId: artist.id,
        status: 'published',
        publishedAt: launchedAt,
        updatedAt: new Date(),
      },
      create: {
        artistId: artist.id,
        title,
        slug,
        description,
        status: 'published',
        publishedAt: launchedAt,
      },
    });

    if (!asset) {
      continue;
    }

    await prisma.shortformAsset.upsert({
      where: {
        shortformId_assetId_role: {
          shortformId: shortform.id,
          assetId: asset.id,
          role: 'thumbnail',
        },
      },
      update: { sortOrder: 10 },
      create: {
        shortformId: shortform.id,
        assetId: asset.id,
        role: 'thumbnail',
        sortOrder: 10,
      },
    });
  }

  await seedCommerce();
  await seedBoosts();
  await seedPremiumAndChat();
}

async function seedCommerce() {
  const luminaProducts = [
    ['LUMINA_1000', '루미나 1,000', 1000, 0, 10000],
    ['LUMINA_3300', '루미나 3,000 + 보너스 300', 3000, 300, 30000],
    ['LUMINA_5800', '루미나 5,000 + 보너스 800', 5000, 800, 50000],
    ['LUMINA_12000', '루미나 10,000 + 보너스 2,000 (1 스텔라+)', 10000, 2000, 100000],
  ] as const;

  for (const [sku, name, luminaAmount, bonusAmount, priceAmount] of luminaProducts) {
    await prisma.luminaProduct.upsert({
      where: { sku },
      update: {
        name,
        luminaAmount,
        bonusAmount,
        priceAmount,
        priceCurrency: 'KRW',
        status: 'active',
        updatedAt: new Date(),
      },
      create: {
        sku,
        name,
        luminaAmount,
        bonusAmount,
        priceAmount,
        priceCurrency: 'KRW',
        status: 'active',
      },
    });
  }

  await prisma.luminaProduct.updateMany({
    where: {
      sku: { in: ['LUMINA_100', 'LUMINA_550', 'LUMINA_1200'] },
    },
    data: {
      status: 'archived',
      updatedAt: new Date(),
    },
  });

  const gifts = [
    ['GIFT_HEART', '응원 하트', 'instant', 10, 0, null],
    ['GIFT_SPOTLIGHT', '스포트라이트 응원', 'instant', 50, 0, null],
    ['GIFT_STAGE_UNLOCK', '스테이지 의상 해금', 'progressive', 1000, 1000, 10000],
  ] as const;

  for (const artist of publicSeedArtists()) {
    const artistRow = await prisma.artist.findUniqueOrThrow({ where: { slug: artist.slug } });
    for (const [sku, name, giftKind, priceLumina, progressAmount, targetAmount] of gifts) {
      await prisma.giftProduct.upsert({
        where: { sku: `${sku}_${skuSuffix(artist.slug)}` },
        update: {
          name,
          giftKind,
          priceLumina,
          progressAmount,
          targetAmount,
          status: 'active',
          updatedAt: new Date(),
        },
        create: {
          artistId: artistRow.id,
          sku: `${sku}_${skuSuffix(artist.slug)}`,
          name,
          giftKind,
          priceLumina,
          progressAmount,
          targetAmount,
          status: 'active',
          metadata: { seed: true },
        },
      });
    }
  }
}

async function seedBoosts() {
  await prisma.boostProduct.upsert({
    where: { sku: 'BOOST_BASIC_VOTE' },
    update: {
      name: '루미나 기본 투표',
      boostAmount: 10,
      priceLumina: 10,
      status: 'active',
      updatedAt: new Date(),
    },
    create: {
      sku: 'BOOST_BASIC_VOTE',
      name: '루미나 기본 투표',
      boostAmount: 10,
      priceLumina: 10,
      status: 'active',
      metadata: { seed: true, policy: 'basic_paid_vote' },
    },
  });

  await prisma.boostProduct.upsert({
    where: { sku: 'BOOST_100' },
    update: {
      name: '루미나 부스트 100',
      boostAmount: 100,
      priceLumina: 100,
      status: 'active',
      updatedAt: new Date(),
    },
    create: {
      sku: 'BOOST_100',
      name: '루미나 부스트 100',
      boostAmount: 100,
      priceLumina: 100,
      status: 'active',
      metadata: { seed: true },
    },
  });

  await prisma.boostCampaign.upsert({
    where: { slug: 'mvp-launch-main-pick' },
    update: {
      name: 'MVP 런칭 메인픽',
      description: '초기 공개 6캐릭터 부스트 캠페인',
      status: 'active',
      startsAt: launchedAt,
      endsAt: new Date('2026-12-31T14:59:59.000Z'),
      freeLikeWeight: 1,
      luminaBoostWeight: 1,
      dailyFreeLikeLimit: 1,
      updatedAt: new Date(),
    },
    create: {
      slug: 'mvp-launch-main-pick',
      name: 'MVP 런칭 메인픽',
      description: '초기 공개 6캐릭터 부스트 캠페인',
      status: 'active',
      startsAt: launchedAt,
      endsAt: new Date('2026-12-31T14:59:59.000Z'),
      freeLikeWeight: 1,
      luminaBoostWeight: 1,
      dailyFreeLikeLimit: 1,
      metadata: { seed: true },
    },
  });
}

async function seedPremiumAndChat() {
  for (const artist of publicSeedArtists()) {
    const artistRow = await prisma.artist.findUniqueOrThrow({ where: { slug: artist.slug } });

    await prisma.premiumVideoProduct.upsert({
      where: { sku: `PREMIUM_VIDEO_${skuSuffix(artist.slug)}` },
      update: {
        title: `${artist.displayName} 프리미엄 무드 필름`,
        description: `${artist.displayName} 전용 프리미엄 영상 상품`,
        priceLumina: 300,
        status: 'active',
        publishedAt: launchedAt,
        updatedAt: new Date(),
      },
      create: {
        artistId: artistRow.id,
        sku: `PREMIUM_VIDEO_${skuSuffix(artist.slug)}`,
        title: `${artist.displayName} 프리미엄 무드 필름`,
        description: `${artist.displayName} 전용 프리미엄 영상 상품`,
        priceLumina: 300,
        status: 'active',
        publishedAt: launchedAt,
      },
    });

    const personaId = stablePersonaId(artist.slug);
    await prisma.chatPersona.upsert({
      where: { id: personaId },
      update: {
        name: `${artist.displayName} 기본 페르소나`,
        status: 'active',
        systemPrompt: `${artist.displayName}의 공개 캐릭터 설정을 유지하며 밝고 안전하게 대화한다.`,
        safetyRules: { seed: true, noImpersonation: true },
        modelConfig: { temperature: 0.7 },
        updatedAt: new Date(),
      },
      create: {
        id: personaId,
        artistId: artistRow.id,
        name: `${artist.displayName} 기본 페르소나`,
        status: 'active',
        systemPrompt: `${artist.displayName}의 공개 캐릭터 설정을 유지하며 밝고 안전하게 대화한다.`,
        safetyRules: { seed: true, noImpersonation: true },
        modelConfig: { temperature: 0.7 },
      },
    });
  }

  const chatFeatures = [
    ['CHAT_SPECIAL_REPLY', '특별 답장', 'special_reply', 30],
    ['CHAT_VOICE_REPLY', '음성 답장', 'voice_reply', 80],
    ['CHAT_IMAGE_REPLY', '이미지형 응답', 'image_reply', 120],
  ] as const;

  for (const [sku, name, featureType, priceLumina] of chatFeatures) {
    await prisma.chatFeatureProduct.upsert({
      where: { sku },
      update: { name, featureType, priceLumina, status: 'active', updatedAt: new Date() },
      create: { sku, name, featureType, priceLumina, status: 'active', metadata: { seed: true } },
    });
  }
}

async function upsertImageAsset(storageKey: string, title: string) {
  return prisma.asset.upsert({
    where: { storageProvider_storageKey: { storageProvider: 'local', storageKey } },
    update: {
      assetType: 'image',
      visibility: 'public',
      mimeType: 'image/png',
      metadata: { title, seed: true },
      updatedAt: new Date(),
    },
    create: {
      assetType: 'image',
      visibility: 'public',
      storageProvider: 'local',
      storageKey,
      mimeType: 'image/png',
      metadata: { title, seed: true },
    },
  });
}

function getGalleryImageKeys(slug: string) {
  const dirs = galleryDirsBySlug[slug as keyof typeof galleryDirsBySlug] ?? [];
  const keys: string[] = [];

  for (const dir of dirs) {
    const storageDir = dir === '.' ? `assets/characters/${slug}` : `assets/characters/${slug}/${dir}`;
    const localDir = resolveAssetDir(storageDir);

    if (!localDir) {
      continue;
    }

    const fileNames = readdirSync(localDir)
      .filter((fileName) => /\.(png|jpe?g|webp)$/i.test(fileName))
      .filter((fileName) => dir !== '.' || /^reference-final-\d+\.(png|jpe?g|webp)$/i.test(fileName))
      .sort((a, b) => a.localeCompare(b, 'en'));

    for (const fileName of fileNames) {
      keys.push(`${storageDir}/${fileName}`);
    }
  }

  return keys;
}

function assetStorageKeyExists(storageKey: string) {
  return Boolean(resolveAssetDir(storageKey));
}

function resolveAssetDir(storageDir: string) {
  const candidates = [join(process.cwd(), '..', storageDir), join(process.cwd(), storageDir)];
  return candidates.find((candidate) => existsSync(candidate));
}

function skuSuffix(slug: string) {
  return slug.toUpperCase().replaceAll('-', '_');
}

function isPublicSeedArtist(slug: string) {
  return publicSeedArtistSlugs.has(slug);
}

function publicSeedArtists() {
  return artists.filter((artist) => isPublicSeedArtist(artist.slug));
}

function stablePersonaId(slug: string) {
  const hash = createHash('sha1').update(slug).digest('hex');
  return `00000000-0000-4000-8000-${hash.slice(0, 12)}`;
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
