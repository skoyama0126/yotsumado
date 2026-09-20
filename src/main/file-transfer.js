'use strict';
const fs = require('fs/promises');
const path = require('path');

async function transferPath(source, destinationDirectory, move = false) {
  if (typeof source !== 'string' || typeof destinationDirectory !== 'string' ||
      !path.isAbsolute(source) || !path.isAbsolute(destinationDirectory)) throw new Error('パスが不正です');
  const sourceReal = await fs.realpath(source);
  const directoryReal = await fs.realpath(destinationDirectory);
  if (!(await fs.stat(directoryReal)).isDirectory()) throw new Error('コピー先がフォルダではありません');
  const destination = path.join(directoryReal, path.basename(source));
  const relative = path.relative(sourceReal, destination);
  if (!relative) throw new Error('コピー元とコピー先が同じです');
  if ((await fs.stat(sourceReal)).isDirectory() && !path.isAbsolute(relative) &&
      relative !== '..' && !relative.startsWith(`..${path.sep}`)) throw new Error('自分自身の配下にはコピー・移動できません');
  try {
    await fs.lstat(destination);
    throw new Error('同じ名前のファイルまたはフォルダが既にあります（上書きしません）');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (move) {
    try { await fs.rename(source, destination); return; }
    catch (error) { if (error.code !== 'EXDEV') throw error; }
  }
  await fs.cp(source, destination, { recursive: true, force: false, errorOnExist: true });
  if (move) await fs.rm(source, { recursive: true });
}

module.exports = { transferPath };
