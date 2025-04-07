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
