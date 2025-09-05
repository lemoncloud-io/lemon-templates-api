# UPGRADE GUIDE: lemon-core V3 to V4

## Description

Summarized how to upgrade lemon-core v3 to v4

1. update lemon-core version v3 to v4
2. update node.js v18 to v22
3. update aws sdk v2 to v3
4. update cores and related files

## How to upgrade to lemon-core v4 & Node.js 22

### 1. 패키지 업데이트

```bash
# 런타임 의존성 업데이트
npm install lemon-core@^4.0.7 --save

# 개발 의존성 업데이트
npm install --save-dev lemon-devkit@0.0.6
```

---

### 2. Node.js 22.x 적용

#### `.nvmrc`

```diff
- 18.19.1
+ 22.15.1
```

#### `config.js`

```diff
- runtime: 'nodejs18.x'
+ runtime: 'nodejs22.x',
```

#### `package.json`

```diff
"engines": {
-  "node": ">=18.19.1"
+  "node": "22"
},
```

#### `serverless.yml`

```diff
plugins:
- - serverless-offline
+  # WARN - failure in nodejs 22.x due to `serverless-offline` plugin @250627
+  # - serverless-offline
```

> **주의:** Node.js 22.x 환경에서 `serverless-offline` 플러그인 사용 시 오류 발생 보고됨 → 주석 처리

---

### 3. 코드 변경 사항

#### init.package.ts (`@types/bin/init.package.ts`) & express.ts(`src/express.ts`) 최신화

- **코드 동작 안정화 및 lemon-core v4 호환성 반영**

#### **Cores 최신화**

- 권한 확인 유틸 추가: canDo 기능 도입
- 테스트 컨텍스트 로딩 규약 변경: loadJsonSync → **loadSample**로 대체.

  ```ts
  import { loadSample } from './contexts.spec';
  ```

  > 기존 `loadJsonSync`가 `loadSample`로 대체됨

- [OS2 FGAC 자격증명 정리: accessKey, secretKey Deprecated.](HOW_TO_USE_OS2.md)
- [OS2 JWT 서명 키 보안 강화: 서명 키를 암호화 상태로 보관/사용하도록 개선.](HOW_TO_USE_OS2.md)
