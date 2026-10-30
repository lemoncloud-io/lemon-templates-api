# 의존성 보안 점검 (npm audit)

2026-10-29 기준 기록이다. 변경 1·2는 운영 의존성 트리(`npm audit --omit=dev`)만 다룬다.
2026-10-30에 개발 전용 의존성 항목도 정리했다(변경 3).

## 결과

| 구분 | 변경 전 | 변경 후 |
| --- | --- | --- |
| `npm audit --omit=dev` | 24건 (critical 1, moderate 23) | 0건 |
| `npm audit` 전체 (참고) | 57건 (critical 7, high 8, moderate 31, low 11) | 34건 (critical 6, high 8, moderate 9, low 11) |
| `npm audit` 전체 (2026-10-30, 변경 3) | 23건 (critical 2, high 4, moderate 6, low 11) | 0건 |

## 변경 1 — lemon-core ^5.0.4

- lemon-core 5.0.4는 `uuid`와 `query-string`에 더 이상 의존하지 않는다.
- 그래서 아래 운영 트리 항목이 함께 사라졌다.
  - `uuid` < 11.1.1 (GHSA-w5hq-g745-h8pq).
  - `query-string` 7 → `decode-uri-component` 0.2.2 (GHSA-vcc3-ghjq-m6fr).
- lemon-core 5.0.4는 `@aws-sdk/client-dynamodb`·`@aws-sdk/lib-dynamodb` ^3.1159.0을 요구한다.
- 이 때문에 직접 의존 AWS 클라이언트(iam·kms·lambda·s3·sns·sqs·sts·credential-providers)도 3.1159.0으로 풀렸다. `package.json` 범위(`^3.971.0`)는 그대로다.
- override는 쓰지 않는다.

## 변경 2 — AWS SDK v3 잠금 갱신

- v5의 잠금 파일은 `@aws-sdk/core` → `@aws-sdk/xml-builder` 3.972.0을 거쳐 `fast-xml-parser` 5.2.5를 고정했다.
- 5.2.5에는 critical 1건을 포함한 여러 권고가 있다 (예: GHSA-m7jm-9gc2-mpf2, GHSA-8gc5-j5rx-235r).
- 새 `@aws-sdk/xml-builder`(3.972.42 이상)는 `fast-xml-parser`에 의존하지 않는다.
- 중첩 사본이 공유 사본으로 합쳐져 운영 트리가 작아졌다.

## 변경 3 — 개발 전용 항목 (2026-10-30)

- 23건은 Serverless Framework 패키지를 뺀 뒤의 수다.
- `codecov`를 뺐다. 쓰는 스크립트가 없었다. `teeny-request` → `uuid`, `js-yaml` 3.14.1 경로가 사라졌다.
- `lemon-devkit` ^0.2.2 → ^0.2.3(2026-10-31에 삭제 — lemon-core 5.0.14가 환경 로딩·로컬 서버를 직접 제공). `express`도 2026-10-31 삭제 — lemon-core 5.0.15의 내장 로컬 앱이 확장 라우트를 받는다. 0.2.3은 `request`에 의존하지 않는다. `request`·`form-data`·`qs`·`tough-cookie`·`uuid`가 사라졌다.
- `nodemon` ^2.0.18 → ^3.1.14. `simple-update-notifier` → `semver` 경로가 사라졌다.
- `jest` 27 → ^29.7.0, `ts-jest` → ^29.4.15, `@types/jest` → ^29.5.14. `jsdom` → `http-proxy-agent` → `@tootallnate/once` 경로가 사라졌다.
  - `jest.config.json`: ts-jest 옵션을 `transform` 튜플로 옮겼다. `testRunner: jest-jasmine2`를 지웠다(기본 jest-circus).
  - ts-jest의 `compiler: ttypescript`를 지웠다. `tsconfig.json`에 `plugins`가 없어 결과가 같다. 빌드(`ttsc`)는 그대로다.
  - spec 4건의 `async done =>`를 `async () =>`로 바꿨다. jest-circus는 둘을 함께 받지 않는다.
- `deepmerge`(GHSA-gcqx-w48m-w2h4)는 고친 판이 없다. jest 29의 `jest-config`도 쓴다. lemon-model과 같은 개발 전용 대체본 `scripts/deepmerge-safe/`를 `overrides`로 넣었다.
- `js-yaml` 3.x는 `babel-plugin-istanbul` → `@istanbuljs/load-nyc-config`(`^3.13.1`)가 남은 경로다. 잠금 파일이 3.15.2(고친 판)로 풀렸다. override는 쓰지 않는다.

## 남은 항목 (운영 트리)

없다.

## 하지 않은 것

- `npm audit fix --force`는 쓰지 않았다.
- 변경 1·2 때 개발 전용 항목은 손대지 않았다. 2026-10-30 변경 3에서 정리했다.
