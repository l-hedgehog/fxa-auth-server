/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

var sinon = require('sinon')
var test = require('../ptaptest')

var log = {
  error: sinon.spy()
}
var Memcached = require('memcached')
var metricsContext = require('../../lib/metrics/context')(log, {
  memcache: { address: 'fake memcached address' }
})
var P = require('../../lib/promise')

test(
  'metricsContext interface is correct',
  function (t) {
    t.equal(typeof metricsContext, 'object', 'metricsContext is object')
    t.notEqual(metricsContext, null, 'metricsContext is not null')
    t.equal(Object.keys(metricsContext).length, 4, 'metricsContext has 4 properties')

    t.equal(typeof metricsContext.schema, 'object', 'metricsContext.schema is object')
    t.notEqual(metricsContext.schema, null, 'metricsContext.schema is not null')

    t.equal(typeof metricsContext.save, 'function', 'metricsContext.save is function')
    t.equal(metricsContext.save.length, 2, 'metricsContext.save expects 2 arguments')

    t.equal(typeof metricsContext.copy, 'function', 'metricsContext.copy is function')
    t.equal(metricsContext.copy.length, 4, 'metricsContext.copy expects 4 arguments')

    t.equal(typeof metricsContext.remove, 'function', 'metricsContext.remove is function')
    t.equal(metricsContext.remove.length, 1, 'metricsContext.remove expects 1 argument')

    t.end()
  }
)

test(
  'metricsContext.save',
  function (t) {
    sinon.stub(Memcached.prototype, 'setAsync', function () {
      return P.resolve('wibble')
    })
    return metricsContext.save({
      tokenId: {
        toString: function () {
          return 'foo'
        }
      }
    }, 'bar').then(function (result) {
      t.equal(result, 'wibble', 'result is correct')

      t.equal(Memcached.prototype.setAsync.callCount, 1, 'memcached.setAsync was called once')
      t.equal(Memcached.prototype.setAsync.args[0].length, 3, 'memcached.setAsync was passed three arguments')
      t.equal(Memcached.prototype.setAsync.args[0][0], 'foo', 'first argument was correct')
      t.equal(Memcached.prototype.setAsync.args[0][1], 'bar', 'second argument was correct')
      t.equal(Memcached.prototype.setAsync.args[0][2], 0, 'third argument was correct')

      t.equal(log.error.callCount, 0, 'log.error was not called')

      Memcached.prototype.setAsync.restore()
    })
  }
)

test(
  'metricsContext.save error',
  function (t) {
    sinon.stub(Memcached.prototype, 'setAsync', function () {
      return P.reject('wibble')
    })
    return metricsContext.save({
      tokenId: {
        toString: function () {
          return 'foo'
        }
      }
    }, 'bar').then(function (result) {
      t.equal(result, undefined, 'result is undefined')

      t.equal(Memcached.prototype.setAsync.callCount, 1, 'memcached.setAsync was called once')

      t.equal(log.error.callCount, 1, 'log.error was called once')
      t.equal(log.error.args[0].length, 1, 'log.error was passed one argument')
      t.equal(log.error.args[0][0].op, 'metricsContext.save', 'argument op property was correct')
      t.equal(log.error.args[0][0].err, 'wibble', 'argument err property was correct')

      Memcached.prototype.setAsync.restore()
      log.error.reset()
    })
  }
)

test(
  'metricsContext.save without token',
  function (t) {
    sinon.stub(Memcached.prototype, 'setAsync', function () {
      return P.resolve('wibble')
    })
    return metricsContext.save(null, 'foo').then(function (result) {
      t.equal(result, undefined, 'result is undefined')

      t.equal(Memcached.prototype.setAsync.callCount, 0, 'memcached.setAsync was not called')
      t.equal(log.error.callCount, 0, 'log.error was not called')

      Memcached.prototype.setAsync.restore()
    })
  }
)

test(
  'metricsContext.save without metadata',
  function (t) {
    sinon.stub(Memcached.prototype, 'setAsync', function () {
      return P.resolve('wibble')
    })
    return metricsContext.save({
      tokenId: {
        toString: function () {
          return 'foo'
        }
      }
    }).then(function (result) {
      t.equal(result, undefined, 'result is undefined')

      t.equal(Memcached.prototype.setAsync.callCount, 0, 'memcached.setAsync was not called')
      t.equal(log.error.callCount, 0, 'log.error was not called')

      Memcached.prototype.setAsync.restore()
    })
  }
)

test(
  'metricsContext.copy without metadata or session token',
  function (t) {
    return metricsContext.copy({}).then(function (result) {
      t.equal(typeof result, 'object', 'result is object')
      t.notEqual(result, null, 'result is not null')
      t.equal(Object.keys(result).length, 0, 'result is empty')

      t.equal(log.error.callCount, 0, 'log.error was not called')
    })
  }
)

