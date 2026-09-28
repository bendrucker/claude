---
fail: [length-floor]
---
<out>creditcards [![Build Status](https://travis-ci.org/bendrucker/angular-credit-cards.svg?branch=master)](https://travis-ci.org/bendrucker/angular-credit-cards) [![NPM version](https://badge.fury.io/js/creditcards.svg)](http://badge.fury.io/js/creditcards)
============

Utility methods for formatting and validating credit cards. With a minimal footprint and a flexible API, it's suitable for both Node and the browser.

# API

#### `validate(card)`

* Arguments:
  * `card` (object)
    * `number` (string)
    * `expirationMonth` (number)
    * `expirationYear` (number)
    * `cvc` (string)
* Returns:
  * object
    * `card`
      * `type` (string) - the [type](#cardtypenumber) of the provided car
</out>
