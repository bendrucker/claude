#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/TakeScoop/eslint-config-scoop.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .git/origin.git
git remote set-url --push origin "$PWD/.git/origin.git"
cat > index.js <<'JS'
'use strict'

/* eslint-disable */
module.exports = {
    "env": {
        "es6": true,
        "node": true
    },
    "extends": "eslint:recommended",
    "plugins": [
        "dependencies",
        "implicit-dependencies"
    ],
    "rules": {
        "dependencies/case-sensitive": 2,
        "dependencies/no-cycles": 2,
        "dependencies/no-unresolved": 2,
        "dependencies/require-json-ext": 2,
        "block-scoped-var": 2,
        "brace-style": [
            2,
            "1tbs"
        ],
        "camelcase": 2,
        "comma-dangle": [
            2,
            "only-multiline"
        ],
        "comma-spacing": [
            2,
            {
                "before": false,
                "after": true
            }
        ],
        "comma-style": [
            2,
            "last"
        ],
        "consistent-this": [
            2,
            "self"
        ],
        "curly": [
            2,
            "multi-line"
        ],
        "dot-notation": 2,
        "eol-last": 2,
        "eqeqeq": 2,
        "implicit-dependencies/no-implicit": [
            2,
            {
                "peer": true,
                "dev": true,
                "optional": true
            }
        ],
        "indent": [
            2,
            4,
            {
                "MemberExpression": 0,
                "SwitchCase": 1
            }
        ],
        "key-spacing": 2,
        "keyword-spacing": 2,
        "linebreak-style": 2,
        "new-cap": [
            2,
            {
                "capIsNewExceptions": [
                    "Sendgrid",
                    "Bookshelf"
                ],
                "newIsCapExceptions": [
                    "self"
                ]
            }
        ],
        "no-array-constructor": 2,
        "no-console": 0,
        "no-else-return": 2,
        "no-eq-null": 2,
        "no-extra-parens": [
            2,
            "functions"
        ],
        "no-implicit-globals": 2,
        "no-lonely-if": 2,
        "no-multi-spaces": 2,
        "no-multiple-empty-lines": [
            2, 
            {
                "max": 1,
                "maxEOF": 0,
                "maxBOF": 0
            }
        ],
        "no-multi-str": 2,
        "no-new-object": 2,
        "no-restricted-globals": [
            2,
            "Promise"
        ],
        "no-restricted-syntax": [
            2,
            {
                "selector": "CallExpression[callee.name!='parseInt'] > Identifier[name='parseInt']",
                "message": "Call parseInt directly to guarantee radix param is not incorrectly provided"
            }
        ],
        "no-return-assign": [
            2,
            "always"
        ],
        "no-shadow-restricted-names": 2,
        "no-spaced-func": 2,
        "no-unsafe-negation": 2,
        "no-unused-vars": [
            2,
            {
                "args": "none",
                "vars": "all"
            }
        ],
        "no-use-before-define": [
            2,
            "nofunc"
        ],
        "no-useless-return": 2,
        "no-var": 2,
        "object-curly-spacing": [
            2,
            "always",
            {
                "objectsInObjects": false
            }
        ],
        "one-var": [
            2,
            "never"
        ],
        "padded-blocks": 0,
        "prefer-const": 2,
        "quotes": [
            2,
            "single",
            "avoid-escape"
        ],
        "semi": [
            2,
            "never"
        ],
        "semi-spacing": 2,
        "space-before-blocks": 2,
        "space-before-function-paren": [
            2,
            "never"
        ],
        "space-in-parens": [
            2,
            "never"
        ],
        "space-infix-ops": 2,
        "space-unary-ops": [
            2, {
            "words": true,
            "nonwords": false
            }
        ],
        "spaced-comment": 2,
        "strict": [
            2,
            "global"
        ],
        "valid-typeof": [
            2,
            {
                "requireStringLiterals": true
            }
        ],
        "vars-on-top": 2,
        "wrap-iife": [
            2,
            "inside"
        ]
    }
}
JS
git add -A && git commit -qm "rules: forbid overriding the Promise global"