test(
  'metricsContext.copy with metadata',
  function (t) {
    var time = Date.now() - 1
    return metricsContext.copy({}, {
      flowId: 'mock flow id',
      flowBeginTime: time,
      context: 'mock context',
      entrypoint: 'mock entry point',
      migration: 'mock migration',
      service: 'mock service',
      utmCampaign: 'mock utm_campaign',
      utmContent: 'mock utm_content',
      utmMedium: 'mock utm_medium',
      utmSource: 'mock utm_source',
      utmTerm: 'mock utm_term',
      ignore: 'mock ignorable property'
    }, null, false).then(function (result) {
      t.equal(typeof result, 'object', 'result is object')
      t.notEqual(result, null, 'result is not null')
      t.equal(Object.keys(result).length, 12, 'result has 12 properties')
      t.ok(result.time > time, 'result.time seems correct')
      t.equal(result.flow_id, 'mock flow id', 'result.flow_id is correct')
      t.ok(result.flow_time > 0, 'result.flow_time is greater than zero')
      t.ok(result.flow_time < time, 'result.flow_time is less than the current time')
      t.equal(result.context, 'mock context', 'result.context is correct')
      t.equal(result.entrypoint, 'mock entry point', 'result.entry point is correct')
      t.equal(result.migration, 'mock migration', 'result.migration is correct')
      t.equal(result.service, 'mock service', 'result.service is correct')
      t.equal(result.utm_campaign, 'mock utm_campaign', 'result.utm_campaign is correct')
      t.equal(result.utm_content, 'mock utm_content', 'result.utm_content is correct')
      t.equal(result.utm_medium, 'mock utm_medium', 'result.utm_medium is correct')
      t.equal(result.utm_source, 'mock utm_source', 'result.utm_source is correct')
      t.equal(result.utm_term, 'mock utm_term', 'result.utm_term is correct')

      t.equal(log.error.callCount, 0, 'log.error was not called')
    })
  }
)

test(
  'metricsContext.copy with bad flowBeginTime',
  function (t) {
    return metricsContext.copy({}, {
      flowBeginTime: Date.now() + 10000
    }, null, false).then(function (result) {
      t.equal(typeof result, 'object', 'result is object')
      t.notEqual(result, null, 'result is not null')
      t.strictEqual(result.flow_time, 0, 'result.time is zero')

      t.equal(log.error.callCount, 0, 'log.error was not called')
    })
  }
)

test(
  'metricsContext.copy with DNT header',
  function (t) {
    var time = Date.now() - 1
    return metricsContext.copy({}, {
      flowId: 'mock flow id',
      flowBeginTime: time,
      context: 'mock context',
      entrypoint: 'mock entry point',
      migration: 'mock migration',
      service: 'mock service',
      utmCampaign: 'mock utm_campaign',
      utmContent: 'mock utm_content',
      utmMedium: 'mock utm_medium',
      utmSource: 'mock utm_source',
      utmTerm: 'mock utm_term',
      ignore: 'mock ignorable property'
    }, null, true).then(function (result) {
      t.equal(Object.keys(result).length, 7, 'result has 7 properties')
      t.equal(result.utm_campaign, undefined, 'result.utm_campaign is undefined')
      t.equal(result.utm_content, undefined, 'result.utm_content is undefined')
      t.equal(result.utm_medium, undefined, 'result.utm_medium is undefined')
      t.equal(result.utm_source, undefined, 'result.utm_source is undefined')
      t.equal(result.utm_term, undefined, 'result.utm_term is undefined')

      t.equal(log.error.callCount, 0, 'log.error was not called')
    })
  }
)

test(
  'metricsContext.copy with session token',
  function (t) {
    var time = Date.now() - 1
    sinon.stub(Memcached.prototype, 'getAsync', function () {
      return P.resolve({
        flowId: 'flowId',
        flowBeginTime: time,
        context: 'context',
        entrypoint: 'entrypoint',
        migration: 'migration',
        service: 'service',
        utmCampaign: 'utm_campaign',
        utmContent: 'utm_content',
        utmMedium: 'utm_medium',
        utmSource: 'utm_source',
        utmTerm: 'utm_term',
        ignore: 'ignore me'
      })
    })
    return metricsContext.copy({}, null, {
      tokenId: {
        toString: function () {
          return 'foo'
        }
      }
    }, false).then(function (result) {
      t.equal(Memcached.prototype.getAsync.callCount, 1)
      t.equal(Memcached.prototype.getAsync.args[0].length, 1)
      t.equal(Memcached.prototype.getAsync.args[0][0], 'foo')

      t.equal(typeof result, 'object', 'result is object')
      t.notEqual(result, null, 'result is not null')
      t.equal(Object.keys(result).length, 12, 'result has 12 properties')
      t.ok(result.time > time, 'result.time seems correct')
      t.equal(result.flow_id, 'flowId', 'result.flow_id is correct')
      t.ok(result.flow_time > 0, 'result.flow_time is greater than zero')
      t.ok(result.flow_time < time, 'result.flow_time is less than the current time')
      t.equal(result.context, 'context', 'result.context is correct')
      t.equal(result.entrypoint, 'entrypoint', 'result.entry point is correct')
      t.equal(result.migration, 'migration', 'result.migration is correct')
      t.equal(result.service, 'service', 'result.service is correct')
      t.equal(result.utm_campaign, 'utm_campaign', 'result.utm_campaign is correct')
      t.equal(result.utm_content, 'utm_content', 'result.utm_content is correct')
      t.equal(result.utm_medium, 'utm_medium', 'result.utm_medium is correct')
      t.equal(result.utm_source, 'utm_source', 'result.utm_source is correct')
      t.equal(result.utm_term, 'utm_term', 'result.utm_term is correct')

      t.equal(log.error.callCount, 0, 'log.error was not called')

      Memcached.prototype.getAsync.restore()
    })
  }
)

