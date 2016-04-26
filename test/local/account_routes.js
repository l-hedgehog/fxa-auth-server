/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

require('ass')

var sinon = require('sinon')

var test = require('../ptaptest')
var mocks = require('../mocks')
var getRoute = require('../routes_helpers').getRoute

var P = require('../../lib/promise')
var uuid = require('uuid')
var crypto = require('crypto')
var isA = require('joi')
var error = require('../../lib/error')

var TEST_EMAIL = 'foo@gmail.com'
var TEST_EMAIL_INVALID = 'example@dotless-domain'

var makeRoutes = function (options) {
  options = options || {}

  var config = options.config || {}
  config.verifierVersion = config.verifierVersion || 0
  config.smtp = config.smtp ||  {}
  config.memcache = config.memcache || {}

  var log = options.log || mocks.mockLog()
  var Password = options.Password || require('../../lib/crypto/password')(log, config)
  var db = options.db || {}
  var isPreVerified = require('../../lib/preverifier')(error, config)
  var customs = options.customs || {}
  var checkPassword = options.checkPassword || require('../../lib/routes/utils/password_check')(log, config, Password, customs, db)
  var push = options.push || require('../../lib/push')(log, db)
  return require('../../lib/routes/account')(
    log,
    crypto,
    P,
    uuid,
    isA,
    error,
    db,
    options.mailer || {},
    Password,
    config,
    customs,
    isPreVerified,
    checkPassword,
    push,
    options.metricsContext || require('../../lib/metrics/context')(log, config)
  )
}

test(
  'account with unverified invalid email gets deleted on status poll',
  function (t) {
    var mockDB = {
      deleteAccount: sinon.spy(function() {
        return P.resolve()
      })
    }
    var mockRequest = {
      auth: {
        credentials: {
          email: TEST_EMAIL_INVALID,
          emailVerified: false
        }
      }
    }

    var accountRoutes = makeRoutes({
      db: mockDB
    })
    var route = getRoute(accountRoutes, '/recovery_email/status')

    return new P(function(resolve) {
      route.handler(mockRequest, function(response) {
        resolve(response)
      })
    })
    .then(function(response) {
      t.equal(mockDB.deleteAccount.callCount, 1)
      t.equal(mockDB.deleteAccount.firstCall.args[0].email, TEST_EMAIL_INVALID)
      t.equal(response.errno, error.ERRNO.INVALID_TOKEN)
    })
  }
)

test(
  'account with verified invalid email does not get deleted on status poll',
  function (t) {
    var mockDB = {
      deleteAccount: sinon.spy()
    }
    var mockRequest = {
      auth: {
        credentials: {
          email: TEST_EMAIL_INVALID,
          emailVerified: true
        }
      }
    }

    var accountRoutes = makeRoutes({
      db: mockDB
    })
    var route = getRoute(accountRoutes, '/recovery_email/status')

    return new P(function(resolve) {
      route.handler(mockRequest, function(response) {
        resolve(response)
      })
    })
    .then(function(response) {
      t.equal(mockDB.deleteAccount.callCount, 0)
      t.deepEqual(response, {
        email: TEST_EMAIL_INVALID,
        verified: true
      })
    })
  }
)

test(
  '/recovery_email/status logs query reason',
  function (t) {
    var pushCalled = false
    var mockLog = mocks.mockLog({
      increment: function (name) {
        if (name === 'recovery_email_reason.push') {
          pushCalled = true
        }
      }
    })
    var mockRequest = {
      auth: {
        credentials: {
          email: TEST_EMAIL,
          emailVerified: true
        }
      },
      query: {
        reason: 'push'
      }
    }
    var accountRoutes = makeRoutes({
      log: mockLog
    })

    getRoute(accountRoutes, '/recovery_email/status')
      .handler(mockRequest, function() {
        t.equal(pushCalled, true)
        t.end()
      })
  }
)

