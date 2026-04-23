/**
 * `search-models.ts`
 * - model and types definitions..
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2021-12-07 initial version
 * @date        2021-12-17 customized from origin
 * @date        2022-02-18 optimized search w/ ES6.8
 * @date        2024-12-20 optimized with `lemon-core#3.2.11`
 *
 * @origin      lemon-templates-api
 * @copyright (C) 2021 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { CoreModel, QueryTerm, SortTerm, SearchQuery, SearchBody } from 'lemon-core';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, SearchResult } from 'lemon-core';

export { QueryTerm, SortTerm, SearchQuery, SearchBody, SearchResult };
export type SearchType = 'query_then_fetch' | 'dfs_query_then_fetch';

/**
 * type: model-type
 * - use this type to make pkey per data.
 * - use special `#` prefix to avoid confliction.
 */
export type SearchModelType = '#query' | '#batch';

/**
 * class: `SearchModel`
 *  - simple search-model to manage query.
 *
 * field list는 generated registry(`src/generated/field-registry.ts`)를 사용한다.
 */
export interface SearchModel extends CoreModel<SearchModelType> {
    /**
     * id: auto generated id.
     */
    id?: string;
    /**
     * (unique) name of search.
     */
    name?: string;
}

/**
 * storage for `query`
 */
export interface SearchQueryModel extends SearchModel {
    /**
     * query string in json
     */
    query?: string;
    /**
     * the parsed query content.
     */
    readonly Query?: SearchBody;
    /**
     * (option) the last batch-id.
     */
    batchId?: string;
    /**
     * (option) the last queue-id.
     */
    queueId?: string;
}

/**
 * storage for `batch`
 */
export interface SearchBatchModel extends SearchModel {
    /**
     * the target query-id
     */
    queryId?: string;
    /**
     * batch state in json
     */
    batch?: string;
    /**
     * meta data-set to replace {{key}} in query
     */
    meta?: string | any;
    /**
     * started
     */
    started?: number;
    /**
     * state in string.
     */
    state?: string;
    /**
     * size (batch-size)
     */
    size?: number;
    /**
     * limit of max
     */
    limit?: number;
    /**
     * current run-count.
     */
    count?: number;
    /**
     * flag to report in slack.
     */
    slack?: 0 | 1;
    /**
     * target of batch-handler to be exeucted.
     */
    target?: string;
    /**
     * (optional) if found error.
     */
    error?: string;
}

//! extract properties out of Model...
import { fieldKeys } from '../../generated/field-registry';

export const FIELDS: string[] = fieldKeys.searchModel<SearchModel>().filter(_ => !_.startsWith('_'));

/**
 * extends fields of model.
 * @param fields list of model fields
 * @param bases (optional) shared list.
 * @returns the final list of fields.
 */
const extendsFields = (fields: string[], bases: string[] = FIELDS): string[] =>
    fields.reduce(
        (L: string[], field: string) => {
            if (/^[a-z]+/.test(field) && !L.includes(field)) L.push(field); // only if 1st char is lowercase.
            return L;
        },
        [...bases],
    );

//! extended fields set of sub-class.
export const $FIELD = {
    // search: extendsFields(fieldKeys.searchModel<SearchModel>()),
    $query: extendsFields(fieldKeys.searchQueryModel<SearchQueryModel>()),
    $batch: extendsFields(fieldKeys.searchBatchModel<SearchBatchModel>()),
};
