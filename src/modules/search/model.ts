/**
 * `search-models.ts`
 * - model and types definitions..
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2021-12-07 initial version
 * @date        2021-12-17 customized from origin
 * @date        2022-02-18 optimized search w/ ES6.8
 * @date        2024-12-20 optimized with `lemon-core#3.2.11`
 * @date        2026-10-30 v5 B4: the models are classes with `@field()` annotations (no generated registry).
 *
 * @origin      lemon-templates-api
 * @copyright (C) 2021 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { CoreModel, QueryTerm, SortTerm, SearchQuery, SearchBody } from 'lemon-core';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, SearchResult } from 'lemon-core';
//* v5 B4: field annotations (lemon-model through the `lemon-core/model` sub-path)
import { field, fieldsOf } from 'lemon-core/model';

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
 *  - v5 B4: a class over `CoreModel` with `@field()` annotations (was the `searchModel` registry entry).
 */
export class SearchModel extends CoreModel<SearchModelType> {
    /**
     * id: auto generated id. (inherited, redeclared as before)
     */
    @field()
    declare id?: string;
    /**
     * (unique) name of search.
     */
    @field()
    name?: string;
}

/**
 * storage for `query`
 */
export class SearchQueryModel extends SearchModel {
    /**
     * query string in json
     */
    @field()
    query?: string;
    /**
     * the parsed query content. (view field: no `@field()`)
     */
    readonly Query?: SearchBody;
    /**
     * (option) the last batch-id.
     */
    @field()
    batchId?: string;
    /**
     * (option) the last queue-id.
     */
    @field()
    queueId?: string;
}

/**
 * storage for `batch`
 */
export class SearchBatchModel extends SearchModel {
    /**
     * the target query-id
     */
    @field()
    queryId?: string;
    /**
     * batch state in json
     */
    @field()
    batch?: string;
    /**
     * meta data-set to replace {{key}} in query
     */
    @field()
    declare meta?: string | any;
    /**
     * started
     */
    @field()
    started?: number;
    /**
     * state in string.
     */
    @field()
    state?: string;
    /**
     * size (batch-size)
     */
    @field()
    size?: number;
    /**
     * limit of max
     */
    @field()
    limit?: number;
    /**
     * current run-count.
     */
    @field()
    count?: number;
    /**
     * flag to report in slack.
     */
    @field()
    slack?: 0 | 1;
    /**
     * target of batch-handler to be exeucted.
     */
    @field()
    target?: string;
    /**
     * (optional) if found error.
     */
    @field()
    declare error?: string;
}

//! extract properties out of Model...
//* v5 B4: annotated fields of the class (was `fieldKeys.searchModel`)
export const FIELDS: string[] = fieldsOf(SearchModel).filter(_ => !_.startsWith('_'));

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
    //* v5 B4: annotated fields of the classes (were `fieldKeys.searchQueryModel`/`searchBatchModel`)
    $query: extendsFields(fieldsOf(SearchQueryModel)),
    $batch: extendsFields(fieldsOf(SearchBatchModel)),
};