test(
  'device should be notified when the account is reset',
  function (t) {
    var uid = uuid.v4('binary')
    var mockRequest = {
      auth: {
        credentials: {
          uid: uid.toString('hex')
        }
      },
      payload: {
        authPW: crypto.randomBytes(32).toString('hex')
      }
    }
    var mockDB = {
      resetAccount: sinon.spy(function () {
        return P.resolve()
      }),
      account: sinon.spy(function () {
        return P.resolve({
          uid: uid,
          verifierSetAt: 0,
          email: TEST_EMAIL
        })
      })
    }
    var mockCustoms = {
      reset: sinon.spy(function (email) {
        return P.resolve()
      })
    }
    var mockPush = {
      notifyUpdate: sinon.spy(function () {})
    }
    var accountRoutes = makeRoutes({
      db: mockDB,
      customs: mockCustoms,
      push: mockPush
    })

    return new P(function(resolve) {
      getRoute(accountRoutes, '/account/reset')
        .handler(mockRequest, function(response) {
          resolve(response)
        })
    })
    .then(function(response) {
      t.equal(mockDB.resetAccount.callCount, 1)

      t.equal(mockPush.notifyUpdate.callCount, 1)
      t.equal(mockPush.notifyUpdate.firstCall.args[0], uid.toString('hex'))
      t.equal(mockPush.notifyUpdate.firstCall.args[1], 'passwordReset')

      t.equal(mockDB.account.callCount, 1)
      t.equal(mockCustoms.reset.callCount, 1)
    })
  }
)

test(
  'device updates dont write to the db if nothing has changed',
  function (t) {
    var uid = uuid.v4('binary')
    var deviceId = crypto.randomBytes(16)
    var mockRequest = {
      auth: {
        credentials: {
          uid: uid.toString('hex'),
          deviceId: deviceId,
          deviceName: 'my awesome device',
          deviceType: 'desktop',
          deviceCallbackURL: '',
          deviceCallbackPublicKey: '',
        }
      },
      payload: {
        id: deviceId.toString('hex'),
        name: 'my awesome device'
      }
    }
    var mockDB = {
      updateDevice: sinon.spy(function () {
        return P.resolve()
      })
    }
    var mockLog = mocks.spyLog()
    var accountRoutes = makeRoutes({
      db: mockDB,
      log: mockLog
    })
    return new P(function(resolve) {
      getRoute(accountRoutes, '/account/device')
        .handler(mockRequest, function(response) {
          resolve(response)
        })
    })
    .then(function(response) {
      t.equal(mockDB.updateDevice.callCount, 0, 'updateDevice was not called')

      t.equal(mockLog.increment.callCount, 1, 'a counter was incremented')
      t.equal(mockLog.increment.firstCall.args[0], 'device.update.spurious')

      t.deepEqual(response, mockRequest.payload)
    })
  }
)

test(
  'device updates log metrics about what has changed',
  function (t) {
    var uid = uuid.v4('binary')
    var deviceId = crypto.randomBytes(16)
    var mockRequest = {
      auth: {
        credentials: {
          uid: uid.toString('hex'),
          tokenId: 'lookmumasessiontoken',
          deviceId: 'aDifferentDeviceId',
          deviceName: 'my awesome device',
          deviceType: 'desktop',
          deviceCallbackURL: '',
          deviceCallbackPublicKey: '',
        }
      },
      payload: {
        id: deviceId.toString('hex'),
        name: 'my even awesomer device',
        type: 'phone',
        pushCallback: 'https://push.services.mozilla.com/123456',
        pushPublicKey: 'SomeEncodedBinaryStuffThatDoesntGetValidedByThisTest'
      }
    }
    var mockDB = {
      updateDevice: sinon.spy(function (uid, sessionTokenId, deviceInfo) {
        return P.resolve(deviceInfo)
      })
    }
    var mockLog = mocks.spyLog()
    var accountRoutes = makeRoutes({
      db: mockDB,
      log: mockLog
    })
    return new P(function(resolve) {
      getRoute(accountRoutes, '/account/device')
        .handler(mockRequest, function(response) {
          resolve(response)
        })
    })
    .then(function() {
      t.equal(mockDB.updateDevice.callCount, 1, 'updateDevice was called')

      t.equal(mockLog.increment.callCount, 5, 'the counters were incremented')
      t.equal(mockLog.increment.getCall(0).args[0], 'device.update.sessionToken')
      t.equal(mockLog.increment.getCall(1).args[0], 'device.update.name')
      t.equal(mockLog.increment.getCall(2).args[0], 'device.update.type')
      t.equal(mockLog.increment.getCall(3).args[0], 'device.update.pushCallback')
      t.equal(mockLog.increment.getCall(4).args[0], 'device.update.pushPublicKey')
    })
  }
)

