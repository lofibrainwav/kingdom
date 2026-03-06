const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getSchemaForChannel, validateEventPayload } = require('../agent/core/event-schemas');

describe('Event Schemas', () => {
  it('resolves exact and wildcard canonical schemas', () => {
    assert.deepEqual(getSchemaForChannel('work:intake'), ['author', 'task']);
    assert.deepEqual(getSchemaForChannel('execution:dispatch:coder-1'), ['author', 'action']);
    assert.deepEqual(getSchemaForChannel('knowledge:capture:stored'), ['author', 'projectId', 'title', 'notePath', 'outcome']);
    assert.deepEqual(getSchemaForChannel('knowledge:promotion:candidate'), ['author', 'projectId', 'taskId', 'title', 'notePath', 'promotionType']);
    assert.deepEqual(getSchemaForChannel('knowledge:promotion:applied'), ['author', 'projectId', 'taskId', 'promotionType', 'promotedTo']);
    assert.deepEqual(getSchemaForChannel('knowledge:notebooklm:claimed'), ['author', 'projectId', 'taskId', 'sourcePath', 'queueType']);
    assert.deepEqual(getSchemaForChannel('knowledge:notebooklm:queued'), ['author', 'projectId', 'taskId', 'sourcePath', 'queueType']);
    assert.deepEqual(getSchemaForChannel('knowledge:notebooklm:prepared'), ['author', 'projectId', 'taskId', 'packetPath', 'queueType']);
    assert.deepEqual(getSchemaForChannel('knowledge:notebooklm:ingested'), ['author', 'projectId', 'taskId', 'registryPath', 'queueType']);
    assert.deepEqual(getSchemaForChannel('knowledge:skill:eval-completed'), ['author', 'skillName', 'score', 'findingCount', 'passed']);
    assert.equal(getSchemaForChannel('unknown:event'), null);
  });

  it('validates required fields for known events', () => {
    assert.doesNotThrow(() => validateEventPayload('governance:review:approved', {
      projectId: 'p1',
      taskId: 't1',
      file: 'task.js',
    }));

    assert.throws(() => validateEventPayload('governance:review:approved', {
      projectId: 'p1',
      taskId: 't1',
    }), /requires field "file"/);
  });
});
