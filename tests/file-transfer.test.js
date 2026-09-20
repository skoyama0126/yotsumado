const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { transferPath } = require('../src/main/file-transfer');

test('copy/move round trip, collision and self/descendant protection', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yotsumado-transfer-'));
  try {
    const source = path.join(root, '日本語 source');
    const target = path.join(root, 'target');
    const moved = path.join(root, 'moved');
    await Promise.all([source, target, moved].map(p => fs.mkdir(p)));
    const file = path.join(source, 'sample.txt');
    await fs.writeFile(file, 'original');
    await transferPath(file, target);
    assert.equal(await fs.readFile(path.join(target, 'sample.txt'), 'utf8'), 'original');
    assert.equal(await fs.readFile(file, 'utf8'), 'original');
    await fs.writeFile(file, 'changed');
    await assert.rejects(transferPath(file, target), /上書きしません/);
    await assert.rejects(transferPath(file, target, true), /上書きしません/);
    assert.equal(await fs.readFile(path.join(target, 'sample.txt'), 'utf8'), 'original');
    await assert.rejects(transferPath(file, source), /同じ/);
    await assert.rejects(transferPath(source, source), /配下/);
    await transferPath(source, moved, true);
    assert.equal(await fs.readFile(path.join(moved, '日本語 source', 'sample.txt'), 'utf8'), 'changed');
    await assert.rejects(fs.stat(source), { code: 'ENOENT' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
