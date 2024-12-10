/**
 * `search-models.ts`
 * - model and types definitions..
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2021-12-07 initial version
 * @date        2021-12-17 customized from origin
 * @date        2022-02-18 optimized search w/ ES6.8
 *
 * @origin      lemon-accounts-api
 * @copyright (C) 2021 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, CoreModel } from 'lemon-core';

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
 * see https://github.com/kimamula/ts-transformer-keys
 *  - keys() 실행 에러 해결을 위해서 `$ npm install --save-dev typescript ttypescript`, 후 tsc -> ttsc로 변경함!.
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

/**
 * type `SearchResult`
 */
export interface SearchResult<T> {
    /**
     * total count of items searched
     */
    total: number;
    /**
     * item list
     */
    list: T[];
    /**
     * pagination cursor
     */
    last?: string[];
    /**
     * aggregation result
     */
    aggregations?: any;
}

/**
 * 쿼리의 각 항목의 값들
 */
export type QueryTerm =
    | string
    | number
    | string[]
    | number[]
    | { query: string | number | string[] | number[]; operator?: 'and' | 'or'; slop?: number }
    | { query: { query_string: { default_field?: string; query: string } } };

/**
 * 정렬(sort)에 쓰이는 항목.
 */
export type SortTerm =
    | string
    | { [key: string]: 'asc' | 'desc' }
    | {
          [key: string]: {
              order?: 'asc' | 'desc';
              missing?: '_last' | '_first';
          };
      };

/**
 * 검색 쿼리 항목.
 */
export interface SearchQuery {
    term?: { [key: string]: QueryTerm };
    terms?: { [key: string]: QueryTerm };
    match?: { [key: string]: QueryTerm };
    match_phrase?: { [key: string]: QueryTerm };
    prefix?: { [key: string]: QueryTerm };
    exists?: { field: string };
    range?: {
        [key: string]: {
            gt?: string | number;
            gte?: string | number;
            lt?: string | number;
            lte?: string | number;
            // like "dd/MM/yyyy||yyyy"
            format?: string;
        };
    };
    bool?: {
        filter?: SearchQuery | SearchQuery[];
        must?: SearchQuery | SearchQuery[];
        must_not?: SearchQuery | SearchQuery[];
        should?: SearchQuery | SearchQuery[];
        minimum_should_match?: number;
    };
}

/**
 * type of search body
 */
export interface SearchBody {
    size?: number;
    search_after?: (string | number)[];
    query: SearchQuery;
    sort?: SortTerm | SortTerm[];
    _source?: string[];
    aggs?: any;
}

export type SearchType = 'query_then_fetch' | 'dfs_query_then_fetch';

//! extract properties out of Model...
import { keys } from 'ts-transformer-keys';
export const FIELDS: string[] = keys<SearchModel>().filter(_ => !_.startsWith('_'));

/**
 * extends fields of model.
 * @param fields list of `keys<model>`
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
    // search: extendsFields(keys<SearchModel>()),
    $query: extendsFields(keys<SearchQueryModel>()),
    $batch: extendsFields(keys<SearchBatchModel>()),
};