test(
  'device updates can be disabled via config',
  function (t) {
    var uid = uuid.v4('binary')
    var deviceId = crypto.randomBytes(16)
    var mockRequest = {
      auth: {
        credentials: {
          uid: uid.toString('hex'),
          deviceId: deviceId
        }
      },
      payload: {
        id: deviceId.toString('hex'),
        name: 'new device name'
      }
    }
    var accountRoutes = makeRoutes({
      config: {
        deviceUpdatesEnabled: false
      }
    })

    return new P(function(resolve) {
      getRoute(accountRoutes, '/account/device')
        .handler(mockRequest, function(response) {
          resolve(response)
        })
    })
    .then(
      function(response) {
        t.fail('should have thrown')
      },
      function(err) {
        t.equal(err.output.statusCode, 503, 'correct status code is returned')
        t.equal(err.errno, error.ERRNO.FEATURE_NOT_ENABLED, 'correct errno is returned')
      }
    )
  }
)

test(
  '/account/create emits account.created activity event and saves metrics context',
  function (t) {
    var keyFetchToken, sessionToken, uid
    var mockLog = mocks.mockLog({
      activityEvent: sinon.spy()
    })
    var mockMetricsContext = {
      save: sinon.spy()
    }
    var mockRequest = {
      app: {
        acceptLanguage: 'en',
        clientAddress: '127.0.0.1'
      },
      headers: {
        'user-agent': 'foo'
      },
      payload: {
        email: crypto.randomBytes(16).toString('hex') + '@restmail.net',
        authPW: crypto.randomBytes(32).toString('hex')
      },
      query: {
        keys: 'true'
      }
    }
    var accountRoutes = makeRoutes({
      customs: {
        check: function () {
          return P.resolve()
        }
      },
      db: {
        createAccount: function (account) {
          uid = account.uid
          return P.resolve(account)
        },
        createKeyFetchToken: function (kft) {
          keyFetchToken = kft
          keyFetchToken.data = crypto.randomBytes(32)
          keyFetchToken.tokenId = crypto.randomBytes(32)
          return P.resolve(keyFetchToken)
        },
        createSessionToken: function (st) {
          sessionToken = st
          sessionToken.data = crypto.randomBytes(32)
          sessionToken.tokenId = crypto.randomBytes(32)
          sessionToken.lastAuthAt = function () {}
          return P.resolve(sessionToken)
        },
        emailRecord: function () {
          return P.reject(error.unknownAccount(mockRequest.payload.email))
        }
      },
      log: mockLog,
      mailer: {
        sendVerifyCode: function () {
          return P.resolve()
        }
      },
      metricsContext: mockMetricsContext
    })

    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/create')
        .handler(mockRequest, resolve)
    })
    .then(
      function () {
        t.equal(mockLog.activityEvent.callCount, 1)
        t.equal(mockLog.activityEvent.args[0].length, 3)
        t.equal(mockLog.activityEvent.args[0][0], 'account.created')
        t.equal(mockLog.activityEvent.args[0][1], mockRequest)
        t.deepEqual(mockLog.activityEvent.args[0][2], {
          uid: uid.toString('hex')
        })

        t.equal(mockMetricsContext.save.callCount, 2)
        t.equal(mockMetricsContext.save.args[0].length, 2)
        t.equal(mockMetricsContext.save.args[0][0], sessionToken)
        t.equal(mockMetricsContext.save.args[0][1], mockRequest.payload.metricsContext)
        t.equal(mockMetricsContext.save.args[1].length, 2)
        t.equal(mockMetricsContext.save.args[1][0], keyFetchToken)
        t.equal(mockMetricsContext.save.args[1][1], mockRequest.payload.metricsContext)
      },
      function () {
        t.fail('request should have succeeded')
      }
    )
  }
)

