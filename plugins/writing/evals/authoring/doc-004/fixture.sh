#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/bendrucker/packhorse.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .git/origin.git
git remote set-url --push origin "$PWD/.git/origin.git"
cat > package.json <<'JSON'
{
  "name": "packhorse",
  "version": "1.0.0",
  "description": "Node API for updating multiple packages",
  "main": "./src",
  "scripts": {
    "test": "mocha test"
  },
  "dependencies": {
    "bluebird": "~2.7.1",
    "core-error-predicates": "~1.0.0",
    "detect-indent": "~3.0.0",
    "xtend": "~4.0.0"
  }
}
JSON
mkdir -p src
cat > src/index.js <<'JS'
'use strict';

var Pack    = require('./pack');
var Package = require('./package');

exports.load = function (packages) {
  return new Pack().load(packages);
};

exports.Pack = Pack;
exports.Package = Package;
JS
cat > src/pack.js <<'JS'
'use strict';

var Promise = require('bluebird');
var Package = require('./package');
var errors  = require('core-error-predicates');

function Pack () {
  this.packages = [];
}

Pack.prototype.load = function (packages) {
  return Promise.map(packages, normalizePackage)
    .reduce(readPackage, this.packages)
    .return(this);
};

function normalizePackage (pkg) {
  if (typeof pkg === 'string') {
    return {
      path: pkg
    };
  }
  return pkg;
}

function readPackage (packages, pkg) {
  return new Package(pkg.path).read()
    .then(function (pkg) {
      packages.push(pkg);
      return packages;
    })
    .catch(errors.FileNotFoundError, function (err) {
      if (!pkg.optional) throw err;
    });
}

Pack.prototype.get = function () {
  var primary = this.packages[0];
  return primary.get.apply(primary, arguments);
};

Pack.prototype.set = function () {
  var args = arguments;
  this.packages.forEach(function (pkg) {
    pkg.set.apply(pkg, args);
  });
  return this;
};

['read', 'write'].forEach(function (method) {
  Pack.prototype[method] = function () {
    var args = arguments;
    return Promise.map(this.packages, function (pkg) {
      return pkg[method].apply(pkg, args);
    })
    .return(this);
  };
});

module.exports = Pack;
JS
cat > src/package.js <<'JS'
'use strict';

var Promise = require('bluebird');
var fs      = Promise.promisifyAll(require('fs'));
var indent  = require('detect-indent');
var extend  = require('xtend/mutable');

function Package (path) {
  this.path = path;
  this.data = {};
  this.indent = '  ';
}

Package.prototype.get = function (property) {
  return this.data[property];
};

Package.prototype.set = function (property, value) {
  if (typeof property === 'string') {
    this.data[property] = value;
  }
  else {
    extend(this.data, property);
  }
  return this;
};

Package.prototype.read = function () {
  return fs.readFileAsync(this.path)
    .bind(this)
    .then(function (data) {
      this.indent = indent(data).indent;
      this.data = JSON.parse(data);
      return this;
    });
};

Package.prototype.write = function () {
  return fs.writeFileAsync(this.path, JSON.stringify(this.data, null, this.indent))
    .return(this);
};

module.exports = Package;
JS
cat > README.md <<'MD'
# packhorse
Node API for updating multiple packages
MD
git add -A && git commit -qm "packhorse: initial commit"
