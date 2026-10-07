#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/bendrucker/git-log-parser.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .git/origin.git
git remote set-url --push origin "$PWD/.git/origin.git"
cat > package.json <<'JSON'
{
  "name": "git-log-parser",
  "version": "1.0.0",
  "description": "git-log-parser",
  "main": "./src",
  "dependencies": {
    "argv-formatter": "~1.0.0",
    "spawn-error-forwarder": "~1.0.0",
    "split": "~0.3.1",
    "stream-combiner": "~0.2.1",
    "through2": "~0.6.3",
    "traverse": "~0.6.6"
  },
  "scripts": {
    "test": "mocha"
  }
}
JSON
mkdir -p src
cat > src/index.js <<'JS'
'use strict';

var spawn    = require('child_process').spawn;
var through  = require('through2');
var split    = require('split');
var traverse = require('traverse');
var fields   = require('./fields');
var toArgv   = require('argv-formatter').format;
var combine  = require('stream-combiner');
var fwd      = require('spawn-error-forwarder');

var END = '==END==';
var FIELD = '==FIELD==';

function format (fieldMap) {
  return fieldMap.map(function (field) {
      return '%' + field.key;
    })
    .join(FIELD) + END;
}

function trim () {
  return through(function (chunk, enc, callback) {
    if (!chunk) {
      callback();
    }
    else {
      callback(null, chunk);
    }
  });
}

function log (args) {
  return fwd(spawn('git', ['log'].concat(args)), function (code, stderr) {
    return new Error('git log failed:\n\n' + stderr);
  })
  .stdout;
}

function args (config, fieldMap) {
  config.format = format(fieldMap);
  return toArgv(config);
}

exports.parse = function parseLogStream (config) {
  config  = config || {};
  var map = fields.map();
  return combine([
    log(args(config, map)),
    split(END + '\n'),
    trim(),
    through.obj(function (chunk, enc, callback) {
      var fields = chunk.toString('utf8').split(FIELD);
      callback(null, map.reduce(function (parsed, field, index) {
        var value = fields[index];
        traverse(parsed).set(field.path, field.type ? new field.type(value) : value);
        return parsed;
      }, {}));
    })
  ]);
};

exports.fields = fields.config;
JS
cat > src/fields.js <<'JS'
'use strict';

var traverse = require('traverse');

exports.config = {
  commit: {
    long: 'H',
    short: 'h'
  },
  tree: {
    long: 'T',
    short: 't'
  },
  author: {
    name: 'an',
    email: 'ae',
    date: {
      key: 'ai',
      type: Date
    }
  },
  committer: {
    name: 'cn',
    email: 'ce',
    date: {
      key: 'ci',
      type: Date
    }
  },
  subject: 's',
  body: 'b'
};

exports.map = function () {
  return traverse.reduce(exports.config, function (fields, node) {
    if (this.isLeaf && typeof node === 'string') {
      var typed = this.key === 'key';
      fields.push({
        path: typed ? this.parent.path : this.path,
        key: node,
        type: this.parent.node.type
      });
    }
    return fields;
  }, []);
};
JS
cat > README.md <<'MD'
git-log-parser
==============

Parse `git log` into a stream of commit objects
MD
git add -A && git commit -qm "git-log-parser: initial commit"