test(
  '/account/create emits device.created activity event',
  function (t) {
    var deviceId, sessionToken, uid
    var mockLog = mocks.mockLog({
      activityEvent: sinon.spy()
    })
    var mockRequest = {
      app: {
        acceptLanguage: 'en',
        clientAddress: '127.0.0.1'
      },
      headers: {
        'user-agent': 'foo'
      },
      payload: {
        email: crypto.randomBytes(16).toString('hex') + '@restmail.net',
        authPW: crypto.randomBytes(32).toString('hex'),
        device: {
          name: 'bar',
          type: 'mobile'
        }
      },
      query: {}
    }
    var accountRoutes = makeRoutes({
      customs: {
        check: function () {
          return P.resolve()
        }
      },
      db: {
        createAccount: function (account) {
          uid = account.uid
          return P.resolve(account)
        },
        createDevice: function (uid, sessionTokenId, device) {
          deviceId = crypto.randomBytes(16)
          device.id = deviceId
          return P.resolve(device)
        },
        createSessionToken: function (st) {
          sessionToken = st
          sessionToken.data = crypto.randomBytes(32)
          sessionToken.tokenId = crypto.randomBytes(32)
          sessionToken.lastAuthAt = function () {}
          return P.resolve(sessionToken)
        },
        emailRecord: function () {
          return P.reject(error.unknownAccount(mockRequest.payload.email))
        }
      },
      log: mockLog,
      mailer: {
        sendVerifyCode: function () {
          return P.resolve()
        }
      }
    })

    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/create')
        .handler(mockRequest, resolve)
    })
    .then(
      function () {
        t.equal(mockLog.activityEvent.callCount, 2)
        t.equal(mockLog.activityEvent.args[1].length, 3)
        t.equal(mockLog.activityEvent.args[1][0], 'device.created')
        t.equal(mockLog.activityEvent.args[1][1], mockRequest)
        t.deepEqual(mockLog.activityEvent.args[1][2], {
          uid: uid.toString('hex'),
          device_id: deviceId.toString('hex')
        })
      },
      function () {
        t.fail('request should have succeeded')
      }
    )
  }
)

test(
  '/account/login emits account.login activity event and saves metrics context',
  function (t) {
    var keyFetchToken, sessionToken, uid
    var mockLog = mocks.mockLog({
      activityEvent: sinon.spy()
    })
    var mockMetricsContext = {
      save: sinon.spy()
    }
    var mockRequest = {
      app: {
        acceptLanguage: 'en',
        clientAddress: '127.0.0.1'
      },
      headers: {
        'user-agent': 'foo'
      },
      payload: {
        email: crypto.randomBytes(16).toString('hex') + '@restmail.net',
        authPW: crypto.randomBytes(32).toString('hex')
      },
      query: {
        keys: 'true'
      }
    }
    var accountRoutes = makeRoutes({
      checkPassword: function () {
        return P.resolve(true)
      },
      customs: {
        check: function () {
          return P.resolve()
        }
      },
      db: {
        createKeyFetchToken: function (kft) {
          keyFetchToken = kft
          keyFetchToken.data = crypto.randomBytes(32)
          keyFetchToken.tokenId = crypto.randomBytes(32)
          return P.resolve(keyFetchToken)
        },
        createSessionToken: function (st) {
          sessionToken = st
          sessionToken.data = crypto.randomBytes(32)
          sessionToken.tokenId = crypto.randomBytes(32)
          sessionToken.lastAuthAt = function () {}
          return P.resolve(sessionToken)
        },
        emailRecord: function () {
          uid = crypto.randomBytes(16)
          return P.resolve({
            authAt: Date.now(),
            email: mockRequest.payload.email,
            emailVerified: true,
            uid: uid
          })
        }
      },
      log: mockLog,
      metricsContext: mockMetricsContext,
      Password: function () {
        return {
          unwrap: function () {
            return P.resolve('bar')
          }
        }
      }
    })

    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/login')
        .handler(mockRequest, resolve)
    })
    .then(
      function () {
        t.equal(mockLog.activityEvent.callCount, 1)
        t.equal(mockLog.activityEvent.args[0].length, 3)
        t.equal(mockLog.activityEvent.args[0][0], 'account.login')
        t.equal(mockLog.activityEvent.args[0][1], mockRequest)
        t.deepEqual(mockLog.activityEvent.args[0][2], {
          uid: uid.toString('hex')
        })

        t.equal(mockMetricsContext.save.callCount, 2)
        t.equal(mockMetricsContext.save.args[0].length, 2)
        t.equal(mockMetricsContext.save.args[0][0], sessionToken)
        t.equal(mockMetricsContext.save.args[0][1], mockRequest.payload.metricsContext)
        t.equal(mockMetricsContext.save.args[1].length, 2)
        t.equal(mockMetricsContext.save.args[1][0], keyFetchToken)
        t.equal(mockMetricsContext.save.args[1][1], mockRequest.payload.metricsContext)
      },
      function () {
        t.fail('request should have succeeded')
      }
    )
  }
)

