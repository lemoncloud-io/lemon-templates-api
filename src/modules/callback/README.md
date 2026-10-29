# module / callback

- 백엔드 서비스 분리로, `module/callback` 모듈화
- `callback` 외부 처리 요청후 응답 관리

## description

run test locally.

```sh
$ npm run test:watch /backend- /transformer. /callback/
```

## 디자인컨셉

`S`: 콜백 요청자, `T`: 타겟 함수

1. 콜백 요청을 기록하고 추적함 (`S` -> `T` 호출 w/ `callback`)
    - id 로 추적관리

2. 이때, 응답에 대한 정의와 변환 그리고 콜백 처리를 해줘야함 (`T` -> `S` 호출)
    - param := 콜백 파라미터
    - body := result 응답 전달
    - context := 원본 context. (keep `.identity`)

3. 에러 핸들러 개선
    - 콜백 보안 강화목적으로 `T`에서 callback 주소 검증 (`/callback/<id>/cmd?`만 가능함)
    - 콜백 요청시 `SQS` 이용 -> 보안 트래킹
    - `@param.signature` 에 콜백 보안 토큰 확인함. (signature := hash(id + nonce))

## 루프 테스트

배포 후 SNS·SQS·protocol·notify·enqueue 경로가 실제로 도는지 로그 줄로 확인한다. 코드는 `loop.ts`와 `api-callback.ts`에 있다.

| 경로 | 하는 일 | 권한 |
|---|---|---|
| `POST /callback/<kind>/loop` | `kind`(`sns`·`sqs`·`protocol`·`notify`·`enqueue`)로 메시지 1건을 보낸다. `[LOOP] send` 줄을 남긴다. | admin만 |
| `POST /callback/<loopId>/loop-recv` | protocol 수신부(`protocol`은 `lambda`, `notify`·`enqueue`는 `backend`). `[LOOP] recv` 줄을 남기고 돌려준다. | protocol 경유(`depth > 0`) 또는 admin |
| `onLoopMessage()` | SNS·SQS 수신부(`src/engine.ts`가 등록). `[LOOP] recv` 줄을 남긴다. | 제목 `x-loop-test`만 |

루프 테스트 수신부는 로그만 남긴다. 재발신하지 않는다.

- 수신부(SNS·SQS 리스너, `loop-recv`)는 로그만 남기고 돌아간다. publish·send·enqueue·notify·execute를 부르지 않는다.
- 트리거는 protocol 경유 재진입을 거부한다. `400 INVALID LOOP - nested trigger`.
- payload의 `hop`은 1이어야 한다. 다른 값은 `[LOOP] bad`로 남기고 버린다. 수신부는 `hop`을 올려 다시 보내지 않는다.
- SNS·SQS 수신부는 throw 하지 않는다. protocol 경유 `loop-recv`도 throw 하지 않는다. 재시도·재전달이 생기지 않는다.
- `notify`·`enqueue`는 callback을 넘기지 않는다. callback이 있으면 수신 뒤 한 번 더 호출된다.
- 서명 검증 실패(`PROTOCOL_VERIFY=enforce`)는 lemon-core가 우리 핸들러 전에 던진다. SQS는 보존 기간(30분) 동안 재전달된다. 큐에 DLQ가 없다.
- 앱 코드에 cron·재시도 루프가 없다. 점검 스크립트 `npm run loop:check`는 kind마다 한 번만 호출한다.

### 로컬 점검 (`LOCAL_TRANSPORT=mock`)

로컬 서버에서도 다섯 경로를 돌린다. AWS를 부르지 않는다.

- `npm run express.lemon`으로 서버를 띄운다. 이 명령은 `LOCAL_TRANSPORT=mock`을 켠다.
- lemon-core 로컬 전송이 발신을 같은 프로세스에서 전달한다. Lambda 레코드를 만들고 `LambdaHandler.handle()`로 돌린다.
- 대상은 이 서비스만이다. 다른 토픽·큐·함수는 `501 NOT SUPPORTED`다.
- 트리거는 전달이 끝날 때까지 기다린다(`$localTransport.drain()`). 응답에 `mock: true`와 `recv`를 더한다.
- `recv`는 이 `loopId`의 수신 결과 목록이다. 항목은 `{ kind, loopId, recvAt, hop }`이다. 정상이면 1개다.
- `[LOOP] send` 줄 끝에 ` mock=1`이 붙는다. Lambda 동작은 바뀌지 않는다.
- 수신 결과는 로컬 전송이 켜졌을 때만 메모리에 둔다(`localRecv`, loop id 최대 100개).
- 점검: `npm run loop:check -- --target express`. 기대: 다섯 줄 모두 `send=ok recv=ok`, exit 0.
- 실제 AWS로 보내려면 `npm run express.lemon.aws`로 띄운다.

spec: `api-callback-loop.spec.ts`, `api-callback-loop-mock.spec.ts`(로컬 전송 끝-끝, AWS SDK 호출 0). 점검: [bin/README.md](../../../bin/README.md#loopcheck).
