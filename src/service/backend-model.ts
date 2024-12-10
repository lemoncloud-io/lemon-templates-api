/**
 * `backend-model.ts`
 * - model definitions per account data
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-08-29 initial version.
 *
 * Copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
//NOTE - must use `lemon-model` to publish w/o `lemon-core`.
import { CoreModel } from 'lemon-model';
import { ModelType } from './backend-types';
// import { keys } from 'ts-transformer-keys';

/**
 * type: `Model`: common model
 */
export type Model = CoreModel<ModelType>;

/**
 * type: boolean style number.
 */
export type BoolFlag = 0 | 1;

/**
 * extract field names from models
 * - only fields start with lowercase, or all upper.
 */
export const filterFields = (fields: string[], base: string[] = []) =>
    fields
        .filter(field => field !== '_id' && /^[a-z_][a-zA-Z_]+/.test(field))
        .reduce<string[]>(
            (L, k) => {
                if (k && !L.includes(k)) L.push(k);
                return L;
            },
            [...base],
        );

/** field names from head */
export const $HEAD = {
    /** common data */
    // test: filterFields(keys<TestHead>()),
};

// extract field names from models
export const $FIELD = {
    /** common data */
    // test: filterFields(keys<TestModel>()),
};
