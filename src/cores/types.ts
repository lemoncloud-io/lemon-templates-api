/**
 * `types.ts`
 * - common types used in `/cores`
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-06-21 optimized w/ `abstract-services`
 * @date        2022-06-28 added `Codable` interface for general types.
 * @date        2023-01-18 optimized with `lemon-core@3.2.4`
 * @date        2023-02-15 optimized with `lemon-core@3.2.5`
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/ssocio-templates-api/cores` (WARN! keep in same origin)
 */
//NOTE - must use `lemon-model` to publish w/o `lemon-core`.
import { CoreModel, View, Body } from 'lemon-model';
export { CoreModel, View, Body };

/**
 * type `ListResult`
 */
export interface ListResult<T, R = any> {
    /**
     * total searched count
     */
    total?: number;
    /**
     * max items count in the page
     */
    limit?: number;
    /**
     * current page number.
     */
    page?: number;
    /**
     * (optional) time took in sec
     */
    took?: number;
    /**
     * items searched
     */
    list: T[];

    /**
     * (optional) aggr list
     */
    aggr?: R[];
}

export interface AggrKeyCount {
    /** name of key(or bucket name) */
    key: string;
    /** number of count */
    val: number;
}

/**
 * type `PaginatedListResult`
 */
export interface PaginatedListResult<T, R = string> extends ListResult<T, R> {
    /**
     * current page
     */
    page: number;
}

/**
 * type `ListParam`
 */
export interface ListParam {
    /**
     * max items count to be fetched
     */
    limit?: number;
    /**
     * (optional) sorting order
     *  - 'asc': older first
     *  - 'desc': newer first
     *  - string: extended sorting features
     */
    sort?: 'asc' | 'desc' | string;
}

/**
 * type `PaginateParam`
 */
export interface PaginateParam extends ListParam {
    /**
     * page # to fetch (0-indexed)
     */
    page?: number;
    /**
     * (optional) offset # from start.
     */
    offset?: number;
    /**
     * (optional) flag to filter by uid
     */
    uid?: string;
}

/**
 * type `BulkUpdateBody`
 */
export interface BulkUpdateBody<T> extends BulkBody<T> {
    /**
     * list bulk update model with id
     */
    list: T[];
}

/**
 * body data for bulk
 */
export interface BulkBody<T> {
    list: T[];
}

/**
 * list of the selected model-id
 */
export interface BodyList<T extends { id: string } = { id: string }> {
    list: T[];
}
