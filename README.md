# currency_tracking

원화 대비 주요 환율의 최근 3개월 추이를 모바일 퍼스트로 보여주는 순수 `HTML/CSS/JavaScript` 대시보드입니다.

현재 포함 통화:
- USD/KRW
- JPY/KRW
- PHP/KRW
- THB/KRW

## 배포 주소

- GitHub Pages: https://redhands.github.io/currency_tracking/

## 주요 기능

- 모바일 퍼스트 레이아웃
- 통화별 요약 카드 가로 스크롤
- 메인 비교 차트
- `변동률로 비교` 모드: 여러 통화 동시 비교
- `실환율 보기` 모드: 선택한 통화 1개만 표시
- 실시간 현재값 반영 구조
- 모바일 아코디언 상세 정보
- 데스크톱 표 보기

## 파일 구성

- `index.html`: 메인 페이지
- `styles.css`: 전체 스타일
- `script.js`: 환율 데이터 로딩 및 차트 렌더링
- `config.js`: 새로고침 주기 및 실시간 API 키 설정
- `FX_KRW_TREND_PAGE_PLAN.md`: 초기 기획 문서

## 실행 방법

정적 파일 프로젝트라서 별도 빌드 없이 바로 열 수 있습니다.

1. `index.html`을 브라우저에서 엽니다.

또는 간단한 로컬 서버로 실행할 수 있습니다.

```bash
python3 -m http.server 8000
```

그 뒤 브라우저에서 `http://localhost:8000`으로 접속하면 됩니다.

## 실시간 환율 설정

기본적으로는 최근 3개월 추이를 불러오고, 실시간 API 키가 있으면 현재값을 주기적으로 갱신합니다.

설정 파일: [config.js](/Users/redhands/Devel/currency_tracking/config.js)

```js
window.FX_DASHBOARD_CONFIG = {
  refreshMs: 60 * 1000,
  exchangerateHostAccessKey: "",
};
```

- `refreshMs`: 자동 갱신 주기
- `exchangerateHostAccessKey`: 실시간 환율 API 키

## 데이터 소스

- 추이 데이터: Frankfurter
- 실시간 현재값: ExchangeRate.host

실시간 API 키가 없거나 연결에 실패하면, 화면에는 최신 기준값 또는 데모 데이터가 표시됩니다.
