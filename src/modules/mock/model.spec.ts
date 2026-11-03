/**
 * `model.spec.ts`
 * - parity test of the annotated `MockModel` (v5 B4) against the v4 generated registry.
 * - the expected lists are literals copied from the v4 generated registry (`mockModel`, `mockHead`; the registry was removed in v5 B4).
 * - NOTE: order is intentionally NOT compared - `fieldsOf()` lists parent fields first, the generator listed own fields first.
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2026-10-28 initial version (lemon-core v5 B4)
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
//* `expect2` from lemon-core (importing `commons.spec` would also run its own 4 tests in this file).
//* v5 B16: lemon-model through lemon-core
import { expect2, CoreModel } from 'lemon-core';
//* v5 B16: lemon-model through lemon-core
import { fieldsOf } from 'lemon-core/model';
import { $FIELD, $HEAD, MockModel } from './model';

// v4 `$FIELD.mock` = registry entry `mockModel` through `filterFields(…, ['meta'])` (16 names)
const V4_MOCK_FIELDS = [
    'meta',
    'name',
    'stereo',
    'aliasId',
    'id',
    'ns',
    'type',
    'sid',
    'uid',
    'gid',
    'lock',
    'next',
    'createdAt',
    'updatedAt',
    'deletedAt',
    'error',
];

// v4 `$HEAD.mock` = registry entry `mockHead` through `filterFields()` (3 names)
const V4_MOCK_HEAD = ['id', 'name', 'stereo'];

// set view of a list (order ignored)
const asSet = (list: string[]) => new Set(list);

//! main test body.
describe('mock/model (B4 parity)', () => {
    // (1) body fields: the same set as the v4 generator output
    it('should equal v4 $FIELD.mock as a set', () => {
        expect2(() => asSet($FIELD.mock)).toEqual(asSet(V4_MOCK_FIELDS));
        expect2(() => $FIELD.mock.length).toEqual(16);
        // the `base` of `filterFields()` still comes first
        expect2(() => $FIELD.mock[0]).toEqual('meta');
    });

    // (2) head fields: the `head` group equals the v4 `MockHead` entry as a set
    it('should equal v4 $HEAD.mock as a set', () => {
        expect2(() => asSet($HEAD.mock)).toEqual(asSet(V4_MOCK_HEAD));
        expect2(() => $HEAD.mock.length).toEqual(3);
    });

    // (3) the class lists its own `aliasId` and the 16 core fields (L2: 14 + `id`, `_id`)
    it('should list aliasId and the 16 core fields', () => {
        const all = fieldsOf(MockModel);
        const core = fieldsOf(CoreModel);
        expect2(() => core.length).toEqual(16);
        expect2(() => core.filter(name => !all.includes(name))).toEqual([]);
        expect2(() => all.includes('aliasId')).toEqual(true);
        expect2(() => all.length).toEqual(18);
    });
});