test(
  '/account/login emits device.created activity event',
  function (t) {
    var deviceId, sessionToken, uid
    var mockLog = mocks.mockLog({
      activityEvent: sinon.spy()
    })
    var mockRequest = {
      app: {
        acceptLanguage: 'en',
        clientAddress: '127.0.0.1'
      },
      headers: {
        'user-agent': 'foo'
      },
      payload: {
        email: crypto.randomBytes(16).toString('hex') + '@restmail.net',
        authPW: crypto.randomBytes(32).toString('hex'),
        device: {
          name: 'bar',
          type: 'mobile'
        }
      },
      query: {}
    }
    var accountRoutes = makeRoutes({
      checkPassword: function () {
        return P.resolve(true)
      },
      customs: {
        check: function () {
          return P.resolve()
        }
      },
      db: {
        createDevice: function (uid, sessionTokenId, device) {
          deviceId = crypto.randomBytes(16)
          device.id = deviceId
          return P.resolve(device)
        },
        createSessionToken: function (st) {
          sessionToken = st
          sessionToken.data = crypto.randomBytes(32)
          sessionToken.tokenId = crypto.randomBytes(32)
          sessionToken.lastAuthAt = function () {}
          return P.resolve(sessionToken)
        },
        emailRecord: function () {
          uid = crypto.randomBytes(16)
          return P.resolve({
            authAt: Date.now(),
            email: mockRequest.payload.email,
            emailVerified: true,
            uid: uid
          })
        }
      },
      log: mockLog
    })

    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/login')
        .handler(mockRequest, resolve)
    })
    .then(
      function () {
        t.equal(mockLog.activityEvent.callCount, 2)
        t.equal(mockLog.activityEvent.args[1].length, 3)
        t.equal(mockLog.activityEvent.args[1][0], 'device.created')
        t.equal(mockLog.activityEvent.args[1][1], mockRequest)
        t.deepEqual(mockLog.activityEvent.args[1][2], {
          uid: uid.toString('hex'),
          device_id: deviceId.toString('hex')
        })
      },
      function () {
        t.fail('request should have succeeded')
      }
    )
  }
)

