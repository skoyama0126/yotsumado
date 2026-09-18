const { app, BrowserWindow, ipcMain, shell, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');
const APP_ID = 'com.myexplorer.app';

// 改名前の保存先を維持し、クイックアクセス・タブ・テーマの設定を引き継ぐ。
app.setPath('userData', path.join(app.getPath('appData'), 'myexplorer'));

// 既定の英語メニューバー（File/Edit/View/Window/Help）は使わない。独自UIで操作するため非表示にする。
Menu.setApplicationMenu(null);

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID);
}

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
    title: 'ヨツマド',
    icon: path.join(__dirname, '../../build/icon.ico'),
  });
  win.removeMenu();

  win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// Windows Shellのメニューを別プロセスで表示する（7-Zipなどの拡張にも対応）。
let shellMenuRunning = false;
ipcMain.handle('show-shell-menu', async (_, targetPath, background) => {
  if (shellMenuRunning) return { canceled: true };
  if (process.platform !== 'win32') return { error: 'Windows専用の機能です。' };
  if (typeof targetPath !== 'string' || !path.isAbsolute(targetPath) || !fs.existsSync(targetPath)) {
    return { error: '対象のファイルまたはフォルダが見つかりません。' };
  }
  const helper = app.isPackaged
    ? path.join(process.resourcesPath, 'native', 'Yotsumado.ShellMenu.exe')
    : path.join(__dirname, '../../build/native/Yotsumado.ShellMenu.exe');
  shellMenuRunning = true;
  try {
    return await new Promise(resolve => {
      execFile(helper, [background ? 'background' : 'item', targetPath],
        { windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) => {
          if (error) resolve({ error: stderr.trim() || error.message });
          else resolve({ action: stdout.replace(/^\uFEFF/, '').trim() });
        });
    });
  } finally { shellMenuRunning = false; }
});

ipcMain.handle('rename-path', async (_, source, name) => {
  try {
    if (typeof source !== 'string' || !path.isAbsolute(source)) throw new Error('パスが不正です');
    if (typeof name !== 'string' || !name || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('使えない名前です');
    const destination = path.join(path.dirname(source), name);
    if (destination === source) return { ok: true };
    if (fs.existsSync(destination) && destination.toLowerCase() !== source.toLowerCase()) {
      throw new Error('同じ名前のファイルまたはフォルダが既にあります');
    }
    fs.renameSync(source, destination);
    return { ok: true };
  } catch (error) { return { error: error.message }; }
});

// ─── IPC handlers ────────────────────────────────────────────────────────────

// フォルダ内一覧取得
ipcMain.handle('read-dir', async (_, dirPath) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.map(e => {
      const fullPath = path.join(dirPath, e.name);
      let size = null;
      let mtime = null;
      // dirent.isDirectory()はシンボリックリンク/ジャンクションの場合追跡せずfalseを返すため、
      // statSync（リンク先を追跡する）の結果を優先する。Application Data等のジャンクションが
      // ファイル扱いになり開けなくなる不具合を防ぐ。
      let isDir = e.isDirectory();
      try {
        const stat = fs.statSync(fullPath);
        isDir = stat.isDirectory();
        size = isDir ? null : stat.size;
        mtime = stat.mtimeMs;
      } catch (_) {
        // アクセス権がないジャンクション等。シンボリックリンクならフォルダとして扱う。
        if (e.isSymbolicLink()) isDir = true;
      }
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

// 外部ツール（サクラエディタ・TortoiseGitなど）の実行ファイルを選択
ipcMain.handle('pick-exe-path', async () => {
  const result = await dialog.showOpenDialog({
    title: '実行ファイルを選択',
    filters: [{ name: '実行ファイル', extensions: ['exe'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// 任意の外部exeをバックグラウンドで起動（右クリックメニューの「○○で開く」用）
ipcMain.handle('run-exe', async (_, exePath, args) => {
  try {
    spawn(exePath, args, { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

// フォルダ新規作成
ipcMain.handle('create-dir', async (_, dirPath) => {
  try {
    fs.mkdirSync(dirPath, { recursive: false });
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

// ファイル新規作成（既存の場合はエラー）
ipcMain.handle('create-file', async (_, filePath) => {
  try {
    fs.writeFileSync(filePath, '', { flag: 'wx' });
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

// TortoiseGitProc.exeをよくあるインストール先から探す
ipcMain.handle('find-tortoisegit', async () => {
  const candidates = [
    'C:\\Program Files\\TortoiseGit\\bin\\TortoiseGitProc.exe',
    'C:\\Program Files (x86)\\TortoiseGit\\bin\\TortoiseGitProc.exe',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
});
