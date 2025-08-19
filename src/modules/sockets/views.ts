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
import { ChannelModel, ConnectionModel, SocketModel } from './model';
import $LUT from './types';

import { SocketPayload, SocketResponse } from '../../libs/wss/wss-types';
export { SocketPayload, SocketResponse };

//! export all internal types
export * from './types';
export default $LUT;

/**!SECTION */
/**
 * type: `SocketView`
 * - usually same as post's body.
 */
export interface SocketView extends View, Partial<SocketModel> {}

/**
 * Type `SocketBody`
 */
export interface SocketBody extends Body, Partial<SocketView> {}

/**
 * type: `ConnectionView`
 * - usually same as post's body.
 */
export interface ConnectionView extends View, Partial<ConnectionModel> {}

/**
 * Type `ConnectionBody`
 */
export interface ConnectionBody extends Body, Partial<ConnectionView> {}

/**
 * type: `ChannelView`
 * - usually same as post's body.
 */
export interface ChannelView extends View, Omit<Partial<ChannelModel>, '$alias'> {
    /** (optional) view of alias in detail */
    readonly $alias?: ChannelView;
}

/**
 * Type `ChannelBody`
 */
export interface ChannelBody extends Body, Partial<ChannelView> {}
