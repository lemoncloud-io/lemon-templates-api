# 의존성 보안 점검 (npm audit)

2026-10-29 기준 기록이다.
대상은 운영 의존성 트리(`npm audit --omit=dev`)뿐이다.
개발 전용 의존성(devDependencies) 항목은 오너 결정으로 범위 밖이다.

## 결과

| 구분 | 변경 전 | 변경 후 |
| --- | --- | --- |
| `npm audit --omit=dev` | 24건 (critical 1, moderate 23) | 0건 |
| `npm audit` 전체 (참고) | 57건 (critical 7, high 8, moderate 31, low 11) | 34건 (critical 6, high 8, moderate 9, low 11) |

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

## 남은 항목 (운영 트리)

없다.

## 하지 않은 것

- `npm audit fix --force`는 쓰지 않았다.
- 개발 전용 항목(serverless v3 하위, jest 27, codecov, nodemon, lemon-devkit → request)은 손대지 않았다.
