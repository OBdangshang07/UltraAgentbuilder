import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyCodexTransportWarning as classify} from '../../scripts/codex-transport-categories.mjs';

test('transport metadata emits only an allowlisted status/category, never log prose or secrets', () => {
  for (const [body, category, httpStatus] of [
    ['error decoding response body https://private.example/?token=secret', 'response-body-decode', null],
    ['unexpected status code: 429 private-account-description', 'rate-limit-warning', 429],
    ['unexpected status 502 upstream-secret', 'http-status-warning', 502],
    ['HTTP/1.1 503 credential=hidden', 'http-status-warning', 503],
    ['status: 403 auth-cookie=hidden', 'authentication-http-warning', 403],
    ['stream disconnected before completion private-session', 'stream-disconnected', null],
    ['network timeout opaque-id', 'transport-timeout-warning', null],
    ['unclassified private prose', 'transport-retry-warning-unclassified', null],
  ]) assert.deepEqual(classify(body), {category, httpStatus});
});
test('arbitrary numbers/model prose cannot invent a transport HTTP status', () => {
  for (const text of ['opaque429', 'build has 502 blocks', 'status 599 unknown', null]) {
    assert.equal(classify(text).httpStatus, null); assert.deepEqual(Object.keys(classify(text)), ['category', 'httpStatus']);
  }
});
