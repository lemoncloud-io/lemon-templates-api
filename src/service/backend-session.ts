/**
 * `backend-session.ts`
 * - session used in `backend-proxy`
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-08-29 initial version.
 *
 * Copyright (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { NextIdentityCognito, NextIdentity } from 'lemon-model';

/**
 * type: `SessionToken`
 * - 세션토큰(= JWT(identityToken))으로, `/reg-dev`시 액세스토큰과 함께 발급됨 (약 1일동안 유효함)
 * - `backend-api`에서 조직/그룹/사용자에 맞게 재설정됨!
 * - `backend-api`에서 슈퍼타입을 정의하고, 다른곳에서는 이것을 import 하여 이용함.
 * - 세션토큰 검사는 `proxy.getCurrentSession()` 이용하기
 */
interface _SessionToken extends NextIdentity<any> {
    /**
     * site-id (= id in `SiteModel(사이트/아파트)`)
     * - `#` 일경우, 특정 site에 엮이지 않음 (무시됨)
     *
     * @see SiteModel
     */
    sid: string;
    /**
     * group-id (= id in `GroupModel(그룹)`)
     * - `group`은 `user`를 물리적 구분으로 나눠서 생각해볼때 이용가능함.
     *
     * @see GroupModel
     */
    gid: string;
    /**
     * user-id (= id in `UserModel(이용자)`)
     * - `account`는 인증(로그인)처리와 관련된 것으로, 특정 `user`가 이 인증을 사용하여 특정 사이트에서 역활(role) 수행을함.
     * - 여기는 `backend-api`에서 관리되는 `user-model`의 모델ID.
     *
     * @see UserModel
     */
    uid: string;
    /**
     * list of roles  (like `user`, `admin`, `super`)
     */
    roles: string[];
    /**
     * (optional) internal `identity-id` (= delegated identity)
     * - `.identityId` 는 cognito 인증을 통해서, 현재 인증된 `identity-id`를 알 수 있음
     * - 다만, 해당 Account가 `delegated-id`가 있을 경우, 여기에 위임된 id 가 들어감.
     *
     * @see NextIdentityCognito
     */
    iid?: string;
    /**
     * service-name of issuer
     * ex) `ssocio2-backend-api`
     */
    iss?: string;
    /** Site Extensions */
    Site?: {
        /** site-code */
        code: string;
        /** name of site (ex: 권선) */
        name?: string;
    };
    /** Group Extensions */
    Group?: {
        /** group-code */
        code: string;
        /** name of group */
        name?: string;
    };
    /** User Extensions */
    User?: {
        /** name of user (ex: 홍길동) */
        name?: string;
        /** display name of user (ex: 홍사마) */
        nick?: string;
    };
}

/** session-token from backend */
export type SessionToken = _SessionToken & NextIdentityCognito;

/** access-token from backend */
export type MyAccessToken = _SessionToken;
