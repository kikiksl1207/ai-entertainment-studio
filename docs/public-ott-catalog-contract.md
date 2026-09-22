# Public OTT catalog contract

The public OTT surface is intentionally separate from Story and from the existing owner-private OTT preview.

## Publication registry

`OTT_PUBLIC_CATALOG_RELEASES` is a JSON array controlled by the server environment. An absent, empty, malformed, duplicated, partially localized, fixture, draft, future-dated, or otherwise invalid array fails closed to an empty catalog. Each candidate must explicitly pin:

- `status: "published"`
- `source: "authored_uploaded_clips"`
- `fixtureSource: false`
- `rightsAuthorization: "cleared_for_public_streaming"`
- an authorization time, publication time, work ID, authored playback manifest ID, and the approved rights-contract version IDs that cover every media version in the manifest
- complete `ko`, `en`, `ja`, `zh-Hans`, and `zh-Hant` title, synopsis, and creator-name text

The registry is an explicit publication allowlist, not a replacement for persisted checks. Before each public list/detail projection, the server also requires:

- the exact authored manifest under the pinned work;
- an internally valid graph with at least one clip;
- exact immutable asset pins for every referenced source;
- confirmed, unrevoked uploads whose versions and confirmation hashes still match;
- approved rights-contract configurations for the same OTT work that collectively cover every media version in the manifest, each with `ott_streaming`, an approver, and a currently effective time window.

Any failed lookup, invalid value, exception, or withdrawn prerequisite excludes that title. One invalid release does not expose partial private data.

## Public response boundary

`GET /api/v1/ott` returns `{ items }`. `GET /api/v1/ott/:slug` returns one item or 404. Items contain only localized title, synopsis and creator name, slug, publication time, a public detail path, and `viewing.available: false`.

The public response never includes owner IDs, work IDs, manifest IDs, graphs, file/version IDs, storage keys, raw URLs, cookies, grants, tokens, subtitles, private preview paths, or delivery paths. No public watch-start endpoint is defined by this slice. The UI therefore offers catalog/detail information only and plainly says when viewing is unavailable.
