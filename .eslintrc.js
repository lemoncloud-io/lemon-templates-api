module.exports = {
    parser: '@typescript-eslint/parser',
    extends: ['plugin:@typescript-eslint/recommended', 'plugin:prettier/recommended', 'prettier'],
    parserOptions: {
        ecmaVersion: 2018,
        sourceType: 'module',
    },
    rules: {
        // '@typescript-eslint/indent': ['error', 4],      // use tab width 4
        '@typescript-eslint/indent': 'off',
        '@typescript-eslint/camelcase': 'off',
        '@typescript-eslint/no-use-before-define': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-var-requires': 'off',
        '@typescript-eslint/explicit-function-return-type': 'off',
        // Added rule after upgrade eslint v8 and typescript v4
        '@typescript-eslint/no-inferrable-types': 'off',
        '@typescript-eslint/no-empty-function': 'off',
        '@typescript-eslint/prefer-as-const': 'off',
        //* v5 B16: lemon-model is reached only through lemon-core (root or `lemon-core/model`).
        'no-restricted-imports': [
            'error',
            {
                paths: [
                    {
                        name: 'lemon-model',
                        message: 'v5 B16: import from lemon-core (root) or lemon-core/model instead.',
                    },
                ],
                patterns: ['lemon-model/*'],
            },
        ],
    },
    //* v5 D107: the emitted `@types/dist` is the reverse - it names `lemon-model` only, never `lemon-core` (also checked by `npm run types:verify`).
    overrides: [
        {
            files: ['@types/dist/**/*.d.ts'],
            rules: {
                //* tsc drops `eslint-disable` comments from the emit: `interface X extends Y {}` in view types is fine here.
                '@typescript-eslint/no-empty-interface': 'off',
                'no-restricted-imports': [
                    'error',
                    {
                        paths: [
                            {
                                name: 'lemon-core',
                                message:
                                    'v5 D107: the @types package names lemon-model only - run `npm run types` (rewrite + verify).',
                            },
                        ],
                        patterns: [
                            { group: ['lemon-core/*'], message: 'v5 D107: the @types package names lemon-model only.' },
                        ],
                    },
                ],
            },
        },
    ],
};
