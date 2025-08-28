/**
 * `types.ts`
 * - 기본 types used in `backend-proxy`
 *
 * **[중요! exports 순서]**
 * 1. define data type in `types.ts` w/ internal types.
 * 2. define Model in `model.ts`
 * 3. define View/Body in `view.ts`, and external types.
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-08-29 initial version.
 * @author      Aiden <aiden@lemocloud.io>
 * @date        2025-07-23 refactored for sockets service
 *
 * Copyright (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 */
/**
 * Lookup Table
 *
 * WARN! DO NOT EXPORT AS `$LUT`. use default export instead.
 */
declare const $LUT: {
    /**
     * Possible type of model.
     */
    ModelType: {
        /** socket model */
        socket: string;
        /** connection model */
        connection: string;
        /** channel model */
        channel: string;
    };
    /**
     * ChannelStereo
     */
    ChannelStereo: {
        '': string;
        /** alias */
        '#alias': string;
    };
};
/**
 * type: `ChannelStereo`
 */
export declare type ChannelStereo = keyof typeof $LUT.ChannelStereo;
/** must export $LUT as default */
export default $LUT;
