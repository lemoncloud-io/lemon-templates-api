# 의존성 보안 점검 (npm audit)

2026-10-29 기준 기록이다.
대상은 운영 의존성 트리(`npm audit --omit=dev`)뿐이다.
개발 전용 의존성(devDependencies) 항목은 오너 결정으로 범위 밖이다.

## 결과

| 구분 | 변경 전 | 변경 후 |
| --- | --- | --- |
| `npm audit --omit=dev` | 24건 (critical 1, moderate 23) | 3건 (moderate 3) |
| `npm audit` 전체 (참고) | 57건 (critical 7, high 8, moderate 31, low 11) | 37건 (critical 6, high 8, moderate 12, low 11) |

## 변경 1 — AWS SDK v3 잠금 갱신

- lemon-core가 쓰는 `@aws-sdk/client-dynamodb`·`@aws-sdk/lib-dynamodb`가 3.972.0에 머물러 있었다.
- 이 버전의 `@aws-sdk/core` → `@aws-sdk/xml-builder`가 `fast-xml-parser` 5.2.5를 고정했다.
- 5.2.5에는 critical 1건을 포함한 여러 권고가 있다 (예: GHSA-m7jm-9gc2-mpf2, GHSA-8gc5-j5rx-235r).
- 잠금 파일에서 해당 항목을 지우고 다시 풀었다. `package.json` 범위(`^3.971.0`)는 그대로다.
- 결과: `@aws-sdk/core` 3.978.7, `@aws-sdk/xml-builder` 3.972.42. 새 xml-builder는 `fast-xml-parser`에 의존하지 않는다.
- 같은 버전이 직접 의존 클라이언트(iam·kms·lambda·s3·sns·sqs·sts 등)에도 공유된다. 중첩 사본이 사라져 트리가 작아졌다.
- override는 쓰지 않았다.

## 변경 2 — override

```json
"overrides": {
  "lemon-core": { "uuid": "^11.1.1" }
}
```

- 대상 권고: GHSA-w5hq-g745-h8pq (uuid < 11.1.1, buf 경계 검사 누락).
- 범위: lemon-core 아래 uuid만. 다른 uuid 사본은 건드리지 않는다.
- 근거: lemon-core는 `require("uuid")`의 `v4()`만 쓴다. uuid 11은 CommonJS 진입점을 계속 제공한다.
- 확인: `$U.uuid()`가 정상 값을 낸다.

## 남은 항목 (운영 트리)

| 패키지 | 심각도 | 남는 이유 | 배포 번들 포함 |
| --- | --- | --- | --- |
| decode-uri-component 0.2.2 | moderate | 수정판(0.5.x)은 ESM 전용이다. query-string 7의 `require()`가 함수를 받지 못해 런타임이 깨진다. lemon-core 저장소 후속 작업이다. | 예 |
| query-string 7.1.3 | moderate | 위 항목 때문에 표시된다. 수정 경로는 lemon-core가 query-string 7을 다른 구현(예: `URLSearchParams`, 이미 의존 중인 `qs`)으로 바꾸는 것이다. | 예 |
| lemon-core 5.0.3 | moderate | query-string 때문에 표시된다. `npm audit`이 제안하는 lemon-core@1.1.6은 메이저 다운그레이드라 쓰지 않는다. | 예 |

## 하지 않은 것

- `npm audit fix --force`는 쓰지 않았다.
- 개발 전용 항목(serverless v3 하위, jest 27, codecov, nodemon, lemon-devkit → request)은 손대지 않았다.
