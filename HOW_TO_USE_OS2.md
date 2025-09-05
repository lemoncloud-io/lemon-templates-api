# OS2 + FGAC 사용 가이드 (lemon-templates-api)

OpenSearch(OS2)를 FGAC(Fine-Grained Access Control) JWT를 통해 접근하는 방법을 설명합니다.

## 사전 요구사항

- lemon-core 4.0.0 이상 (이 브랜치에서 이미 적용됨)
- Node.js 22.x 이상 (package.json의 engines 기준)

---

## 0) eureka-codes-api에서 인덱스 생성 및 message/signature 추출

1. eureka-codes-api를 통해 인덱스 생성 및 권한(Role/User/Actions) 부여
2. 발급된 `message`, `signature` (또는 `jwt`) 값을 확보

예시 응답 형태:

```json
{
  "id": "25035776",
  "indexName": "lemon-templates-v1",
  "message": "<헤더.페이로드 (서명 제외)>",
  "signature": "*<AWS KMS로 암호화된 signature(CiphertextBlob)>", // '*'이 꼭 포함되어야함.
}
```

---

## 1) cores 최신화

- 프로젝트 내 cores를 lemon-templates-api 내 최신화된 cores로 업데이트 합니다.

```bash
npm i
# package.json: "lemon-core": "^4.0.0" 이상인지 확인
```

---

## 2) env/${profile}.yml 환경변수 구성 (lemon 예시)

- 파일: `env/lemon.yml`
- 필수 키
  - `OS2_ENDPOINT`: OS2(Managed OpenSearch) 엔드포인트 URL
  - `OS2_INDEX`: 실제 접근할 인덱스 이름(접미사 포함, 예: `lemon-templates-v1-25035776`)
  - `OS2_MESSAGE`: eureka-codes-api에서 발급된 `message` (서명 제외)
  - `OS2_SIGNATURE`: `signature`를 AWS KMS로 암호화한 CiphertextBlob.

예시 설정:

```yaml
# env/lemon.yml
# ... (기타 설정 생략)
OS2_ENDPOINT: 'https://search-<lemon-os2-domain>.<region>.es.amazonaws.com'
OS2_INDEX: 'lemon-templates-v1-25035776'
OS2_MESSAGE: '<eureka-codes-api에서 받은 message>'
OS2_SIGNATURE: '<aws kms encrypt로 얻은 CiphertextBlob>'
# OS2_JWT_TOKEN: '<옵션: 전체 JWT(헤더.페이로드.서명)>'
```

---

## 동작 방식

- OS2 요청은 SIGv4 프록시를 사용하며, `Authorization: Bearer <JWT>` 헤더로 FGAC를 통과합니다.
- `OS2_MESSAGE` + `OS2_SIGNATURE`를 조합하여 `message.signature` 형태로 JWT를 구성
- 실제 헤더 구성 코드 (참고):

```1932:1953:src/cores/abstract-services.ts
const message = $U.env('OS2_MESSAGE', '');
const signature = ($config as ConfigModule)?.config?.get('OS2_SIGNATURE') as string;

const jwtToken = `${message}.${signature}`;

const headers: APIHeaders = {
    Authorization: `Bearer ${jwtToken}`,
    'Content-Type': 'application/json',
};
```

- FGAC로 위임되는 API (일부): `search`, `read`, `save(index)`, `bulk`, `update`, `delete`, `indices.*(describe/get/put/close/open/delete)`

---

## 자주 발생하는 이슈

- 401/403 Unauthorized
  - JWT 만료 여부(`exp`) 확인
  - `OS2_INDEX`가 JWT의 `indexName`(또는 권한 범위)과 일치하는지 확인
  - OS2 도메인/리전이 맞는지 확인
- 400 mapper_parsing_exception
  - 매핑/설정 변경 시 `doFgacPutMapping`, `doFgacPutSettings` 적용 순서와 값 확인