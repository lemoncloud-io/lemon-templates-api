# module / mock

- 백엔드 서비스 모듈화 분리로, `module/mock` 모듈
- `TestModel`은 모델/뷰/트랜스포머/proxy/use-case 지침의 골든 샘플이다.

## description

run test locally.

```sh
$ npm run test:watch /backend- /transformer. /mock/
```

## Golden Contract

`TestModel`은 아래 패턴을 유지해야 한다.

- head 분리: `TestHead`
- 단일 참조: `mockId + mock$`
- 배열 참조: `mockIds + mock$$`
- 전체 모델 참조: `readonly $mock`, `readonly $mocks`
- transformer 입력: `mockId`, `mockIds`만 body 저장 대상으로 처리
- transformer 출력: `mock$`, `mock$$`는 `MockView`로 변환
- proxy 검증: `mockId`, `mockIds` 변경 시 `mock$`, `mock$$`를 자동 갱신

변경 시 함께 업데이트할 파일:

- `src/modules/mock/model.ts`
- `src/modules/mock/views.ts`
- `src/modules/mock/transformer.ts`
- `src/modules/mock/proxy.ts`
- `src/modules/mock/transformer.spec.ts`
- `src/modules/mock/proxy.spec.ts`
- `src/generated/field-registry.ts` (`npm run fields:gen`)
- `docs/proxy-implementation-guide.md`
