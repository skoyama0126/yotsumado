const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 既定の英語メニューバー（File/Edit/View/Window/Help）は使わない。独自UIで操作するため非表示にする。
Menu.setApplicationMenu(null);

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'MyExplorer',
    icon: path.join(__dirname, '../../build/icon.ico'),
  });
  win.removeMenu();

  win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ─── IPC handlers ────────────────────────────────────────────────────────────

// フォルダ内一覧取得
ipcMain.handle('read-dir', async (_, dirPath) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.map(e => {
      const fullPath = path.join(dirPath, e.name);
      let size = null;
      let mtime = null;
      let isDir = e.isDirectory();
      try {
        const stat = fs.statSync(fullPath);
        size = isDir ? null : stat.size;
        mtime = stat.mtimeMs;
      } catch (_) {}
      return { name: e.name, isDir, size, mtime, fullPath };
    });
  } catch (err) {
    return { error: err.message };
  }
});

// ドライブ一覧（Windows専用）
ipcMain.handle('get-drives', async () => {
  if (process.platform !== 'win32') return [{ path: '/', label: 'Root' }];
  const drives = [];
  for (let c = 65; c <= 90; c++) {
    const letter = String.fromCharCode(c);
    const drivePath = `${letter}:\\`;
    try {
      fs.accessSync(drivePath);
      drives.push({ path: drivePath, label: `${letter}:` });
    } catch (_) {}
  }
  return drives;
});

// 特殊フォルダ
ipcMain.handle('get-special-paths', async () => ({
  downloads: path.join(os.homedir(), 'Downloads'),
  desktop:   path.join(os.homedir(), 'Desktop'),
  trash:     null, // ゴミ箱はshell.openPathで対応
}));

// ファイルを既定アプリで開く
ipcMain.handle('open-file', async (_, filePath) => {
  await shell.openPath(filePath);
});

// ゴミ箱を開く（Windows）
ipcMain.handle('open-trash', async () => {
  shell.openPath('shell:RecycleBinFolder');
});

// プレビュー用：テキスト読み込み（最大100KB）
ipcMain.handle('read-text', async (_, filePath) => {
  try {
    const buf = Buffer.alloc(102400);
    const fd = fs.openSync(filePath, 'r');
    const bytesRead = fs.readSync(fd, buf, 0, 102400, 0);
    fs.closeSync(fd);
    return buf.slice(0, bytesRead).toString('utf8');
  } catch (err) {
    return { error: err.message };
  }
});

// プレビュー用：画像をbase64で返す
ipcMain.handle('read-image', async (_, filePath) => {
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase().slice(1);
    const mime = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', webp: 'webp', bmp: 'bmp', svg: 'svg+xml' };
    return `data:image/${mime[ext] || 'png'};base64,${data.toString('base64')}`;
  } catch (err) {
    return { error: err.message };
  }
});

// コピー（ファイル・フォルダ再帰対応）
ipcMain.handle('copy-path', async (_, srcPath, destDir) => {
  try {
    const dest = path.join(destDir, path.basename(srcPath));
    if (dest === srcPath) throw new Error('コピー元とコピー先が同じです');
    fs.cpSync(srcPath, dest, { recursive: true, errorOnExist: true });
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

// 移動（同ドライブはrename、跨ぐ場合はcopy+delete）
ipcMain.handle('move-path', async (_, srcPath, destDir) => {
  try {
    const dest = path.join(destDir, path.basename(srcPath));
    if (dest === srcPath) throw new Error('移動元と移動先が同じです');
    try {
      fs.renameSync(srcPath, dest);
    } catch (err) {
      if (err.code === 'EXDEV') {
        fs.cpSync(srcPath, dest, { recursive: true, errorOnExist: true });
        fs.rmSync(srcPath, { recursive: true, force: true });
      } else {
        throw err;
      }
    }
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

// 削除（ゴミ箱へ）
ipcMain.handle('delete-path', async (_, targetPath) => {
  try {
    await shell.trashItem(targetPath);
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});