test(
  '/account/login emits device.updated activity event',
  function (t) {
    var sessionToken, uid
    var mockLog = mocks.mockLog({
      activityEvent: sinon.spy()
    })
    var mockRequest = {
      app: {
        acceptLanguage: 'en',
        clientAddress: '127.0.0.1'
      },
      headers: {
        'user-agent': 'foo'
      },
      payload: {
        email: crypto.randomBytes(16).toString('hex') + '@restmail.net',
        authPW: crypto.randomBytes(32).toString('hex'),
        device: {
          id: crypto.randomBytes(16).toString('hex'),
          name: 'bar',
          type: 'mobile'
        }
      },
      query: {}
    }
    var accountRoutes = makeRoutes({
      checkPassword: function () {
        return P.resolve(true)
      },
      customs: {
        check: function () {
          return P.resolve()
        }
      },
      db: {
        updateDevice: function (uid, sessionTokenId, device) {
          return P.resolve(device)
        },
        createSessionToken: function (st) {
          sessionToken = st
          sessionToken.data = crypto.randomBytes(32)
          sessionToken.tokenId = crypto.randomBytes(32)
          sessionToken.lastAuthAt = function () {}
          return P.resolve(sessionToken)
        },
        emailRecord: function () {
          uid = crypto.randomBytes(16)
          return P.resolve({
            authAt: Date.now(),
            email: mockRequest.payload.email,
            emailVerified: true,
            uid: uid
          })
        }
      },
      log: mockLog
    })

    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/login')
        .handler(mockRequest, resolve)
    })
    .then(
      function () {
        t.equal(mockLog.activityEvent.callCount, 2)
        t.equal(mockLog.activityEvent.args[1].length, 3)
        t.equal(mockLog.activityEvent.args[1][0], 'device.updated')
        t.equal(mockLog.activityEvent.args[1][1], mockRequest)
        t.deepEqual(mockLog.activityEvent.args[1][2], {
          uid: uid.toString('hex'),
          device_id: mockRequest.payload.device.id
        })
      },
      function () {
        t.fail('request should have succeeded')
      }
    )
  }
)

test(
  '/account/keys emits account.keyfetch activity event and removes metrics context',
  function (t) {
    var mockLog = mocks.mockLog({
      activityEvent: sinon.spy()
    })
    var mockMetricsContext = {
      remove: sinon.spy()
    }
    var mockRequest = {
      app: {},
      auth: {
        credentials: {
          emailVerified: true,
          keyBundle: crypto.randomBytes(96),
          uid: crypto.randomBytes(16)
        }
      },
      headers: {},
      payload: {},
      query: {}
    }
    var accountRoutes = makeRoutes({
      db: {
        deleteKeyFetchToken: function () {
          return P.resolve()
        }
      },
      log: mockLog,
      metricsContext: mockMetricsContext
    })

    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/keys')
        .handler(mockRequest, resolve)
    })
    .then(
      function () {
        t.equal(mockLog.activityEvent.callCount, 1)
        t.equal(mockLog.activityEvent.args[0].length, 3)
        t.equal(mockLog.activityEvent.args[0][0], 'account.keyfetch')
        t.equal(mockLog.activityEvent.args[0][1], mockRequest)
        t.deepEqual(mockLog.activityEvent.args[0][2], {
          uid: mockRequest.auth.credentials.uid.toString('hex')
        })

        t.equal(mockMetricsContext.remove.callCount, 1)
        t.equal(mockMetricsContext.remove.args[0].length, 1)
        t.equal(mockMetricsContext.remove.args[0][0], mockRequest.auth.credentials)
      },
      function () {
        t.fail('request should have succeeded')
      }
    )
  }
)

test(
  '/account/device/destroy emits device.deleted activity event and removes metrics context',
  function (t) {
    var mockLog = mocks.mockLog({
      activityEvent: sinon.spy()
    })
    var mockMetricsContext = {
      remove: sinon.spy()
    }
    var mockRequest = {
      app: {},
      auth: {
        credentials: {
          tokenId: crypto.randomBytes(16),
          uid: crypto.randomBytes(16)
        }
      },
      headers: {},
      payload: {
        id: crypto.randomBytes(16).toString('hex')
      },
      query: {}
    }
    var accountRoutes = makeRoutes({
      db: {
        deleteDevice: function () {
          return P.resolve()
        }
      },
      log: mockLog,
      metricsContext: mockMetricsContext
    })

    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/device/destroy')
        .handler(mockRequest, resolve)
    })
    .then(
      function () {
        t.equal(mockLog.activityEvent.callCount, 1)
        t.equal(mockLog.activityEvent.args[0].length, 3)
        t.equal(mockLog.activityEvent.args[0][0], 'device.deleted')
        t.equal(mockLog.activityEvent.args[0][1], mockRequest)
        t.deepEqual(mockLog.activityEvent.args[0][2], {
          uid: mockRequest.auth.credentials.uid.toString('hex'),
          device_id: mockRequest.payload.id
        })

        t.equal(mockMetricsContext.remove.callCount, 1)
        t.equal(mockMetricsContext.remove.args[0].length, 1)
        t.equal(mockMetricsContext.remove.args[0][0], mockRequest.auth.credentials)
      },
      function () {
        t.fail('request should have succeeded')
      }
    )
  }
)

