# ssocio-templates-api

- ssocio sites management api

## Description

Summarized specifications to design modeling



## Development

**[Overall]**

1. design the proto-type of model structure in `mocks-xxxx.yml`
2. access mocks via `/mocks/xxxx` api.
    - use GET `/mocks/<id>` to read from storage.
    - use POST `/mocks/<id>` tp save into storage.
3. implements the model `manager` with `transformer` + `validator`

### Design Pattern

Inspired by MVC(Model-View-Control) design pattern. but `View` is layout definitions of JSON API.

Flow: 
1. RestAPI w/ authorization.
1. NextHandler<Param, Result, View> @controller 
    - `validate(param): void`
    - `transform(body): View`

1. Change(or update) the `model` @proxy
1. returns `Result` (or `View`)

### Use ES6 (profile ssocio)

```sh
# 1. use ssh-tunneling (alias sses7)
$ sses7
# 2. run local server
$ npm run express.ssocio
# 3. initialize es index
$ http :8888/search/init-elastic/hello
```

### Description
##### guardProxy 사용
- guardProxy() 콜백함수 내부에서 Model 속성값 변경시, guardProxy() 함수가 종료되는시점에 자동으로 DB(DynamoDB)에 변경된 값이 update 됨

##### abstract-crud-controller
- GeneralWEBController를 상속하여 정의한 abstract class (guardProxy + 기본 CRUD (to DynamoDB) + backend-proxy)
    - 기본 CRUD (doPost, doDelete, doPut, doGet, doList) rest-api 함수가 미리 구현되어있어, 기본 api를 만들때 이 abstract class를 상속하여 구현하면 기본기능을 따로 구현할 필요 없음
    - rest-api method 구현시 내부에서 guardProxy() 함수를 사용하여야 변경된 값을 일괄적으로 DB에 업데이트 할수있음, `guardProxy() -> proxy 파라미터 사용`
### Documentation

TODO) use `typedoc` w/ function comments.

## Deploy

1. (dev) mounted in `api.slp-premier.com/d2`
1. (prod) mounted in `api.slp-premier.com/v2`

----------------
# VERSION INFO #

| Version   | Description
|--         |--
| 0.23.201  | update `lemon-core@3.2.5`, and `cores`.
| 0.23.123  | update `lemon-core@3.2.4`, and `cores`.
| 0.23.116  | npm `npm install --save-dev serverless-offline tsconfig-paths lint-staged`
| 0.5.9c    | initial version

