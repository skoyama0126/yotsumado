// Run: node_modules/electron/dist/electron.exe tests/electron-smoke.js
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yotsumado-ui-'));
app.setPath('userData', root);
const calls = [];
let fileClipboard = { paths: [], cut: false };
ipcMain.handle('write-file-clipboard', (_, file, cut) => { fileClipboard = { paths: [file], cut }; return { ok: true }; });
ipcMain.handle('read-file-clipboard', () => fileClipboard);
const entries = Array.from({ length: 110 }, (_, i) => ({
  name: `folder-${String(i).padStart(3, '0')}`, fullPath: `C:\\folder-${String(i).padStart(3, '0')}`,
  isDir: true, size: null, mtime: 0,
}));
entries.push({ name: 'sample.txt', fullPath: 'C:\\sample.txt', isDir: false, size: 12, mtime: 0 });
entries[0].name += '-長いファイル名'.repeat(45);
ipcMain.handle('get-special-paths', () => ({}));
ipcMain.handle('get-drives', () => []);
ipcMain.handle('read-dir', () => entries);
ipcMain.handle('read-text', () => 'preview works');
ipcMain.handle('read-image', async () => {
  await new Promise(resolve => setTimeout(resolve, 200));
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
});
for (const channel of ['copy-path', 'move-path', 'rename-path']) {
  ipcMain.handle(channel, (_, ...args) => { calls.push([channel, ...args]); return { ok: true }; });
}
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1400, height: 900,
    webPreferences: { preload: path.resolve(__dirname, '../src/main/preload.js'), contextIsolation: true, nodeIntegration: false } });
  try {
    win.webContents.on('console-message', (_, level, message) => { if (level >= 2) console.error(message); });
    await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'));
    const result = await win.webContents.executeJavaScript(`(async () => {
      const check = (value, message) => { if (!value) throw Error(message); };
      const wait = () => new Promise(resolve => setTimeout(resolve, 100));
      await wait();
      let wrap = document.querySelector('#pane-0 .file-list-wrap');
      wrap.scrollTop = 2300;
      wrap.dispatchEvent(new Event('scroll'));
      const row = wrap.querySelectorAll('tbody tr')[95];
      row.click();
      check(row.isConnected, 'selection replaced the row');
      check(wrap.scrollTop === 2300, 'selection reset scrolling');
      row.click();
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await wait();
      check(panes[0].activeTab.path === 'C:\\\\folder-095', 'double click did not open folder');
      await navigateTo(0, 'C:\\\\');
      wrap = document.querySelector('#pane-0 .file-list-wrap');
      wrap.scrollTop = 2300;
      wrap.dispatchEvent(new Event('scroll'));
      renderPane(0);
      check(document.querySelector('#pane-0 .file-list-wrap').scrollTop === 2300, 'rerender reset scrolling');
      const textRow = document.querySelectorAll('#pane-0 tbody tr')[110];
      textRow.click();
      await wait();
      check(document.querySelector('#preview-content').textContent === 'preview works', 'text preview missing');
      const sidebar = document.querySelector('#sidebar').getBoundingClientRect();
      const preview = document.querySelector('#preview-panel').getBoundingClientRect();
      check(preview.left >= sidebar.left && preview.right <= sidebar.right && Math.abs(preview.bottom - sidebar.bottom) < 2, 'preview is not at sidebar bottom');
      document.dispatchEvent(new KeyboardEvent('keydown', {key:'F2',bubbles:true}));
      const field = document.querySelector('#input-dialog-field');
      check(field.value === 'sample.txt', 'rename does not include extension');
      field.value = 'renamed.md';
      document.querySelector('#input-dialog-ok').click();
      await wait();
      document.querySelectorAll('#pane-0 tbody tr')[110].click();
      document.dispatchEvent(new KeyboardEvent('keydown', {key:'c',ctrlKey:true,bubbles:true}));
      setActivePane(1);
      document.dispatchEvent(new KeyboardEvent('keydown', {key:'v',ctrlKey:true,bubbles:true}));
      await wait();
      const drag = new DataTransfer();
      document.querySelectorAll('#pane-0 tbody tr')[110].dispatchEvent(new DragEvent('dragstart', {dataTransfer:drag,bubbles:true}));
      document.querySelector('#pane-2 .file-list-wrap').dispatchEvent(new DragEvent('drop', {dataTransfer:drag,bubbles:true,cancelable:true}));
      await wait();
      document.querySelectorAll('#pane-0 tbody tr')[110].dispatchEvent(new DragEvent('dragstart', {dataTransfer:drag,bubbles:true}));
      document.querySelector('#pane-3 .file-list-wrap').dispatchEvent(new DragEvent('drop', {dataTransfer:drag,bubbles:true,cancelable:true,shiftKey:true}));
      await wait();
      const panel = document.querySelector('#preview-panel');
      const title = document.querySelector('#preview-title');
      const previousTop = panel.getBoundingClientRect().top;
      const previousTitle = title.textContent;
      const previousContent = document.querySelector('#preview-content').innerHTML;
      const loading = showPreview({name:'pixel.png',fullPath:'C:\\\\pixel.png',isDir:false});
      await wait();
      check(panel.getBoundingClientRect().top === previousTop && title.textContent === previousTitle && document.querySelector('#preview-content').innerHTML === previousContent, 'preview flashed during image loading');
      await loading;
      await wait();
      check(document.querySelector('#preview-content img').naturalWidth === 1, 'image preview blocked');
      check(title.textContent === 'pixel.png', 'image and title did not update together');
      check(Math.abs(panel.getBoundingClientRect().bottom - sidebar.bottom) < 2, 'image preview is not bottom anchored');
      return 'scroll, double click, sidebar preview, rename, keyboard copy, drag copy/move, image preview';
    })()`);
    if (calls.filter(c => c[0] === 'copy-path').length !== 2 || calls.filter(c => c[0] === 'move-path').length !== 1 ||
        !calls.some(c => c[0] === 'rename-path' && c[2] === 'renamed.md')) throw Error('Incorrect IPC calls: ' + JSON.stringify(calls));
    win.setSize(900, 900);
    await new Promise(resolve => setTimeout(resolve, 150));
    await win.webContents.executeJavaScript(`(() => {
      const check = (v, m) => { if (!v) throw Error(m); };
      for (const pane of document.querySelectorAll('.pane')) {
        const table = pane.querySelector('.file-table');
        const bounds = pane.querySelector('.file-list-wrap').getBoundingClientRect();
        check(table.getBoundingClientRect().right <= bounds.right + 1, 'long name expanded table');
        const cells = table.querySelectorAll('tbody tr:first-child td');
        check(cells[2].getBoundingClientRect().right <= bounds.right + 1, 'date column is outside pane');
        const name = cells[0].querySelector('.file-name-text');
        check(name.scrollWidth > name.clientWidth && getComputedStyle(name).textOverflow === 'ellipsis', 'long name is not truncated');
        check(name.title.includes('長いファイル名'), 'full filename tooltip missing');
      }
      const handle = document.querySelector('#pane-0 th .col-resize-handle');
      const before = document.querySelector('#pane-0 td.col-name').getBoundingClientRect().width;
      handle.dispatchEvent(new MouseEvent('mousedown', {clientX:100,bubbles:true}));
      document.dispatchEvent(new MouseEvent('mousemove', {clientX:75,bubbles:true}));
      document.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}));
      check(document.querySelector('#pane-0 td.col-name').getBoundingClientRect().width < before, 'name divider did not resize');
    })()`);
    console.log('PASS: long filename truncation and column resizing at 900px window width');
    const image = await win.webContents.capturePage();
    fs.mkdirSync(path.resolve(__dirname, '../dist'), { recursive: true });
    fs.writeFileSync(path.resolve(__dirname, '../dist/ui-smoke.png'), image.toPNG());
    console.log('PASS: ' + result);
    win.destroy();
    app.exit(0);
  } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});
