#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/bendrucker/creditcards.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .git/origin.git
git remote set-url --push origin "$PWD/.git/origin.git"
mkdir -p src
cat > README.md <<'FILE'
creditcards
============

Utility methods for formatting and validating credit cards
FILE
cat > package.json <<'FILE'
{
  "name": "creditcards",
  "version": "0.2.0",
  "description": "Utility methods for formatting and validating credit cards",
  "main": "index.js",
  "scripts": {
    "test": "mocha test"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/bendrucker/creditcards.git"
  },
  "keywords": [
    "credit",
    "cards",
    "validation",
    "formatting"
  ],
  "author": "Ben Drucker <bvdrucker@gmail.com> (http://www.bendrucker.me/)",
  "license": "MIT",
  "bugs": {
    "url": "https://github.com/bendrucker/creditcards/issues"
  },
  "homepage": "https://github.com/bendrucker/creditcards",
  "devDependencies": {
    "chai": "~1.9.1",
    "mocha": "~1.20.1"
  },
  "dependencies": {
    "camel-case": "~0.1.0"
  }
}
FILE
cat > index.js <<'FILE'
module.exports = require('./src');
FILE
cat > src/card.js <<'FILE'
'use strict';

exports.types = {
  visa: {
    name: 'Visa',
    pattern: /^4[0-9]{12}(?:[0-9]{3})?$/,
    cvcLength: 3
  },
  masterCard: {
    name: 'MasterCard',
    pattern: /^5[1-5][0-9]{14}$/,
    cvcLength: 3
  },
  americanExpress: {
    name: 'American Express',
    pattern: /^3[47][0-9]{13}$/,
    cvcLength: 4
  },
  dinersClub: {
    name: 'Diners Club',
    pattern: /^3(?:0[0-5]|[68][0-9])[0-9]{11}$/,
    cvcLength: 3
  },
  discover: {
    name: 'Discover',
    pattern: /^6(?:011|5[0-9]{2})[0-9]{12}$/,
    cvcLength: 3
  },
  jcb: {
    name: 'JCB',
    pattern: /^(?:2131|1800|35\d{3})\d{11}$/,
    cvcLength: 3
  }
};

exports.parse = function (number) {
  if (typeof number !== 'string') return '';
  return number.replace(/[^\d]/g, '');
};

exports.type = function (number) {
  for (var typeName in exports.types) {
    var type = exports.types[typeName];
    if (type.pattern.test(number)) return exports.types[typeName].name;
  }
};

exports.luhn = function (number) {
  if (!number) return false;
  // https://gist.github.com/ShirtlessKirk/2134376
  var len = number.length;
  var mul = 0;
  var prodArr = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [0, 2, 4, 6, 8, 1, 3, 5, 7, 9]];
  var sum = 0;

  while (len--) {
    sum += prodArr[mul][parseInt(number.charAt(len), 10)];
    mul ^= 1;
  }

  return sum % 10 === 0 && sum > 0;
};
FILE
cat > src/cvc.js <<'FILE'
'use strict';

var camel = require('camel-case');
var card  = require('./card');

var cvcRegex = /^\d{3,4}$/;

exports.isValid = function (cvc, type) {
  if (typeof cvc !== 'string') return false;
  if (!cvcRegex.test(cvc)) return false;
  if (!type) return true;
  return card.types[camel(type)].cvcLength === cvc.length;
};
FILE
cat > src/expiration.js <<'FILE'
'use strict';

exports.isPast = function (month, year) {
  return Date.now() >= new Date(year, month);
};

exports.month = {
  parse: function (month) {
    return ~~month || void 0;
  },
  isValid: function (month) {
    if (typeof month !== 'number') return false;
    return month >= 1 && month <= 12;
  }
};

exports.year = {
  parse: function (year, pad) {
    year = ~~year;
    if (!pad) return year;
    var base = new Date().getFullYear().toString().substr(0, 2);
    var str = base + (year.toString().length === 2 ? year : '0' + year);
    return ~~str || void 0;
  },
  isValid: function (year) {
    if (typeof year !== 'number') return false;
    return year > 0;
  },
  isPast: function (year) {
    return new Date().getFullYear() > year;
  }
};
FILE
cat > src/index.js <<'FILE'
'use strict';

var card = exports.card = require('./card');
var cvc = exports.cvc = require('./cvc');
var expiration = exports.expiration = require('./expiration');

exports.validate = function (cardObj) {
  return {
    card: {
      type: card.type(cardObj.number),
      number: cardObj.number,
      expirationMonth: cardObj.expirationMonth,
      expirationYear: cardObj.expirationYear,
      cvc: cardObj.cvc
    },
    validCardNumber: card.luhn(cardObj.number),
    validExpirationMonth: expiration.month.isValid(cardObj.expirationMonth),
    validExpirationYear: expiration.year.isValid(cardObj.expirationYear),
    validCvc: cvc.isValid(cardObj.cvc),
    expired: expiration.isPast(cardObj.expirationMonth, cardObj.expirationYear)
  }
};
FILE
git add -A && git commit -qm "init: parse, validate, and format credit card fields"
