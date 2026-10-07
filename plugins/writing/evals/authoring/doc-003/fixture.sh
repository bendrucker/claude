#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/bendrucker/convex-firebase.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .git/origin.git
git remote set-url --push origin "$PWD/.git/origin.git"
cat > package.json <<'JSON'
{
  "name": "convex-firebase",
  "version": "1.3.1",
  "description": "Firebase bindings for convex, the most powerful ORM for Angular",
  "main": "./src",
  "scripts": {
    "test": "karma start --single-run"
  },
  "dependencies": {
    "browserify": "~6.2.0",
    "browserify-shim": "~3.8.0",
    "firebase": "~2.0.1"
  },
  "peerDependencies": {
    "convex": "^3.3.0"
  }
}
JSON
mkdir -p src
cat > src/index.js <<'JS'
'use strict';

module.exports = require('angular')
  .module('convex-firebase', [
    'convex'
  ])
  .value('Firebase', require('firebase'))
  .config(['$provide', function ($provide) {
    $provide.decorator('ConvexModel', require('./model'));
    $provide.decorator('ConvexCollection', require('./collection'));
  }])
  .name;
JS
cat > src/model.js <<'JS'
'use strict';

var angular = require('angular');

module.exports = function (ConvexModel, Firebase, $q, $rootScope, convexConfig) {

  ConvexModel.prototype.$ref = function (withId, collection) {
    var pathOverride = this.$firebase && this.$firebase.path;
    return new Firebase(convexConfig.firebase)
      .child(pathOverride ? this.$firebase.path.call(this, withId, collection) : this.$path(withId));
  };

  function toPromise (ref) {
    return $q(function (resolve, reject) {
      ref.once('value', resolve, reject);
    });
  }

  function applyAsync (callback, context) {
    $rootScope.$applyAsync(angular.bind(context, callback));
  }

  ConvexModel.prototype.$subscribe = function (keys, prefix) {
    var self = this;
    var refs;
    if (keys) {
      prefix = prefix ? '$$' : '';
      if (!Array.isArray(keys)) {
        keys = [keys];
      }
      var parent = this.$ref();
      refs = keys
        .map(function (key) {
          var ref = parent.child(key);
          ref.on('value', function (snapshot) {
            applyAsync(function () {
              this[prefix + key] = snapshot.val();
            }, this);
          }, this);
          return ref;
        }, this);
    }
    else {
      var ref = this.$ref();
      ref.on('value', function (snapshot) {
        applyAsync(function () {
          this.$set(snapshot.val());
        }, this);
      }, this);
      refs = [ref];
    }
    var promises = refs.map(function (ref) {
      return toPromise(ref);
    }, this);
    return $q.all(promises)
      .then(function () {
        return self;
      });
  };

  return ConvexModel;
};

module.exports.$inject = [
  '$delegate',
  'Firebase',
  '$q',
  '$rootScope',
  'convexConfig'
];
JS
cat > src/collection.js <<'JS'
'use strict';

var angular = require('angular');

module.exports = function (ConvexCollection, Firebase, $rootScope) {

  ConvexCollection.prototype.$ref = function () {
    if (this.$$ref) return this.$$ref;
    var proto = this.$$model.prototype;
    this.$$ref = proto.$ref(false, this);
    if (proto.$firebase) this.$$ref = this.$query(proto.$firebase.query);
    return this.$$ref;
  };

  ConvexCollection.prototype.$query = function (query) {
    var ref = this.$ref();
    if (typeof query === 'function') {
      return query.call(this, ref);
    }
    else if (query) {
      Object.keys(query).forEach(function (method) {
        var args = query[method];
        if (Array.isArray(args)) {
          ref = ref[method].apply(ref, args);
        }
        else if (args) {
          ref = ref[method].call(ref, args);
        }
        else {
          ref = ref[method]();
        }
      });
    }
    return ref;
  };

  function applyAsync (callback, context) {
    $rootScope.$applyAsync(angular.bind(context, callback));
  }

  ConvexCollection.prototype.$subscribe = function (options) {
    options = options || {};
    this.$$index = {};
    var ref = this.$query(options.query);
    ref.on('child_added', function (snapshot) {
      applyAsync(function () {
        var index = this.$$models.length;
        this.$push(snapshot.val());
        this.$$index[snapshot.key()] = index;
      }, this);
    }, this);
    ref.on('child_changed', function (snapshot) {
      applyAsync(function () {
        var index = this.$$index[snapshot.key()];
        this.$$models[index].$set(snapshot.val());
      }, this);
    }, this);
    ref.on('child_removed', function (snapshot) {
      applyAsync(function () {
        this.$splice(snapshot.key());
      }, this);
    }, this);

  };

  ConvexCollection.prototype.$splice = function (id) {
    var index = this.$$index[id];
    this.$$models.splice(index, 1);
    Object.keys(this.$$index)
      .filter(function (id) {
        return this.$$index[id] > index;
      }, this)
      .forEach(function (id) {
        this.$$index[id] += -1;
      }, this);
    this.$$index[id] = void 0;
  };

  return ConvexCollection;

};

module.exports.$inject = ['$delegate', 'Firebase', '$rootScope'];
JS
cat > README.md <<'MD'
convex-firebase [![Build Status](https://travis-ci.org/bendrucker/convex-firebase.svg?branch=master)](https://travis-ci.org/bendrucker/convex-firebase) [![Code Climate](https://codeclimate.com/github/bendrucker/convex-firebase/badges/gpa.svg)](https://codeclimate.com/github/bendrucker/convex-firebase) [![Test Coverage](https://codeclimate.com/github/bendrucker/convex-firebase/badges/coverage.svg)](https://codeclimate.com/github/bendrucker/convex-firebase)
===============

Read-only Firebase bindings for convex, the most powerful ORM for Angular
MD
git add -A && git commit -qm "convex-firebase: initial commit"
