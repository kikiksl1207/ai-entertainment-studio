export const PUBLIC_ARTIST_COPY_LOCALES = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'] as const;

export type PublicArtistCopyLocale = (typeof PUBLIC_ARTIST_COPY_LOCALES)[number];

export type PublicArtistCopy = {
  displayName: string;
  tagline: string;
  summary: string;
  publicStory: string;
};

export const publicArtistCopyBySlug = {
  'seo-yuan': {
    ko: {
      displayName: '서유안',
      tagline: '꾸밈없이 오래 머무는 내추럴 럭셔리 모델',
      summary: '투명한 분위기와 편안한 신뢰감으로 일상에 스며드는 모델.',
      publicStory:
        '서유안은 투명한 피부와 단아한 롱헤어, 미니멀한 아이보리 룩이 인상적인 모델이다. 스킨케어와 향수, 홈리빙 캠페인에서 차분하고 신뢰감 있는 분위기를 만든다.',
    },
    en: {
      displayName: 'Seo Yuan',
      tagline: 'A natural-luxury model whose quiet presence lingers',
      summary: 'A model who brings luminous beauty and calm confidence into everyday life.',
      publicStory:
        'Seo Yuan is known for luminous skin, graceful long hair, and minimal ivory styling. She brings a calm, trustworthy mood to skincare, fragrance, and home-living campaigns.',
    },
    ja: {
      displayName: 'Seo Yuan',
      tagline: '飾らない空気が長く残るナチュラルラグジュアリーモデル',
      summary: '透明感と穏やかな信頼感で、日常に自然となじむモデル。',
      publicStory:
        'Seo Yuanは、透明感のある肌と端正なロングヘア、ミニマルなアイボリールックが印象的なモデルです。スキンケア、フレグランス、ホームリビングのキャンペーンに、穏やかで信頼感のある空気をもたらします。',
    },
    'zh-Hans': {
      displayName: 'Seo Yuan',
      tagline: '以自然气质留下长久印象的轻奢模特',
      summary: '以通透气质与舒适信赖感，自然融入日常的模特。',
      publicStory:
        'Seo Yuan以通透肌肤、优雅长发和极简象牙白造型为标志。她在护肤、香氛与家居生活广告中，呈现沉静而值得信赖的氛围。',
    },
    'zh-Hant': {
      displayName: 'Seo Yuan',
      tagline: '以自然氣質留下長久印象的輕奢模特',
      summary: '以通透氣質與舒適信賴感，自然融入日常的模特。',
      publicStory:
        'Seo Yuan以通透肌膚、優雅長髮和極簡象牙白造型為標誌。她在保養、香氛與居家生活廣告中，呈現沉靜而值得信賴的氛圍。',
    },
  },
  'kwon-taejun': {
    ko: {
      displayName: '권태준',
      tagline: '깊은 눈빛과 낮은 목소리의 누아르 배우',
      summary: '긴 침묵과 절제된 감정으로 장면의 여운을 남기는 배우.',
      publicStory:
        '권태준은 깊은 눈빛과 낮은 목소리로 누아르, 수트, 향수 캠페인에 어울리는 배우다. 대사가 많지 않아도 절제된 감정의 무게를 장면에 오래 남긴다.',
    },
    en: {
      displayName: 'Kwon Taejun',
      tagline: 'A noir actor with a deep gaze and low voice',
      summary: 'An actor who leaves a lasting impression through silence and restrained emotion.',
      publicStory:
        'Kwon Taejun is an actor whose deep gaze and low voice suit noir stories, tailored suits, and fragrance campaigns. Even with few lines, he leaves the weight of restrained emotion in every scene.',
    },
    ja: {
      displayName: 'Kwon Taejun',
      tagline: '深いまなざしと低い声を持つノワール俳優',
      summary: '長い沈黙と抑えた感情で、シーンに余韻を残す俳優。',
      publicStory:
        'Kwon Taejunは、深いまなざしと低い声を持ち、ノワールやスーツ、フレグランスのキャンペーンに似合う俳優です。台詞が多くなくても、抑えた感情の重みをシーンに長く残します。',
    },
    'zh-Hans': {
      displayName: 'Kwon Taejun',
      tagline: '拥有深邃目光与低沉声线的黑色电影演员',
      summary: '以长久的沉默和克制的情感，为画面留下余韵的演员。',
      publicStory:
        'Kwon Taejun拥有深邃的目光与低沉的声线，适合黑色电影、西装与香氛广告。即使台词不多，也能让克制情感的重量长久留在画面中。',
    },
    'zh-Hant': {
      displayName: 'Kwon Taejun',
      tagline: '擁有深邃目光與低沉聲線的黑色電影演員',
      summary: '以長久的沉默和克制的情感，為畫面留下餘韻的演員。',
      publicStory:
        'Kwon Taejun擁有深邃的目光與低沉的聲線，適合黑色電影、西裝與香氛廣告。即使臺詞不多，也能讓克制情感的重量長久留在畫面中。',
    },
  },
} as const satisfies Record<string, Record<PublicArtistCopyLocale, PublicArtistCopy>>;

export function publicArtistCopyFor(
  slug: string,
): Record<PublicArtistCopyLocale, PublicArtistCopy> | undefined {
  return (publicArtistCopyBySlug as Partial<
    Record<string, Record<PublicArtistCopyLocale, PublicArtistCopy>>
  >)[slug];
}