test(
  '/recovery_email/verify_code emits account.verified activity event',
  function (t) {
    var mockLog = mocks.mockLog({
      activityEvent: sinon.spy()
    })
    var mockRequest = {
      app: {
        acceptLanguage: 'en'
      },
      auth: {},
      headers: {},
      payload: {
        uid: crypto.randomBytes(16).toString('hex'),
        code: crypto.randomBytes(16).toString('hex')
      },
      query: {}
    }
    var accountRoutes = makeRoutes({
      config: {
        memcache: {},
        smtp: {
          resendBlackoutPeriod: 60000
        }
      },
      customs: {
        check: function () {
          return P.resolve()
        }
      },
      db: {
        account: function (uid) {
          return P.resolve({
            createdAt: Date.now(),
            email: crypto.randomBytes(16).toString('hex') + '@restmail.net',
            emailCode: Buffer(mockRequest.payload.code, 'hex'),
            emailVerified: false,
            locale: 'en',
            uid: uid
          })
        },
        verifyEmail: function () {
          return P.resolve()
        }
      },
      log: mockLog,
      mailer: {
        sendPostVerifyEmail: function () {}
      },
      push: {
        notifyUpdate: function () {}
      }
    })

    return new P(function (resolve) {
      getRoute(accountRoutes, '/recovery_email/verify_code')
        .handler(mockRequest, resolve)
    })
    .then(
      function () {
        t.equal(mockLog.activityEvent.callCount, 1)
        t.equal(mockLog.activityEvent.args[0].length, 3)
        t.equal(mockLog.activityEvent.args[0][0], 'account.verified')
        t.equal(mockLog.activityEvent.args[0][1], mockRequest)
        t.deepEqual(mockLog.activityEvent.args[0][2], {
          uid: mockRequest.payload.uid.toString('hex')
        })
      },
      function () {
        t.fail('request should have succeeded')
      }
    )
  }
)

test(
  '/account/reset emits account.reset activity event and saves metrics context',
  function (t) {
    var keyFetchToken, sessionToken
    var mockLog = mocks.mockLog({
      activityEvent: sinon.spy()
    })
    var mockMetricsContext = {
      save: sinon.spy()
    }
    var mockRequest = {
      app: {},
      auth: {
        credentials: {
          email: crypto.randomBytes(16).toString('hex') + '@restmail.net',
          uid: crypto.randomBytes(16),
          verifierSetAt: Date.now()
        }
      },
      headers: {
        'user-agent': 'foo'
      },
      payload: {
        authPW: crypto.randomBytes(32).toString('hex'),
        metricsContext: {},
        sessionToken: 'true'
      },
      query: {
        keys: 'true'
      }
    }
    var accountRoutes = makeRoutes({
      config: {
        domain: 'example.org',
        memcache: {}
      },
      customs: {
        reset: function () {}
      },
      db: {
        account: function (uid) {
          return P.resolve({
            email: crypto.randomBytes(16).toString('hex') + '@restmail.net',
            emailVerified: true,
            uid: uid,
            verifierSetAt: Date.now(),
            wrapWrapKb: 'bar'
          })
        },
        createKeyFetchToken: function (kft) {
          keyFetchToken = kft
          keyFetchToken.data = crypto.randomBytes(32)
          keyFetchToken.tokenId = crypto.randomBytes(32)
          return P.resolve(keyFetchToken)
        },
        createSessionToken: function (st) {
          sessionToken = st
          sessionToken.data = crypto.randomBytes(32)
          sessionToken.tokenId = crypto.randomBytes(32)
          sessionToken.lastAuthAt = function () {}
          return P.resolve(sessionToken)
        },
        resetAccount: function () {}
      },
      log: mockLog,
      metricsContext: mockMetricsContext,
      Password: function () {
        return {
          verifyHash: function () {
            return P.resolve('baz')
          },
          unwrap: function () {
            return P.resolve('qux')
          }
        }
      },
      push: {
        notifyUpdate: function () {}
      }
    })

    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/reset')
        .handler(mockRequest, resolve)
    })
    .then(
      function () {
        t.equal(mockLog.activityEvent.callCount, 1)
        t.equal(mockLog.activityEvent.args[0].length, 3)
        t.equal(mockLog.activityEvent.args[0][0], 'account.reset')
        t.equal(mockLog.activityEvent.args[0][1], mockRequest)
        t.deepEqual(mockLog.activityEvent.args[0][2], {
          uid: mockRequest.auth.credentials.uid.toString('hex')
        })

        t.equal(mockMetricsContext.save.callCount, 2)
        t.equal(mockMetricsContext.save.args[0].length, 2)
        t.equal(mockMetricsContext.save.args[0][0], sessionToken)
        t.equal(mockMetricsContext.save.args[0][1], mockRequest.payload.metricsContext)
        t.equal(mockMetricsContext.save.args[1].length, 2)
        t.equal(mockMetricsContext.save.args[1][0], keyFetchToken)
        t.equal(mockMetricsContext.save.args[1][1], mockRequest.payload.metricsContext)
      },
      function () {
        t.fail('request should have succeeded')
      }
    )
  }
)

