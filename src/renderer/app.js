// ═══════════════════════════════════════════════════════
//  ヨツマド (Yotsumado) — renderer/app.js
//  Java20年の人向けコメント：各クラスの責務が明確になるよう設計
// ═══════════════════════════════════════════════════════

'use strict';

// ── 定数 ──────────────────────────────────────────────
const PANE_COUNT   = 4;
const IMAGE_EXTS   = new Set(['jpg','jpeg','png','gif','webp','bmp','svg']);
const TEXT_EXTS    = new Set(['txt','md','js','ts','json','html','css','xml','csv','log','ini','cfg','bat','sh','py','java','c','cpp','h']);
const SPECIAL_DIRS = { downloads: null, desktop: null };

// ── 状態 ──────────────────────────────────────────────
let specialPaths = {};
let quickAccess  = JSON.parse(localStorage.getItem('quickAccess') || '[]');
let activePaneId = 0;
let previewOpen  = false;
let toolPaths    = JSON.parse(localStorage.getItem('toolPaths') || '{}'); // 外部ツールのexeパス（サクラエディタ等）
let clipboardItem = null; // { path, cut }

/**
 * 1ペイン分の状態を管理
 * tabs: { id, path, label, locked, history, historyIdx, entries, sortCol, sortDir, selectedIdx }[]
 */
class Pane {
  constructor(id) {
    this.id      = id;
    this.tabs    = [];
    this.activeTabId = 0;
    this._nextTabId  = 0;
    this.addTab('C:\\');
  }

  addTab(path) {
    const tab = {
      id: this._nextTabId++,
      path,
      label: labelOf(path),
      locked: false,
      history: [path],
      historyIdx: 0,
      entries: [],
      sortCol: 'name',
      sortDir: 'asc',
      selectedIdx: -1,
    };
    this.tabs.push(tab);
    this.activeTabId = tab.id;
    return tab;
  }

  get activeTab() { return this.tabs.find(t => t.id === this.activeTabId); }

  closeTab(tabId) {
    const t = this.tabs.find(t => t.id === tabId);
    if (!t || t.locked) return false;
    const idx = this.tabs.indexOf(t);
    this.tabs.splice(idx, 1);
    if (this.tabs.length === 0) this.addTab('C:\\');
    else if (this.activeTabId === tabId) {
      const next = this.tabs[Math.min(idx, this.tabs.length - 1)];
      this.activeTabId = next.id;
    }
    return true;
  }

  closeUnlockedTabs() {
    this.tabs = this.tabs.filter(t => t.locked);
    if (this.tabs.length === 0) this.addTab('C:\\');
    this.activeTabId = this.tabs[0].id;
  }
}

// ── グローバル状態 ───────────────────────────────────
const panes = Array.from({ length: PANE_COUNT }, (_, i) => new Pane(i));

// ── タブ状態の保存・復元 ────────────────────────────
function savePaneState() {
  const state = {
    activePaneId,
    panes: panes.map(pane => ({
      activeTabIndex: pane.tabs.findIndex(t => t.id === pane.activeTabId),
      tabs: pane.tabs.map(t => ({ path: t.path, locked: t.locked })),
    })),
  };
  localStorage.setItem('paneState', JSON.stringify(state));
}

function restorePaneState() {
  const raw = localStorage.getItem('paneState');
  if (!raw) return;
  let saved;
  try { saved = JSON.parse(raw); } catch (_) { return; }
  if (!saved || !Array.isArray(saved.panes)) return;

  saved.panes.forEach((ps, i) => {
    const pane = panes[i];
    if (!pane || !Array.isArray(ps.tabs) || ps.tabs.length === 0) return;
    pane.tabs = [];
    pane._nextTabId = 0;
    ps.tabs.forEach(t => {
      const tab = pane.addTab(t.path);
      tab.locked = !!t.locked;
    });
    const idx = Math.min(ps.activeTabIndex ?? 0, pane.tabs.length - 1);
    pane.activeTabId = pane.tabs[Math.max(idx, 0)].id;
  });

  if (typeof saved.activePaneId === 'number') activePaneId = saved.activePaneId;
}

// ── 起動 ──────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  specialPaths = await window.api.getSpecialPaths();
  SPECIAL_DIRS.downloads = specialPaths.downloads;
  SPECIAL_DIRS.desktop   = specialPaths.desktop;

  applyTheme(localStorage.getItem('theme') || 'light');
  setupThemeSwitcher();
  restoreColumnWidths();
  restorePaneState();
  renderSidebar();
  renderAllPanes();
  setupPreviewToggle();
  setupContextMenu();
  document.addEventListener('click', closeCtxMenu);
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('beforeunload', savePaneState);

  // 各ペイン初期ロード
  for (const pane of panes) {
    await navigateTo(pane.id, pane.activeTab.path, false);
  }
});

