/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var test = require('../ptaptest')
var TestServer = require('../test_server')
var Client = require('../client')
var P = require('../../lib/promise')

process.env.RESEND_BLACKOUT_PERIOD = '500'
var config = require('../../config').getProperties()

TestServer.start(config)
.then(function main(server) {

  test(
    'resend blackout period',
    function (t) {
      // FYI config.tokenLifetimes.passwordChangeToken = -1
      var email = Math.random() + '@example.com'
      var password = 'ok'
      var client = null
      t.ok(true) // this silences log output. with no assertions tap dumps logs
      return Client.create(config.publicUrl, email, password, { preVerified: false })
        .then(
          function (c) {
            client = c
            return server.mailbox.waitForCode(email)
          }
        )
        .then(
          function () {
            return client.requestVerifyEmail()
          }
        )
        .then(
          function () {
            var d = P.defer()
            setTimeout(d.resolve.bind(d), config.smtp.resendBlackoutPeriod)
            return d.promise
          }
        )
        .then(
          function () {
            return client.requestVerifyEmail()
          }
        )
        .then(
          function () {
            return server.mailbox.waitForCode(email)
          }
        )
    }
  )

  test(
    'teardown',
    function (t) {
      server.stop()
      t.end()
    }
  )
})