test(
  '/account/device emits device.created activity event',
  function (t) {
    var deviceId
    var mockLog = mocks.mockLog({
      activityEvent: sinon.spy()
    })
    var mockRequest = {
      auth: {
        credentials: {
          uid: crypto.randomBytes(16),
          tokenId: crypto.randomBytes(16)
        }
      },
      headers: {},
      payload: {
        name: 'foo',
        type: 'mobile'
      },
      query: {}
    }
    var accountRoutes = makeRoutes({
      db: {
        createDevice: function (uid, sessionTokenId, device) {
          deviceId = crypto.randomBytes(16)
          device.id = deviceId
          return P.resolve(device)
        }
      },
      log: mockLog
    })

    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/device')
        .handler(mockRequest, resolve)
    })
    .then(
      function () {
        t.equal(mockLog.activityEvent.callCount, 1)
        t.equal(mockLog.activityEvent.args[0].length, 3)
        t.equal(mockLog.activityEvent.args[0][0], 'device.created')
        t.equal(mockLog.activityEvent.args[0][1], mockRequest)
        t.deepEqual(mockLog.activityEvent.args[0][2], {
          uid: mockRequest.auth.credentials.uid.toString('hex'),
          device_id: deviceId.toString('hex')
        })
      },
      function () {
        t.fail('request should have succeeded')
      }
    )
  }
)

test(
  '/account/device emits device.updated activity event',
  function (t) {
    var deviceId = crypto.randomBytes(16)
    var mockLog = mocks.mockLog({
      activityEvent: sinon.spy()
    })
    var mockRequest = {
      auth: {
        credentials: {
          deviceId: deviceId,
          deviceName: 'old device',
          type: 'mobile',
          uid: crypto.randomBytes(16),
          tokenId: crypto.randomBytes(16)
        }
      },
      headers: {},
      payload: {
        id: deviceId,
        name: 'new device',
        type: 'mobile'
      },
      query: {}
    }
    var accountRoutes = makeRoutes({
      db: {
        updateDevice: function (uid, sessionTokenId, device) {
          return P.resolve(device)
        }
      },
      log: mockLog
    })

    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/device')
        .handler(mockRequest, resolve)
    })
    .then(
      function () {
        t.equal(mockLog.activityEvent.callCount, 1)
        t.equal(mockLog.activityEvent.args[0].length, 3)
        t.equal(mockLog.activityEvent.args[0][0], 'device.updated')
        t.equal(mockLog.activityEvent.args[0][1], mockRequest)
        t.deepEqual(mockLog.activityEvent.args[0][2], {
          uid: mockRequest.auth.credentials.uid.toString('hex'),
          device_id: deviceId.toString('hex')
        })
      },
      function () {
        t.fail('request should have succeeded')
      }
    )
  }
)