// ── ユーティリティ ──────────────────────────────────
function labelOf(p) {
  if (!p) return '?';
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

// パスを階層ごとのブレッドクラム配列に変換: [{ label, fullPath }]
// 例: 'C:\\Users\\foo' → [{label:'C:\\', fullPath:'C:\\'}, {label:'Users', fullPath:'C:\\Users'}, {label:'foo', fullPath:'C:\\Users\\foo'}]
function buildBreadcrumb(p) {
  if (!p) return [{ label: '?', fullPath: p }];
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean);
  if (parts.length === 0) return [{ label: p, fullPath: p }];
  const segments = [{ label: `${parts[0]}\\`, fullPath: `${parts[0]}\\` }];
  let acc = `${parts[0]}\\`;
  for (let i = 1; i < parts.length; i++) {
    acc = acc.endsWith('\\') ? acc + parts[i] : `${acc}\\${parts[i]}`;
    segments.push({ label: parts[i], fullPath: acc });
  }
  return segments;
}

function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${Y}/${M}/${D} ${h}:${m}`;
}

function extOf(name) { return name.split('.').pop().toLowerCase(); }

function iconOf(entry) {
  if (entry.isDir) return '📁';
  const e = extOf(entry.name);
  if (IMAGE_EXTS.has(e)) return '🖼';
  if (TEXT_EXTS.has(e))  return '📄';
  if (['exe','msi'].includes(e)) return '⚙';
  if (['zip','7z','rar','tar','gz'].includes(e)) return '📦';
  if (['mp3','wav','flac','m4a'].includes(e)) return '🎵';
  if (['mp4','mov','avi','mkv'].includes(e)) return '🎬';
  if (['pdf'].includes(e)) return '📕';
  return '📃';
}

function sortEntries(entries, col, dir) {
  return [...entries].sort((a, b) => {
    // フォルダ優先
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    let va, vb;
    if (col === 'name')  { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
    else if (col === 'size')  { va = a.size ?? -1; vb = b.size ?? -1; }
    else if (col === 'mtime') { va = a.mtime ?? 0; vb = b.mtime ?? 0; }
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ?  1 : -1;
    return 0;
  });
}

// ── ナビゲーション ──────────────────────────────────
async function navigateTo(paneId, newPath, pushHistory = true) {
  const pane = panes[paneId];
  const tab  = pane.activeTab;

  if (newPath === '__TRASH__') {
    await window.api.openTrash();
    return;
  }

  tab.path = newPath;
  tab.label = labelOf(newPath);

  if (pushHistory) {
    tab.history = tab.history.slice(0, tab.historyIdx + 1);
    tab.history.push(newPath);
    tab.historyIdx = tab.history.length - 1;
  }

  const result = await window.api.readDir(newPath);
  if (result && result.error) {
    tab.entries = [];
    renderPane(paneId);
    return;
  }
  tab.entries = result || [];
  tab.selectedIdx = -1;
  autoFitUnlockedColumns();
  renderPane(paneId);
}

async function goBack(paneId) {
  const tab = panes[paneId].activeTab;
  if (tab.historyIdx <= 0) return;
  tab.historyIdx--;
  await navigateTo(paneId, tab.history[tab.historyIdx], false);
}

async function goForward(paneId) {
  const tab = panes[paneId].activeTab;
  if (tab.historyIdx >= tab.history.length - 1) return;
  tab.historyIdx++;
  await navigateTo(paneId, tab.history[tab.historyIdx], false);
}

async function refreshPane(paneId) {
  await navigateTo(paneId, panes[paneId].activeTab.path, false);
}

async function pasteInto(paneId, destDir) {
  if (!clipboardItem) return;
  const res = clipboardItem.cut
    ? await window.api.movePath(clipboardItem.path, destDir)
    : await window.api.copyPath(clipboardItem.path, destDir);
  if (res && res.error) {
    alert(`貼り付けに失敗しました: ${res.error}`);
  } else if (clipboardItem.cut) {
    clipboardItem = null;
  }
  await refreshPane(paneId);
}

async function deleteEntry(paneId, entry) {
  if (!confirm(`「${entry.name}」をゴミ箱に移動しますか？`)) return;
  const res = await window.api.deletePath(entry.fullPath);
  if (res && res.error) alert(`削除に失敗しました: ${res.error}`);
  await refreshPane(paneId);
}

// ── 外部ツール連携（サクラエディタ・TortoiseGitなど） ──
// 一度選んだexeパスはlocalStorageに記憶し、次回以降は聞かない
async function getToolPath(key, autoFind) {
  if (toolPaths[key]) return toolPaths[key];
  if (autoFind) {
    const found = await autoFind();
    if (found) {
      toolPaths[key] = found;
      localStorage.setItem('toolPaths', JSON.stringify(toolPaths));
      return found;
    }
  }
  const picked = await window.api.pickExePath();
  if (picked) {
    toolPaths[key] = picked;
    localStorage.setItem('toolPaths', JSON.stringify(toolPaths));
  }
  return picked;
}

async function openWithSakura(entry) {
  const exe = await getToolPath('sakura');
  if (!exe) return;
  const res = await window.api.runExe(exe, [entry.fullPath]);
  if (res && res.error) alert(`サクラエディタの起動に失敗しました: ${res.error}`);
}

async function runTortoiseGit(command, targetPath) {
  const exe = await getToolPath('tortoiseGitProc', () => window.api.findTortoiseGit());
  if (!exe) return;
  const res = await window.api.runExe(exe, [`/command:${command}`, `/path:${targetPath}`]);
  if (res && res.error) alert(`TortoiseGitの起動に失敗しました: ${res.error}`);
}

// Electronでは window.prompt() が使えないため、カスタムダイアログを使う
function showInputDialog(label, defaultValue) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('input-dialog-overlay');
    const field   = document.getElementById('input-dialog-field');
    const labelEl = document.getElementById('input-dialog-label');
    const btnOk   = document.getElementById('input-dialog-ok');
    const btnCcl  = document.getElementById('input-dialog-cancel');

    labelEl.textContent = label;
    field.value = defaultValue;
    overlay.style.display = 'flex';
    field.focus();
    field.select();

    function finish(value) {
      overlay.style.display = 'none';
      btnOk.removeEventListener('click', onOk);
      btnCcl.removeEventListener('click', onCancel);
      field.removeEventListener('keydown', onKey);
      resolve(value);
    }
    function onOk()     { finish(field.value.trim() || null); }
    function onCancel() { finish(null); }
    function onKey(e) {
      if (e.key === 'Enter')  { e.preventDefault(); finish(field.value.trim() || null); }
      if (e.key === 'Escape') { e.preventDefault(); finish(null); }
    }
    btnOk.addEventListener('click', onOk);
    btnCcl.addEventListener('click', onCancel);
    field.addEventListener('keydown', onKey);
  });
}

async function createNewFolder(paneId, currentPath) {
  const name = await showInputDialog('フォルダ名を入力してください', '新しいフォルダ');
  if (!name) return;
  const newPath = currentPath.replace(/[/\\]+$/, '') + '\\' + name;
  const res = await window.api.createDir(newPath);
  if (res && res.error) { alert(`フォルダ作成に失敗しました: ${res.error}`); return; }
  await navigateTo(paneId, currentPath, false);
}

async function createNewTextFile(paneId, currentPath) {
  const name = await showInputDialog('ファイル名を入力してください', '新しいテキスト.txt');
  if (!name) return;
  const newPath = currentPath.replace(/[/\\]+$/, '') + '\\' + name;
  const res = await window.api.createFile(newPath);
  if (res && res.error) { alert(`ファイル作成に失敗しました: ${res.error}`); return; }
  await navigateTo(paneId, currentPath, false);
}

// 空白部分の右クリックメニュー（何も選択していない状態）
async function showFileSystemMenu(event, paneId, tab, entry) {
  closeCtxMenu();
  // Alt+右クリックでは従来のヨツマド用メニューを表示する。
  const fallback = () => showCtxMenu(event.clientX, event.clientY,
    entry ? buildFileCtxMenuItems(paneId, tab, entry) : buildEmptyAreaCtxMenuItems(paneId, tab));
  if (event.altKey) { fallback(); return; }
  try {
    const result = await window.api.showShellMenu(entry ? entry.fullPath : tab.path, !entry);
    if (result.error) throw new Error(result.error);
    if (result.canceled) return;
    if (result.action === 'rename' && entry) {
      const name = await showInputDialog('新しい名前を入力してください', entry.name);
      if (name && name !== entry.name) {
        const renamed = await window.api.renamePath(entry.fullPath, name);
        if (renamed.error) alert(`名前の変更に失敗しました: ${renamed.error}`);
      }
    } else if (result.action === 'open' && entry) {
      await navigateTo(paneId, entry.fullPath);
    }
    await Promise.all(panes.map(pane => refreshPane(pane.id)));
  } catch (error) {
    alert(`Windowsメニューを表示できませんでした: ${error.message}\nヨツマド用メニューを表示します。`);
    fallback();
  }
}

function buildEmptyAreaCtxMenuItems(paneId, tab) {
  return [
    { label: '📌 貼り付け', disabled: !clipboardItem, action: () => pasteInto(paneId, tab.path) },
    { sep: true },
    { label: '📁 フォルダ新規作成', action: () => createNewFolder(paneId, tab.path) },
    { label: '📄 テキストファイル新規作成', action: () => createNewTextFile(paneId, tab.path) },
    { sep: true },
    { label: '🌳 Git コミット...', action: () => runTortoiseGit('commit', tab.path) },
    { label: '🌳 Git ログ', action: () => runTortoiseGit('log', tab.path) },
    { label: '🌳 Git 差分', action: () => runTortoiseGit('diff', tab.path) },
    { label: '🌳 Git Pull', action: () => runTortoiseGit('pull', tab.path) },
    { label: '🌳 Git Push', action: () => runTortoiseGit('push', tab.path) },
    { label: '🌳 Git 同期', action: () => runTortoiseGit('sync', tab.path) },
  ];
}

// ファイル行の右クリックメニュー項目（行そのもの／選択中アイテムへの空白部分右クリックの両方で使う）
function buildFileCtxMenuItems(paneId, tab, entry) {
  const isText = !entry.isDir && TEXT_EXTS.has(extOf(entry.name));
  const items = [];
  if (isText) {
    items.push({ label: '📝 サクラエディタで開く', action: () => openWithSakura(entry) });
    items.push({ sep: true });
  }
  items.push(
    { label: '📋 コピー', action: () => { clipboardItem = { path: entry.fullPath, cut: false }; } },
    { label: '✂ 切り取り', action: () => { clipboardItem = { path: entry.fullPath, cut: true }; } },
    { sep: true },
    { label: '📌 貼り付け', disabled: !clipboardItem, action: () => pasteInto(paneId, tab.path) },
    { sep: true },
    { label: '🗑 削除', action: () => deleteEntry(paneId, entry) },
    { sep: true },
    { label: '🌳 Git コミット...', action: () => runTortoiseGit('commit', entry.fullPath) },
    { label: '🌳 Git ログ', action: () => runTortoiseGit('log', entry.fullPath) },
    { label: '🌳 Git 差分', action: () => runTortoiseGit('diff', entry.fullPath) },
    { label: '🌳 Git Pull', action: () => runTortoiseGit('pull', entry.fullPath) },
    { label: '🌳 Git Push', action: () => runTortoiseGit('push', entry.fullPath) },
    { label: '🌳 Git 同期', action: () => runTortoiseGit('sync', entry.fullPath) },
  );
  return items;
}

async function goUp(paneId) {
  const tab = panes[paneId].activeTab;
  const parts = tab.path.replace(/[/\\]+$/, '').split(/[/\\]/);
  if (parts.length <= 1) return;
  parts.pop();
  const up = parts.join('\\') || tab.path[0] + ':\\';
  await navigateTo(paneId, up);
}

// ── サイドバー ──────────────────────────────────────
// ── テーマ切替 ──────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  document.querySelectorAll('.theme-swatch').forEach(el => {
    el.classList.toggle('active', el.dataset.themeValue === theme);
  });
}

function setupThemeSwitcher() {
  document.querySelectorAll('.theme-swatch').forEach(el => {
    el.addEventListener('click', () => applyTheme(el.dataset.themeValue));
  });
}

// ── 列幅の復元・ドラッグリサイズ ────────────────────
const COL_WIDTH_VARS = ['--col-size-w', '--col-mtime-w'];

function restoreColumnWidths() {
  COL_WIDTH_VARS.forEach(varName => {
    const saved = localStorage.getItem(`colWidth:${varName}`);
    if (saved) document.documentElement.style.setProperty(varName, `${saved}px`);
  });
}

function setColumnWidth(varName, px, persist = true) {
  document.documentElement.style.setProperty(varName, `${px}px`);
  if (persist) localStorage.setItem(`colWidth:${varName}`, px);
}

function hasCustomColumnWidth(varName) {
  return localStorage.getItem(`colWidth:${varName}`) !== null;
}

function startColumnResize(e, varName) {
  const startX = e.clientX;
  const startWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(varName)) || 90;
  const handle = e.target;
  handle.classList.add('resizing');

  function onMove(ev) {
    const newWidth = Math.max(50, startWidth + (ev.clientX - startX));
    document.documentElement.style.setProperty(varName, `${newWidth}px`);
  }
  function onUp() {
    handle.classList.remove('resizing');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    const finalWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(varName));
    setColumnWidth(varName, finalWidth);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// 列の内容に合わせて幅を自動調整（ヘッダーのリサイズハンドルをダブルクリック）
let _measureCtx = null;
function textWidth(text, font) {
  if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
  _measureCtx.font = font;
  return _measureCtx.measureText(text).width;
}

const COL_PADDING = 24; // 左右パディング16px + 余白

function measureColumnWidth(col, entriesList) {
  const headerFont = "600 11px 'Segoe UI', 'Yu Gothic UI', sans-serif";
  const bodyFont   = "11px Consolas, monospace";
  const headerLabel = col === 'size' ? 'サイズ' : '更新日時';

  let maxW = textWidth(headerLabel, headerFont);
  entriesList.forEach(entry => {
    const text = col === 'size'
      ? (entry.isDir ? '' : formatSize(entry.size))
      : formatDate(entry.mtime);
    const w = textWidth(text, bodyFont);
    if (w > maxW) maxW = w;
  });
  return Math.max(50, Math.ceil(maxW + COL_PADDING));
}

// 手動リサイズ時（ハンドルのダブルクリック）: 該当ペインの内容に合わせて幅を確定し、以後は自動調整しない
function autoFitColumn(paneId, col, varName) {
  const tab = panes[paneId].activeTab;
  setColumnWidth(varName, measureColumnWidth(col, tab.entries));
}

// ナビゲーション時の自動調整: ユーザーが手動調整していない列だけ、全ペインの表示内容に合わせて幅を更新
function autoFitUnlockedColumns() {
  [{ col: 'size', varName: '--col-size-w' }, { col: 'mtime', varName: '--col-mtime-w' }]
    .forEach(({ col, varName }) => {
      if (hasCustomColumnWidth(varName)) return;
      let maxW = 50;
      panes.forEach(pane => {
        const tab = pane.activeTab;
        if (tab) maxW = Math.max(maxW, measureColumnWidth(col, tab.entries));
      });
      setColumnWidth(varName, maxW, false);
    });
}

async function renderSidebar() {
  // ドライブ
  const drives = await window.api.getDrives();
  const driveList = document.getElementById('drive-list');
  driveList.innerHTML = '';
  for (const d of drives) {
    const li = document.createElement('li');
    li.textContent = `💾 ${d.label}`;
    li.addEventListener('click', () => navigateTo(activePaneId, d.path));
    driveList.appendChild(li);
  }

  // クイックアクセス
  renderQuickAccess();

  // 特殊
  document.querySelectorAll('#special-list li').forEach(li => {
    li.addEventListener('click', () => {
      const s = li.dataset.special;
      if (s === 'trash') navigateTo(activePaneId, '__TRASH__');
      else if (SPECIAL_DIRS[s]) navigateTo(activePaneId, SPECIAL_DIRS[s]);
    });
  });

  // クイック追加ボタン
  document.getElementById('quick-add-btn').addEventListener('click', () => {
    const tab = panes[activePaneId].activeTab;
    if (!quickAccess.includes(tab.path)) {
      quickAccess.push(tab.path);
      localStorage.setItem('quickAccess', JSON.stringify(quickAccess));
      renderQuickAccess();
    }
  });
}

function renderQuickAccess() {
  const ul = document.getElementById('quick-list');
  ul.innerHTML = '';
  quickAccess.forEach((p, idx) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.className = 'file-name-text';
    span.textContent = `⭐ ${labelOf(p)}`;
    span.title = p;
    const rm = document.createElement('span');
    rm.className = 'remove-quick';
    rm.textContent = '✕';
    rm.addEventListener('click', (e) => {
      e.stopPropagation();
      quickAccess.splice(idx, 1);
      localStorage.setItem('quickAccess', JSON.stringify(quickAccess));
      renderQuickAccess();
    });
    li.appendChild(span);
    li.appendChild(rm);
    li.addEventListener('click', () => navigateTo(activePaneId, p));
    ul.appendChild(li);
  });
}

// ── 全ペイン描画 ─────────────────────────────────────
function renderAllPanes() {
  for (let i = 0; i < PANE_COUNT; i++) renderPane(i);
}

// ── 1ペイン描画 ──────────────────────────────────────
function renderPane(paneId) {
  const pane    = panes[paneId];
  const el      = document.getElementById(`pane-${paneId}`);
  const tab     = pane.activeTab;
  const focused = paneId === activePaneId;
  el.className  = `pane${focused ? ' focused' : ''}`;
  el.innerHTML  = '';

  // ─ タブバー ─
  const tabBar = document.createElement('div');
  tabBar.className = 'tab-bar';

  pane.tabs.forEach(t => {
    const tabEl = document.createElement('div');
    tabEl.className = `tab${t.id === pane.activeTabId ? ' active' : ''}`;
    tabEl.title = t.path;

    const labelEl = document.createElement('span');
    labelEl.className = 'tab-label';
    labelEl.textContent = t.label;

    tabEl.appendChild(labelEl);

    if (t.locked) {
      const lockEl = document.createElement('span');
      lockEl.className = 'tab-lock';
      lockEl.textContent = '🔒';
      tabEl.appendChild(lockEl);
    }

    // タブクリック → アクティブ切替
    tabEl.addEventListener('click', async (e) => {
      e.stopPropagation();
      pane.activeTabId = t.id;
      setActivePane(paneId);
      renderPane(paneId);
      if (t.entries.length === 0) await navigateTo(paneId, t.path);
    });

    // タブ右クリックメニュー
    tabEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showTabCtxMenu(e, paneId, t.id);
    });

    tabBar.appendChild(tabEl);
  });

  // ＋ボタン
  const addBtn = document.createElement('div');
  addBtn.className = 'tab-add';
  addBtn.textContent = '+';
  addBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    setActivePane(paneId);
    const t = pane.addTab(pane.activeTab.path);
    await navigateTo(paneId, t.path);
  });
  tabBar.appendChild(addBtn);

  // ロック以外削除ボタン
  const delBtn = document.createElement('div');
  delBtn.className = 'tab-actions';
  const delUnlocked = document.createElement('div');
  delUnlocked.className = 'tab-del-unlocked';
  delUnlocked.textContent = '🗂 ロック以外削除';
  delUnlocked.title = 'ロックされていないタブを全て閉じる';
  delUnlocked.addEventListener('click', async (e) => {
    e.stopPropagation();
    pane.closeUnlockedTabs();
    renderPane(paneId);
    await navigateTo(paneId, pane.activeTab.path);
  });
  delBtn.appendChild(delUnlocked);
  tabBar.appendChild(delBtn);

  el.appendChild(tabBar);

  // ─ アドレスバー ─
  const addr = document.createElement('div');
  addr.className = 'addr-bar';

  const btnBack    = makeBtn('◀', () => goBack(paneId));
  const btnFwd     = makeBtn('▶', () => goForward(paneId));
  const btnUp      = makeBtn('↑', () => goUp(paneId));
  const btnRefresh   = makeBtn('⟳', () => refreshPane(paneId));
  const btnNewFolder = makeBtn('＋', () => createNewFolder(paneId, tab.path));
  btnBack.disabled = tab.historyIdx <= 0;
  btnFwd.disabled  = tab.historyIdx >= tab.history.length - 1;
  btnRefresh.title   = '更新';
  btnNewFolder.title = 'フォルダ新規作成';

  const input = document.createElement('input');
  input.className = 'addr-input';
  input.type = 'text';
  input.style.display = 'none';
  input.value = tab.path;
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await navigateTo(paneId, input.value.trim());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      renderPane(paneId);
    }
  });
  input.addEventListener('blur', () => renderPane(paneId));

  // パスのブレッドクラム表示。クリックでその階層へ移動、背面クリックで手入力モードへ
  const breadcrumb = document.createElement('div');
  breadcrumb.className = 'addr-breadcrumb';
  buildBreadcrumb(tab.path).forEach((seg, i, arr) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'addr-sep';
      sep.textContent = '›';
      breadcrumb.appendChild(sep);
    }
    const span = document.createElement('span');
    span.className = 'addr-segment';
    span.textContent = seg.label;
    span.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (i !== arr.length - 1) await navigateTo(paneId, seg.fullPath);
    });
    breadcrumb.appendChild(span);
  });
  breadcrumb.addEventListener('click', () => {
    breadcrumb.style.display = 'none';
    input.style.display = '';
    input.focus();
    input.select();
  });

  addr.appendChild(btnBack);
  addr.appendChild(btnFwd);
  addr.appendChild(btnUp);
  addr.appendChild(btnRefresh);
  addr.appendChild(btnNewFolder);
  addr.appendChild(breadcrumb);
  addr.appendChild(input);
  el.appendChild(addr);

  // ─ ファイルリスト ─
  const wrap = document.createElement('div');
  wrap.className = 'file-list-wrap';

  const sorted = sortEntries(tab.entries, tab.sortCol, tab.sortDir);

  const table = document.createElement('table');
  table.className = 'file-table';

  // thead
  const thead = document.createElement('thead');
  const hrow  = document.createElement('tr');
  [
    { col: 'name', label: 'ファイル名' },
    { col: 'size',  label: 'サイズ', resizeVar: '--col-size-w' },
    { col: 'mtime', label: '更新日時', resizeVar: '--col-mtime-w' },
  ].forEach(({ col, label, resizeVar }) => {
    const th = document.createElement('th');
    if (resizeVar) th.classList.add(`col-${col}`); // 本文セルと同じ幅クラスをヘッダーにも適用
    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    th.appendChild(labelSpan);
    if (tab.sortCol === col) th.classList.add(`sort-${tab.sortDir}`);
    th.addEventListener('click', () => {
      if (tab.sortCol === col) tab.sortDir = tab.sortDir === 'asc' ? 'desc' : 'asc';
      else { tab.sortCol = col; tab.sortDir = 'asc'; }
      renderPane(paneId);
    });
    if (resizeVar) {
      th.classList.add('resizable');
      const handle = document.createElement('span');
      handle.className = 'col-resize-handle';
      handle.title = 'ドラッグで幅調整／ダブルクリックで自動調整';
      handle.addEventListener('click', (e) => e.stopPropagation());
      handle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        startColumnResize(e, resizeVar);
      });
      handle.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        autoFitColumn(paneId, col, resizeVar);
      });
      th.appendChild(handle);
    }
    hrow.appendChild(th);
  });
  thead.appendChild(hrow);
  table.appendChild(thead);

  // tbody
  const tbody = document.createElement('tbody');
  sorted.forEach((entry, idx) => {
    const tr = document.createElement('tr');
    if (tab.selectedIdx === idx) tr.classList.add('selected');

    // 名前セル
    const tdName = document.createElement('td');
    tdName.className = 'col-name';
    const icon = document.createElement('span');
    icon.className = 'file-icon';
    icon.textContent = iconOf(entry);
    const name = document.createElement('span');
    name.className = 'file-name-text';
    name.textContent = entry.name;
    tdName.appendChild(icon);
    tdName.appendChild(name);

    // サイズ
    const tdSize = document.createElement('td');
    tdSize.className = 'col-size';
    tdSize.textContent = entry.isDir ? '' : formatSize(entry.size);

    // 更新日時
    const tdMtime = document.createElement('td');
    tdMtime.className = 'col-mtime';
    tdMtime.textContent = formatDate(entry.mtime);

    tr.appendChild(tdName);
    tr.appendChild(tdSize);
    tr.appendChild(tdMtime);

    // クリック
    tr.addEventListener('click', async (e) => {
      e.stopPropagation();
      setActivePane(paneId);
      tab.selectedIdx = idx;
      renderPane(paneId);
      await showPreview(entry);
    });

    // ダブルクリック
    tr.addEventListener('dblclick', async (e) => {
      e.stopPropagation();
      if (entry.isDir) await navigateTo(paneId, entry.fullPath);
      else await window.api.openFile(entry.fullPath);
    });

    // 右クリックメニュー（コピー・切り取り・貼り付け・削除・外部ツール）
    tr.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setActivePane(paneId);
      tab.selectedIdx = idx;
      renderPane(paneId);
      showFileSystemMenu(e, paneId, tab, entry);
    });

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  if (sorted.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'フォルダが空です';
    wrap.appendChild(empty);
  } else {
    wrap.appendChild(table);
  }

  // 空白部分の右クリック → 常に空白エリアメニュー（新規作成・貼り付け・TortoiseGit）
  wrap.addEventListener('contextmenu', (e) => {
    if (e.target.closest('tr')) return; // 行はtr側のハンドラに任せる
    e.preventDefault();
    e.stopPropagation();
    setActivePane(paneId);
    showFileSystemMenu(e, paneId, tab, null);
  });

  el.appendChild(wrap);

  // クリックでアクティブ化
  el.addEventListener('click', () => setActivePane(paneId));

  savePaneState();
}

function makeBtn(label, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

function setActivePane(paneId) {
  activePaneId = paneId;
  for (let i = 0; i < PANE_COUNT; i++) {
    const el = document.getElementById(`pane-${i}`);
    if (el) {
      if (i === paneId) el.classList.add('focused');
      else el.classList.remove('focused');
    }
  }
}

// ── タブ右クリックメニュー ──────────────────────────
function showTabCtxMenu(e, paneId, tabId) {
  const pane = panes[paneId];
  const tab  = pane.tabs.find(t => t.id === tabId);
  if (!tab) return;

  showCtxMenu(e.clientX, e.clientY, [
    {
      label: tab.locked ? '🔓 ロック解除' : '🔒 ロック',
      action: () => {
        tab.locked = !tab.locked;
        renderPane(paneId);
      }
    },
    { sep: true },
    {
      label: '✕ このタブを閉じる',
      disabled: tab.locked,
      action: () => {
        if (!tab.locked) {
          pane.closeTab(tabId);
          renderPane(paneId);
        }
      }
    },
    {
      label: '🗂 ロック以外を全て閉じる',
      action: () => {
        pane.closeUnlockedTabs();
        renderPane(paneId);
      }
    },
    { sep: true },
    {
      label: '➕ 新しいタブ',
      action: async () => {
        pane.addTab(tab.path);
        await navigateTo(paneId, pane.activeTab.path);
      }
    },
  ]);
}

// ── 汎用コンテキストメニュー ────────────────────────
let ctxMenuEl = null;

function setupContextMenu() {
  ctxMenuEl = document.createElement('div');
  ctxMenuEl.id = 'ctx-menu';
  ctxMenuEl.style.display = 'none';
  document.body.appendChild(ctxMenuEl);
}

function showCtxMenu(x, y, items) {
  ctxMenuEl.innerHTML = '';
  items.forEach(item => {
    if (item.sep) {
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      ctxMenuEl.appendChild(sep);
    } else {
      const el = document.createElement('div');
      el.className = 'ctx-item';
      el.textContent = item.label;
      if (item.disabled) {
        el.style.opacity = '0.4';
        el.style.cursor = 'default';
      } else {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          closeCtxMenu();
          item.action();
        });
      }
      ctxMenuEl.appendChild(el);
    }
  });

  ctxMenuEl.style.display = 'block';
  ctxMenuEl.style.left = `${Math.min(x, window.innerWidth - 180)}px`;
  ctxMenuEl.style.top  = `${Math.min(y, window.innerHeight - ctxMenuEl.offsetHeight - 10)}px`;
}

function closeCtxMenu() {
  if (ctxMenuEl) ctxMenuEl.style.display = 'none';
}

// ── プレビュー ───────────────────────────────────────
async function showPreview(entry) {
  // 閉じているときは開かない。内容だけ裏で更新する
  const titleEl   = document.getElementById('preview-title');
  const contentEl = document.getElementById('preview-content');
  titleEl.textContent = entry.name;
  contentEl.innerHTML = '';

  if (entry.isDir) {
    contentEl.innerHTML = '<div class="preview-nopreview">📁 フォルダ</div>';
    return;
  }

  const ext = extOf(entry.name);

  if (IMAGE_EXTS.has(ext)) {
    const data = await window.api.readImage(entry.fullPath);
    if (typeof data === 'string' && data.startsWith('data:')) {
      const img = document.createElement('img');
      img.src = data;
      contentEl.appendChild(img);
    } else {
      contentEl.innerHTML = '<div class="preview-nopreview">読み込み失敗</div>';
    }
  } else if (TEXT_EXTS.has(ext)) {
    const text = await window.api.readText(entry.fullPath);
    if (typeof text === 'string') {
      const pre = document.createElement('pre');
      pre.textContent = text.length > 50000 ? text.slice(0, 50000) + '\n...(省略)' : text;
      contentEl.appendChild(pre);
    } else {
      contentEl.innerHTML = '<div class="preview-nopreview">読み込み失敗</div>';
    }
  } else {
    contentEl.innerHTML = `<div class="preview-nopreview">プレビュー非対応<br>.${ext}</div>`;
  }
}

function setupPreviewToggle() {
  document.getElementById('preview-close').addEventListener('click', () => togglePreview());
  document.getElementById('preview-toggle-btn').addEventListener('click', () => togglePreview());
}

function togglePreview() {
  previewOpen = !previewOpen;
  const panel   = document.getElementById('preview-panel');
  const toggleBtn = document.getElementById('preview-toggle-btn');
  if (previewOpen) {
    panel.classList.remove('hidden');
    toggleBtn.classList.remove('visible');
  } else {
    panel.classList.add('hidden');
    toggleBtn.classList.add('visible');
  }
}

// ── キーボードショートカット ──────────────────────
function onKeyDown(e) {
  const pane = panes[activePaneId];
  const tab  = pane?.activeTab;

  // Alt+左右 = 戻る/進む
  if (e.altKey && e.key === 'ArrowLeft')  { e.preventDefault(); goBack(activePaneId); return; }
  if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goForward(activePaneId); return; }
  if (e.altKey && e.key === 'ArrowUp')    { e.preventDefault(); goUp(activePaneId); return; }

  // Ctrl+T = 新タブ
  if (e.ctrlKey && e.key === 't') {
    e.preventDefault();
    const t = pane.addTab(tab.path);
    navigateTo(activePaneId, t.path);
    return;
  }

  // Ctrl+W = タブ閉じる
  if (e.ctrlKey && e.key === 'w') {
    e.preventDefault();
    if (!tab.locked) {
      pane.closeTab(tab.id);
      renderPane(activePaneId);
    }
    return;
  }

  // Ctrl+P = プレビュー開閉
  if (e.ctrlKey && e.key === 'p') {
    e.preventDefault();
    togglePreview();
    return;
  }

  // 数字キー1〜4 = ペイン切替
  if (!e.ctrlKey && !e.altKey && ['1','2','3','4'].includes(e.key)) {
    const idx = parseInt(e.key) - 1;
    setActivePane(idx);
    return;
  }
}
