import assert from 'node:assert/strict';
import * as workerSupervisor from './worker-supervisor.js';

const inspectSearches = (workerSupervisor as Record<string, unknown>)['searchListHasActiveWork'] as
  ((text: string) => boolean) | undefined;

assert.equal(typeof inspectSearches, 'function', 'search status parser must be exported for tests');
assert.equal(inspectSearches?.('No active searches'), false);
assert.equal(inspectSearches?.('Search ID: 1\nStatus: Completed'), false);
assert.equal(inspectSearches?.('Search ID: 1\nStatus: Running'), true);
assert.equal(
  inspectSearches?.('Search ID: 1\nStatus: Completed\nSearch ID: 2\nStatus: Running'),
  true,
);
assert.equal(inspectSearches?.('Search ID: 1'), true);
console.log('SEARCH_STATUS_PASS: terminal searches do not block worker shutdown');