test(
  'metricsContext.copy with metadata and session token',
  function (t) {
    var time = Date.now() - 1
    sinon.stub(Memcached.prototype, 'getAsync', function () {
      return P.resolve({
        flowId: 'foo',
        flowBeginTime: time
      })
    })
    return metricsContext.copy({}, {
      flowId: 'bar',
      flowBeginTime: time
    }, {
      tokenId: {
        toString: function () {
          return 'baz'
        }
      }
    }, false).then(function (result) {
      t.equal(typeof result, 'object', 'result is object')
      t.notEqual(result, null, 'result is not null')
      t.equal(result.flow_id, 'bar', 'result.flow_id is correct')

      t.equal(Memcached.prototype.getAsync.callCount, 0)
      t.equal(log.error.callCount, 0, 'log.error was not called')

      Memcached.prototype.getAsync.restore()
    })
  }
)

test(
  'metricsContext.copy with error',
  function (t) {
    sinon.stub(Memcached.prototype, 'getAsync', function () {
      return P.reject('foo')
    })
    return metricsContext.copy({}, null, {
      tokenId: {
        toString: function () {
          return 'bar'
        }
      }
    }, false).then(function () {
      t.equal(log.error.callCount, 1, 'log.error was called once')
      t.equal(log.error.args[0].length, 1, 'log.error was passed one argument')
      t.equal(log.error.args[0][0].op, 'metricsContext.restore', 'argument op property was correct')
      t.equal(log.error.args[0][0].err, 'foo', 'argument err property was correct')

      t.equal(Memcached.prototype.getAsync.callCount, 1, 'memcache.getAsync was called once')

      Memcached.prototype.getAsync.restore()
      log.error.reset()
    })
  }
)

test(
  'metricsContext.remove',
  function (t) {
    sinon.stub(Memcached.prototype, 'delAsync', function () {
      return P.resolve('wibble')
    })
    return metricsContext.remove({
      tokenId: {
        toString: function () {
          return 'wibble'
        }
      }
    }).then(function (result) {
      t.equal(result, 'wibble', 'result is correct')

      t.equal(Memcached.prototype.delAsync.callCount, 1, 'memcached.delAsync was called once')
      t.equal(Memcached.prototype.delAsync.args[0].length, 1, 'memcached.delAsync was passed one argument')
      t.equal(Memcached.prototype.delAsync.args[0][0], 'wibble', 'first argument was correct')

      t.equal(log.error.callCount, 0, 'log.error was not called')

      Memcached.prototype.delAsync.restore()
    })
  }
)

test(
  'metricsContext.remove error',
  function (t) {
    sinon.stub(Memcached.prototype, 'delAsync', function () {
      return P.reject('foo')
    })
    return metricsContext.remove({
      tokenId: {
        toString: function () {
          return 'bar'
        }
      }
    }).then(function (result) {
      t.equal(result, undefined, 'result is undefined')

      t.equal(Memcached.prototype.delAsync.callCount, 1, 'memcached.delAsync was called once')

      t.equal(log.error.callCount, 1, 'log.error was called once')
      t.equal(log.error.args[0].length, 1, 'log.error was passed one argument')
      t.equal(log.error.args[0][0].op, 'metricsContext.remove', 'argument op property was correct')
      t.equal(log.error.args[0][0].err, 'foo', 'argument err property was correct')

      Memcached.prototype.delAsync.restore()
      log.error.reset()
    })
  }
)

test(
  'metricsContext.remove without token',
  function (t) {
    sinon.stub(Memcached.prototype, 'delAsync', function () {
      return P.resolve('wibble')
    })
    return metricsContext.remove(null).then(function (result) {
      t.equal(result, undefined, 'result is undefined')

      t.equal(Memcached.prototype.delAsync.callCount, 0, 'memcached.delAsync was not called')
      t.equal(log.error.callCount, 0, 'log.error was not called')

      Memcached.prototype.delAsync.restore()
    })
  }
)

