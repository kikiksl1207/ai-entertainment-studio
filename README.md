# AI Entertainment Studio

이 프로젝트는 기존 `alli-mvp`와 분리된, AI 엔터테인먼트/캐릭터 플랫폼용 정적 사이트 프로토타입입니다.

## 현재 포함 범위
- 엔터 사이트 메인/캐릭터/상세/숏폼/비즈니스 페이지
- 캐릭터 이미지 자산 연결 구조
- 운영/기획 문서 폴더
- 에이전트 역할 정의 폴더

## 파일 구조
- `index.html` : 메인 랜딩 페이지
- `characters.html` : 캐릭터 목록 페이지
- `character-detail.html` : 캐릭터 상세 페이지
- `shortform.html` : 숏폼 피드 페이지
- `business.html` : 광고/제휴 페이지
- `styles.css` : 공통 스타일 및 모바일 반응형
- `app.js` : 캐릭터 데이터 및 페이지 렌더링 로직
- `assets/` : 캐릭터 이미지 자산
- `docs/` : 기획/운영 문서
- `agents/` : 역할 기반 AI 에이전트 문서

## 로컬 확인 방법
설치 없이 브라우저에서 `index.html`을 열면 바로 확인할 수 있습니다.

## 이미지 자산 규칙
- 자산 가이드는 `assets/README.md` 참고
- 메인 캐릭터부터 `cover`, `thumb`를 우선 채우는 구조
- 이미지가 없으면 일부 카드는 fallback 스타일로 표시됩니다

## Deployment

이 저장소는 GitHub Pages로 배포하기 좋게 구성되어 있습니다.

### 추천 배포 방식
1. GitHub 저장소의 `main` 브랜치에 최신 코드를 push합니다.
2. 저장소에서 `Settings > Pages`로 이동합니다.
3. `Build and deployment`의 Source를 `GitHub Actions`로 설정합니다.
4. 저장소에 포함된 워크플로우가 자동으로 사이트를 배포합니다.

### 예상 배포 주소

GitHub Pages가 활성화되면 아래 주소로 열리게 됩니다.

`https://kikiksl1207.github.io/ai-entertainment-studio/`

## 인수인계 포인트
- 캐릭터 시트는 노션의 `02. 캐릭터 문서` 아래에서 관리
- 사이트 반영 순서는 `시트 확정 -> 이미지 생성 -> 사이트 적용 -> GitHub 반영`
- 작업 마무리 시 다음 작업을 이어받을 수 있도록 `다음은 이거 해야 합니다` 기준으로 이어가면 됩니다
