# sync-v5-tooling — 이 저장소의 v5 도구를 다른 서비스에 옮기기

`bin/sync-v5-tooling.mjs`는 이 저장소(`v5`)를 레시피로 삼아, 다른 lemon-core v5 서비스 체크아웃에 세 묶음을 같은 모양으로 넣는다. 설치·빌드·커밋은 하지 않는다. 기본은 보고만(dry-run)이고 `--apply`가 쓴다.

```sh
node bin/sync-v5-tooling.mjs --target ../codes-backend-api                  # 바뀔 것만 출력
node bin/sync-v5-tooling.mjs --target ../codes-backend-api --apply          # 쓰기
node bin/sync-v5-tooling.mjs --target ../A --target ../B --only pkg,bin --sls keep --json report.json
```

| 옵션                     | 뜻                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `--target <dir>`         | 대상 서비스 체크아웃. 여러 번 줄 수 있다                                                                      |
| `--apply`                | 실제로 쓴다. 없으면 보고만                                                                                    |
| `--sls auto\|full\|keep` | Serverless 제거 방식. `auto`(기본)는 `sls` 스크립트가 `lemon` 밖 계정 프로필로 배포하면 `keep`, 아니면 `full` |
| `--only pkg,bin,types`   | 묶음 선택(기본 셋 다)                                                                                         |
| `--json <file>`          | 보고를 JSON으로도 남긴다                                                                                      |
| `--source <dir>`         | 레시피 체크아웃(기본: 이 저장소)                                                                              |

## 세 묶음

| 묶음    | 하는 일                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 근거                                                   |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `pkg`   | Serverless 패키지·`sls` 스크립트·B38 가드(`scripts/migrated-stage-guard.mjs`) 제거 + `docs/serverless.md`에 마지막 구성 기록(`full`일 때). `deepmerge-safe` 사본과 `overrides`(`deepmerge`·`minimatch`·`test-exclude`). `lemon-core`·`nodemon`은 레시피보다 낮으면 올린다. 아무도 안 쓰는 dev 의존성(`codecov`, `typedoc` 셋 + `docs` 스크립트·`typedoc.json`, 선언·import 없는 `@types/cors`·`@types/request`·`@types/uuid`) 제거. `typedoc`이 선언돼 있지 않으면 남은 `typedoc.json`도 지운다. Serverless를 지울 때 그 패키지로만 들어오던 패키지가 아직 쓰이면 `note`로 알린다(r4, 아래 판단 기준)                                                                                                                                                                       | hello #77(D85), templates #55·#61, cognitos B41 R2, r4 |
| `bin`   | `bin/deploy-dev.sh` 복사(서비스 이름은 `package.json`에서 읽으므로 무변경), `npm run deploy:dev`, `.gitignore`(`.artifacts/`·`.pack-publish-*/`·`.wt/`·`.claude/worktrees/`), `docs/lambda-tools.md` 표 행 + 절, README 표 행(`npm run lambda:*` 행이 있는 표가 있을 때, r4: 머리글 언어 무관·2~4열, 마지막 `lambda:*` 행 뒤)                                                                                                                                                                                                                                                                                                                                                                                                                                               | templates #62, r4                                      |
| `types` | `@types/bin/{rewrite-imports,verify-types,lemon-model-pair}.ts`·`@types/tsconfig.verify.json` 복사, `init-package.ts`의 고정 `MODEL_VERSION` 상수를 설치된 lemon-model 짝으로 교체, `tsconfig.build.json` `incremental: false`, 추적되던 `tsbuildinfo` 삭제, `types`·`types:rewrite`·`types:verify` 스크립트, `.eslintignore`에서 `@types/dist` 제외 해제 + `.eslintrc.js` overrides(`@types/dist`는 `lemon-model`만, `no-empty-interface` 끔 — tsc가 `eslint-disable` 주석을 버리므로), `@types/README.md` 제목. 검증기는 설치된 lemon-model의 `exports`가 내는 서브경로(`lemon-model/upload` 등)를 허용하고, `init-package.ts`의 직접 `lemon-model` 핀도 짝(`^<installed>`)으로 쓴다(r3). 검증기 (b)는 `lemon-model`·`lemon-model/*`을 짝 폴더로 고정해 타입 검사한다(r4) | D107, templates #64, r3, r4                            |

`@types/package.json`이 없는 서비스(hello 계열)는 `types`를 건너뛴다.

## 도구가 하지 않는 것 — `--apply` 뒤 사람이 한다

