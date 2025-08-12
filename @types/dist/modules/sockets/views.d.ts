/**
 * `views.ts`
 * - type of views used in `backend-proxy`
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-08-29 initial version.
 * @author      Aiden <aiden@lemoncloud.io>
 * @date        2024-07-23 refactored for sockets service
 *
 * Copyright (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { View, Body } from 'lemon-model';
import { SocketModel } from './model';
import $LUT from './types';
export * from './types';
export default $LUT;
/**!SECTION */
/**
 * type: `SocketView`
 * - usually same as post's body.
 */
export interface SocketView extends View, Partial<SocketModel> {
}
/**
 * Type `SocketBody`
 */
export interface SocketBody extends Body, Partial<SocketView> {
}
