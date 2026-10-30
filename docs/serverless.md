# Serverless Framework — 권장 구성 기록

2026-10-30부터 이 저장소는 Serverless Framework 패키지를 설치하지 않는다. 배포·패키징·로그·호출은 lemon-core의 `lemon-*` 명령이 맡는다([lambda-tools.md](lambda-tools.md), [lambda-deploy.md](lambda-deploy.md), [lambda-pack.md](lambda-pack.md)).

설정 파일은 남아 있다.

- `serverless.yml`, `serverless-vpc.yml` — 함수·이벤트·환경 정의. `lemon-*` 도구도 `serverless.yml`의 `service:`와 http 이벤트를 읽는다.
- `serverless.yml`의 `plugins:` 목록도 그대로다. 패키지가 없으면 `sls` 명령만 동작하지 않는다.

## Serverless로 직접 배포·운영하려면

아래는 지울 때의 구성이다. 이 저장소에서 마지막으로 동작한 조합이라 그대로 쓰기를 권한다.

### devDependencies

| 패키지 | 선언 범위 | 마지막 설치판 |
| --- | --- | --- |
| `serverless` | `^3.19.0` | 3.40.0 |
| `serverless-aws-documentation` | `^0.8.0` | 0.8.0 |
| `serverless-plugin-log-retention` | `^2.0.0` | 2.1.0 |
| `serverless-prune-plugin` | `^2.0.1` | 2.1.0 |
| `@cruglobal/serverless-merge-config` | `^1.1.0` | 1.1.0 |

```sh
npm i -D serverless@^3.19.0 serverless-aws-documentation@^0.8.0 serverless-plugin-log-retention@^2.0.0 serverless-prune-plugin@^2.0.1 @cruglobal/serverless-merge-config@^1.1.0
```

- Serverless Framework 3.x 기준이다. 4.x는 로그인·라이선스 방식이 달라 이 저장소에서 검증하지 않았다.
- `serverless-offline`은 Node 22 이상에서 실패해 이미 꺼져 있다(`serverless.yml` 주석). 로컬 실행은 `npm run express.lemon`과 `npm run lambda:local`을 쓴다.
- 이 패키지들은 개발 전용이고, 설치하면 `npm audit`(전체) 경고가 늘어난다(지울 때 34 → 23건, `node_modules` 514 MB → 299 MB). `npm audit --omit=dev`는 그대로 0이다.

### scripts

`package.json`의 `scripts`에 다시 넣는다. 인자 없는 `info`·`logs`·`remove`는 prod를 가리킨다.

```json
"deploy.lemon": "npm run build && sls deploy --param='profile=lemon' --stage dev",
"deploy.lemon-vpc": "npm run build && sls deploy --param='profile=lemon' --stage dev --config serverless-vpc.yml",
"deploy.lemon.prod": "npm run build && sls deploy --param='profile=lemon' --stage prod",
"pack.lemon": "npm run build && sls package --param='profile=lemon' --stage dev",
"pack.lemon.prod": "npm run build && sls package --param='profile=lemon' --stage prod",
"info": "sls info --stage prod",
"info.lemon": "sls info --param='profile=lemon' --stage dev",
"info.lemon.prod": "sls info --param='profile=lemon' --stage prod",
"logs": "sls logs --stage prod -t --startTime 5m -f hello",
"logs.lemon": "sls logs --param='profile=lemon' --stage dev -t --startTime 5m -f lambda",
"logs.lemon.prod": "sls logs --param='profile=lemon' --stage prod -t --startTime 5m -f lambda",
"remove": "sls remove --stage prod",
"remove.lemon": "sls remove --param='profile=lemon' --stage dev",
"remove.lemon.prod": "sls remove --param='profile=lemon' --stage prod"
```

`deploy.*`·`remove.*`는 사람만 실행한다. 에이전트는 사람이 명시적으로 시킬 때만 돌린다.

## 대신 쓰는 명령

| 예전 (`sls`) | 지금 |
| --- | --- |
| `pack.lemon` | `npm run pack` (`lemon-lambda-pack`) |
| `deploy.lemon` | `npm run lambda:deploy` (`lemon-lambda-deploy`, 기본은 계획만, `--apply`로 실행) |
| `logs.lemon` | `npm run lambda:logs` (`lemon-lambda-logs`) |
| `info.lemon`, `remove.*` | 대응 명령 없음 — 필요하면 위 구성으로 `sls`를 다시 설치한다 |
