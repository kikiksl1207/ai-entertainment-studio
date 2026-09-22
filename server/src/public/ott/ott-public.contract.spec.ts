import { parseOttPublicReleaseRegistry, toOttPublicCatalogItem } from './ott-public.contract';

const id = (value: string) => `${value.repeat(8)}-${value.repeat(4)}-4${value.repeat(3)}-8${value.repeat(3)}-${value.repeat(12)}`;
const localized = (prefix: string) => ({ ko: `${prefix} ko`, en: `${prefix} en`, ja: `${prefix} ja`, 'zh-Hans': `${prefix} zh`, 'zh-Hant': `${prefix} zht` });
const release = {
  slug: 'author-cut', workId: id('1'), manifestId: id('2'), rightsContractVersionIds: [id('3')],
  status: 'published', source: 'authored_uploaded_clips', fixtureSource: false,
  rightsAuthorization: 'cleared_for_public_streaming',
  authorizedAt: '2026-09-20T00:00:00.000Z', publishedAt: '2026-09-21T00:00:00.000Z',
  title: localized('title'), synopsis: localized('synopsis'), creatorName: localized('creator'),
};

describe('OTT public registry contract', () => {
  it('fails closed for absent, malformed, fixture, draft, or incomplete localized entries', () => {
    expect(parseOttPublicReleaseRegistry(undefined)).toEqual([]);
    expect(parseOttPublicReleaseRegistry('{')).toEqual([]);
    expect(parseOttPublicReleaseRegistry(JSON.stringify([{ ...release, fixtureSource: true }]))).toEqual([]);
    expect(parseOttPublicReleaseRegistry(JSON.stringify([{ ...release, status: 'draft' }]))).toEqual([]);
    expect(parseOttPublicReleaseRegistry(JSON.stringify([{ ...release, title: { ko: 'only one locale' } }]))).toEqual([]);
    expect(parseOttPublicReleaseRegistry(JSON.stringify([{ ...release, rightsContractVersionIds: [] }]))).toEqual([]);
    expect(parseOttPublicReleaseRegistry(JSON.stringify([{ ...release, rightsContractVersionIds: [id('3'), id('3')] }]))).toEqual([]);
  });

  it('projects public metadata without internal identifiers or a playback path', () => {
    const parsed = parseOttPublicReleaseRegistry(JSON.stringify([release]));
    const item = toOttPublicCatalogItem(parsed[0]);
    expect(item).toMatchObject({ slug: 'author-cut', detailPath: '/ott?title=author-cut', viewing: { available: false } });
    expect(JSON.stringify(item)).not.toMatch(/workId|manifestId|rightsContract|fileId|storage|token|url/i);
  });
});
