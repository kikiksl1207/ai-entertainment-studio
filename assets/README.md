# Character Image Assets

이 폴더는 실제 캐릭터 이미지 자산을 넣는 자리입니다.

## 권장 방식
- 메인 3인 + 프리미엄 메인부터 먼저 넣기
- 각 캐릭터당 최소 2장
  - `cover.jpg` : 카드/상세 대표 비주얼
  - `thumb.jpg` : 목록/숏폼 보조 썸네일

## 폴더 규칙
- `assets/characters/<slug>/cover.jpg`
- `assets/characters/<slug>/thumb.jpg`

예시:
- `assets/characters/yoon-serin/cover.jpg`
- `assets/characters/yoon-serin/thumb.jpg`

## 1차 우선 캐릭터
- `yoon-serin`
- `han-seoyul`
- `park-doa`
- `choi-seojin`

## 이미지 준비 방법
1. 직접 만든 AI 이미지 사용
2. 외부 툴에서 만든 이미지 사용
3. 추후 동일 캐릭터 세트로 교체

## 권장 비율
- `cover.jpg` : 세로형 4:5 또는 2:3
- `thumb.jpg` : 세로형 4:5

## 주의
- 파일명은 반드시 소문자 `cover.jpg`, `thumb.jpg`
- 파일이 없으면 현재 사이트는 그라데이션 카드로 fallback 됩니다
