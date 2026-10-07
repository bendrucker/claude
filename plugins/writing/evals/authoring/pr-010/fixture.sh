#!/usr/bin/env bash
set -euo pipefail
git init -q -b master
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .git/info/exclude
# The PR touches .github, so un-ignore it specifically.
echo "!/.github" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/brianc/node-pg-types.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .git/origin.git
git remote set-url --push origin "$PWD/.git/origin.git"
cat > package.json <<'JSON'
{
  "name": "pg-types",
  "version": "4.0.2",
  "description": "Query result type converters for node-postgres",
  "main": "index.js",
  "scripts": {
    "coverage": "nyc --reporter=html npm test && open-cli coverage/index.html",
    "coverage-ci": "nyc --reporter=lcov npm test && codecov",
    "lint": "standard",
    "test": "tape test/*.js | tap-spec && npm run test-ts && npm run lint",
    "test-ts": "tsd"
  },
  "devDependencies": {
    "@types/node": "^14.14.33",
    "codecov": "^3.8.1",
    "nyc": "^15.1.0",
    "open-cli": "^6.0.1",
    "standard": "^16.0.3",
    "tap-spec": "^5.0.0",
    "tape": "^5.2.2",
    "tsd": "^0.14.0"
  },
  "engines": {
    "node": ">=10"
  }
}
JSON
mkdir -p .github/workflows
cat > .github/workflows/ci.yml <<'YAML'
name: CI

on: [push, pull_request]

permissions:
  contents: read

jobs:
  lint:
    timeout-minutes: 2
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: 18
          cache: yarn
      - run: yarn install # --frozen-lockfile TODO get this option working
      - run: yarn lint
  test-js:
    timeout-minutes: 2
    runs-on: ubuntu-latest
    needs: lint
    strategy:
      fail-fast: false
      matrix:
        node:
          - '12'
          - '14'
          - '16'
          - '18'
          - '20'
    name: test js - node v${{ matrix.node }}
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: yarn
      - run: yarn install # --frozen-lockfile TODO get this option working
      - run: yarn test
  test-ts:
    timeout-minutes: 2
    runs-on: ubuntu-latest
    needs: lint
    strategy:
      fail-fast: false
      matrix:
        node:
          - '12'
          - '14'
          - '16'
          - '18'
          - '20'
    name: test ts - node v${{ matrix.node }}
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: yarn
      - run: yarn install # --frozen-lockfile TODO get this option working
      - run: yarn test-ts
YAML
git add -A && git commit -qm "ci: run lint and tests across supported node versions"
git switch -qc actions-workflow-cleanup
cat > package.json <<'JSON'
{
  "name": "pg-types",
  "version": "4.0.2",
  "description": "Query result type converters for node-postgres",
  "main": "index.js",
  "scripts": {
    "coverage": "nyc --reporter=html npm test && open-cli coverage/index.html",
    "coverage-ci": "nyc --reporter=lcov npm test && codecov",
    "lint": "standard",
    "test": "npm run test-js && npm run test-ts && npm run lint",
    "test-js": "tape test/*.js | tap-spec",
    "test-ts": "tsd"
  },
  "devDependencies": {
    "@types/node": "^14.14.33",
    "codecov": "^3.8.1",
    "nyc": "^15.1.0",
    "open-cli": "^6.0.1",
    "standard": "^16.0.3",
    "tap-spec": "^5.0.0",
    "tape": "^5.2.2",
    "tsd": "^0.14.0"
  },
  "engines": {
    "node": ">=10"
  }
}
JSON
cat > .github/workflows/ci.yml <<'YAML'
name: ci

on:
  push:
    branches:
      - master
  pull_request:

permissions:
  contents: read

jobs:
  lint:
    timeout-minutes: 2
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: npm run lint

  test:
    timeout-minutes: 2
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node:
          - '12'
          - '14'
          - '16'
          - '18'
          - '20'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - run: npm install
      - run: npm test

  types:
    timeout-minutes: 2
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
      - run: npm run test-ts
YAML
git commit -qam "Clean up GitHub Actions workflow"
