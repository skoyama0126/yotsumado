'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

if (process.platform !== 'win32') throw new Error('Windows is required to build the shell menu helper.');
const root = path.resolve(__dirname, '..');
const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const output = path.join(root, 'build', 'native', 'Yotsumado.ShellMenu.exe');
fs.mkdirSync(path.dirname(output), { recursive: true });
execFileSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/optimize+',
  '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll',
  `/out:${output}`, path.join(root, 'src', 'native', 'ShellMenu.cs')], { stdio: 'inherit', windowsHide: true });
console.log('Built Windows shell menu helper.');
