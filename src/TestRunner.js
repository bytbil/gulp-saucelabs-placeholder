'use strict';

var _ = require('lodash');
var Q = require('q');
var scheduler = require('./promise-scheduler');
var Job = require('./Job');

/**
 * Test runner.
 *
 * @constructor
 * @param {Object} properties - Configuration options.
 * @param {String} framework - The unit test framework's name. Can be 'yasmine', 'qunit',
 *   'YUI Test', 'mocha' or 'custom'.
 * @param {Function} onProgress - Progress handler.
 */
var TestRunner = function (properties, framework, onProgress) {
  this.user = properties.username;
  this.key = properties.key;
  this.pollInterval = properties.pollInterval;
  this.framework = framework;
  this.tunneled = properties.tunneled;
  this.tunnelId = properties.identifier;
  this.testName = properties.testname;
  this.build = properties.build;
  this.sauceConfig = properties.sauceConfig;
  this.onTestComplete = properties.onTestComplete;
  this.throttled = properties.throttled;
  this.browsers = properties.browsers;
  this.urls = properties.url || properties.urls;
  this.onProgress = onProgress;

  if (properties['max-duration']) {
    // max-duration is actually a sauce selenium capability
    this.sauceConfig['max-duration'] = properties['max-duration'];
  }
  this.urls = this.urls.length !== undefined ? this.urls : [this.urls];
  this.numberOfJobs = this.browsers.length * this.urls.length;
  this.startedJobs = 0;
};

/**
* Reports progress.
* @param {Object} progress - Progress data.
*/
TestRunner.prototype.reportProgress = function (progress) {
  if (this.onProgress) {
    this.onProgress(progress);
  }
};

/**
 * Runs the test in all of the browsers-URL combinations.
 *
 * @returns {Object} - A promise which will be eventually resolved with the test results
 *   (a boolean). Progress is reported after each job is started and completed.
 */
TestRunner.prototype.runTests = function () {
  var me = this;
  var throttledRunTest, promises;

  throttledRunTest = scheduler.limitConcurrency(this.runTest.bind(this), this.throttled || Number.MAX_VALUE);

  promises = this.urls
    .map(function (url) {
      return this.browsers.map(function (browser) {
        return throttledRunTest(browser, url);
      });
    }, this)
    .reduce(function (acc, promisesForUrl) {
      return acc.concat(promisesForUrl);
    }, []);

  return Q
    .all(promises)
    .then(function (results) {
      var passed = results.indexOf(false) === -1;

      me.reportProgress({
        type: 'testCompleted',
        passed: passed
      });

      return passed;
    });
};

/**
 * Runs a test with the specified URL in the specified environment.
 *
 * @param {Object} browser - The environment to run the test on.
 * @param {String} url - An URL that will be loaded in the browsers.
 * @returns {Object} - A promise which will be eventually resolved with the test results
 *   (a boolean). Progress is reported after the job is started and completed.
 */
TestRunner.prototype.runTest = function (browser, url) {
  var me = this;
  var job = new Job(this.user, this.key, this.framework, this.pollInterval, url, browser,
    this.build, this.testName, this.sauceConfig, this.tunneled, this.tunnelId);

  return job
    .start()
    .then(function () {
      me.startedJobs += 1;
      me.reportProgress({
        type: 'jobStarted',
        numberOfJobs: me.numberOfJobs,
        startedJobs: me.startedJobs
      });

      return job
        .getResult()
        .then(function (result) {
          if (me.onTestComplete) {
            var clone = _.clone(result, true);
            return Q
              .nfcall(me.onTestComplete, clone)
              .then(function (passed) {
                if (passed !== undefined) {
                  result.passed = !!passed;
                }
                return result;
              });
          }
          return result;
        })
        .then(function (result) {
          me.reportProgress({
            type: 'jobCompleted',
            url: url,
            platform: result.platform,
            passed: result.passed,
            tunnelId: me.tunnelId
          });

          return result.passed;
        });
    });
};

module.exports = TestRunner;