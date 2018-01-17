const electron = require('electron');
const express = require('express');

const app = electron.app;
const BrowserWindow = electron.BrowserWindow;

const path = require('path');
const url = require('url');

const HTTP_PORT = 3000;

let mainWindow;

function createWindow() {

  mainWindow = new BrowserWindow({width: 800, height: 600, show: false});

  mainWindow.loadURL(url.format({
    pathname: path.join(__dirname, 'renderer.html'),
    protocol: 'file:',
    slashes: true
  }));

  mainWindow.on('closed', function () {
    mainWindow = null
  });

}

app.on('ready', createWindow);

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit()
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow()
  }
});

const server = express();
server.use(express.static(path.join(__dirname,"."), {extensions:['html']}));
server.use(express.static(path.join(__dirname,"../build"), {extensions:['html']}));
server.listen(HTTP_PORT);
console.log(`Visit port ${HTTP_PORT} in your browser`);
