import { createHash } from 'crypto';
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
] as const;

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

async function main() {
  const artistBySlug = new Map<string, { id: string; displayName: string }>();
  const assetByKey = new Map<string, { id: string }>();

  for (const artist of artists) {
    const row = await prisma.artist.upsert({
      where: { slug: artist.slug },
      update: {
        displayName: artist.displayName,
        status: 'active',
        sortOrder: artist.sortOrder,
        updatedAt: new Date(),
      },
      create: {
        slug: artist.slug,
        displayName: artist.displayName,
        status: 'active',
        sortOrder: artist.sortOrder,
        launchedAt,
      },
    });
    artistBySlug.set(artist.slug, row);

    await prisma.artistPublicProfile.upsert({
      where: { artistId: row.id },
      update: {
        tagline: artist.tagline,
        summary: artist.summary,
        personalityKeywords: [...artist.keywords],
        publicStory: artist.story,
        publicMetadata: { seed: true },
        updatedAt: new Date(),
      },
      create: {
        artistId: row.id,
        tagline: artist.tagline,
        summary: artist.summary,
        personalityKeywords: [...artist.keywords],
        publicStory: artist.story,
        publicMetadata: { seed: true },
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
  }

  for (const [slug, title, artistSlug, description, assetRole] of shortforms) {
    const artist = artistBySlug.get(artistSlug);
    if (!artist) continue;

    const storageKey = `assets/characters/${artistSlug}/${assetRole}.png`;
    const asset = assetByKey.get(storageKey) ?? (await upsertImageAsset(storageKey, title));
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
    ['LUMINA_100', '루미나 100', 100, 0, 1100],
    ['LUMINA_550', '루미나 500 + 보너스 50', 500, 50, 5500],
    ['LUMINA_1200', '루미나 1000 + 보너스 200', 1000, 200, 11000],
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

  const gifts = [
    ['GIFT_HEART', '응원 하트', 'instant', 10, 0, null],
    ['GIFT_SPOTLIGHT', '스포트라이트 응원', 'instant', 50, 0, null],
    ['GIFT_STAGE_UNLOCK', '스테이지 의상 해금', 'progressive', 100, 100, 1000],
  ] as const;

  for (const artist of artists) {
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
  for (const artist of artists) {
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

function skuSuffix(slug: string) {
  return slug.toUpperCase().replaceAll('-', '_');
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