1. `npm install` → lock 재생성, `npm audit` 전체·`--omit=dev` 0 확인(`js-yaml` 3.14는 `npm update js-yaml`).
2. `npm run build`, `npx tsc --noEmit`, `npx eslint . --ext .ts`, `npm test`.
3. `npm run types` → `@types/package.json`(lemon-model 짝)과 `@types/dist`가 다시 생긴다. 둘 다 커밋한다. `posttypes`(publish dry-run)는 루트 버전이 semver가 아니면 실패한다(오너 항목).
4. 보고의 `note` 줄: README·`docs/lambda-tools.md`의 산문("Serverless stays installed", `deploy.lemon` 안내)은 도구가 고치지 않는다. 손으로 lemon-\* 도구 기준으로 바꾼다.
5. 보고의 `OWNER` 줄: `--sls auto`가 `keep`으로 둔 저장소(다른 계정 프로필이 `sls`로 배포)는 Serverless를 그대로 둔다. 완전 제거는 오너 결정이다.

## 판단 기준(도구 안에 박힌 것)

-   **Serverless `keep`의 기준은 프로필이다.** `lemon`·`dou-lemon`·`osx-lemon`·`none`(기본 프로필)은 같은 계정이다. 그 밖의 이름(`ssocio`·`muzly`·`epyt`·`colover`·`tbpm`…)이 `sls` 스크립트에 있으면 다른 계정이 이 저장소로 배포한다는 뜻이라 패키지와 스크립트를 남긴다(eureka-hello #20 방식).
-   **`@types/x`는 모듈이 선언되거나 import될 때만 남긴다.** `src/`·`scripts/`·루트 스크립트에서 `from 'x'`·`require('x')`를 찾는다.
-   **파일 복사는 바이트 동일.** 레시피 파일(`bin/deploy-dev.sh`, `@types/bin/*.ts`, `deepmerge-safe/*`)은 서비스마다 고치지 않는다. 서비스 이름이 필요한 곳은 런타임에 `package.json`에서 읽는다. 문서 절만 `lemon-templates-api` → 대상 이름으로 바꾼다.
-   **산문은 건드리지 않는다.** 표 행 삽입은 표의 열 수를 맞춰 넣고, 그 밖의 문장은 `note`로 알린다.
-   **Serverless만 데려오던 패키지는 알리기만 한다(r4).** 대상의 `package-lock.json`으로 남는 선언 의존성에서 닿는 패키지와 지운 Serverless 패키지에서만 닿는 패키지를 가른다. 뒤쪽 가운데 `src/`·`scripts/`·루트 스크립트·설치된 `@lemoncloud/*` 타입 선언(`node_modules`가 있을 때)이 import하거나, 선언 의존성의 선택 peer인 것을 `note`로 알린다(import 위치 포함, 예: codes-backend `node-fetch` = `fetch-mock`의 선택 peer, codes-goods `@aws-sdk/client-cloudformation` = `@lemoncloud/eureka-codes-api` 타입). 의존성은 넣지 않는다. 선언할지(런타임이 쓰면 `dependencies`)는 사람이 정한다. 설치되지 않은 `@lemoncloud/*`가 있으면 그 사실도 `note`로 남긴다 — `node_modules`를 둔 채 dry-run을 다시 돌린다.
-   **README 행은 `npm run lambda:` 행이 든 표에 넣는다(r4).** 머리글 언어는 보지 않는다. 그런 표가 여럿이면 그런 행이 가장 많은 표를 고르고, 마지막 `npm run lambda:*` 행 뒤에 열 수(2·3·4)를 맞춘 행을 넣는다. 이미 `npm run deploy:dev` 행이 있으면(`npm run lambda:deploy:dev`는 다른 스크립트) 넣지 않는다. 표가 없거나 열 수가 다르면 `note`다.
-   **검증기 (b)는 짝 폴더를 검사한다(r4).** `@types/bin/verify-types.ts`는 메모리 안 컴파일러 옵션 `paths`로 `lemon-model`과 `lemon-model/*`(내보낸 서브경로는 그 `types`)을 `lemonModelPair(SERVICE).modelDir`에 묶는다. `@lemoncloud/*` devDeps가 루트에 끌어올린 옛 1.x가 아니라 lemon-core의 짝으로 타입을 검사한다. 짝 폴더 밖의 `lemon-model` 파일이 프로그램에 들어오면 (b) 실패다. (a) 규칙은 그대로다.

같은 도구를 두 번 돌려도 결과는 같다(멱등). 레시피가 바뀌면 다시 돌려 차이만 받는다.
