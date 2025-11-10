const Fuse = require('fuse-native');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const fs = require('fs');

// === Конфигурация ===
const TELEGRAM_TOKEN = '7595878071:AAExDmqJ0a7mewi3kI7TS3WfUzMMxmN_w5A';
const CHAT_ID = '-5049606407'; // ID группы (должен начинаться с -100...)
const MOUNT_POINT = path.resolve('/tmp/fuse-map', 'mountpoint');

// Создаём папку монтирования
if (!fs.existsSync(MOUNT_POINT)) {
  fs.mkdirSync(MOUNT_POINT);
}

// === Telegram Bot ===
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

// === Внутренняя структура файловой системы ===
const fileTree = {
  '/': {
    type: 'dir',
    children: {},
    mtime: new Date(),
    atime: new Date(),
    ctime: new Date(),
  }
};

// Хранилище: путь → message_id в Telegram
const fileMessageMap = new Map(); // '/file.txt' → 12345

// === Утилиты ===
function getNode(fullPath) {
  const parts = fullPath.split('/').filter(p => p);
  let node = fileTree['/'];
  for (const part of parts) {
    if (!node.children[part]) return null;
    node = node.children[part];
  }
  return node;
}

function createNode(fullPath, type) {
  const parts = fullPath.split('/').filter(p => p);
  let node = fileTree['/'];
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!node.children[part]) {
      node.children[part] = {
        type: 'dir',
        children: {},
        mtime: new Date(),
        atime: new Date(),
        ctime: new Date(),
      };
    }
    node = node.children[part];
  }
  const name = parts[parts.length - 1];
  if (!node.children[name]) {
    node.children[name] = {
      type,
      content: type === 'file' ? Buffer.from('') : null,
      size: 0,
      mtime: new Date(),
      atime: new Date(),
      ctime: new Date(),
    };
  }
  return node.children[name];
}

// === FUSE Операции ===
const ops = {
  readdir: (path, cb) => {
    console.log('readdir:', path);
    const node = getNode(path);
    if (!node || node.type !== 'dir') return cb(Fuse.ENOENT);
    const entries = Object.keys(node.children);
    return cb(null, entries);
  },

  getattr: (path, cb) => {
    console.log('getattr:', path);
    if (path === '/') {
      return cb(null, {
        mtime: fileTree['/'].mtime,
        atime: fileTree['/'].atime,
        ctime: fileTree['/'].ctime,
        nlink: 1,
        size: 4096,
        mode: 16877, // drwxr-xr-x
        uid: process.getuid(),
        gid: process.getgid(),
      });
    }

    const node = getNode(path);
    if (!node) return cb(Fuse.ENOENT);

    const isDir = node.type === 'dir';
    const mode = isDir ? 16877 : 33188; // dir: drwxr-xr-x, file: -rw-r--r--
    const size = isDir ? 4096 : (node.size || 0);

    return cb(null, {
      mtime: node.mtime,
      atime: node.atime,
      ctime: node.ctime,
      nlink: 1,
      size,
      mode,
      uid: process.getuid(),
      gid: process.getgid(),
    });
  },

  open: (path, flags, cb) => {
    console.log('open:', path, flags);
    const node = getNode(path);
    if (!node && (flags & 0x0001)) { // O_CREAT
      createNode(path, 'file');
    } else if (!node) {
      return cb(Fuse.ENOENT);
    }
    return cb(0, 42); // file handle
  },

  release: (path, handle, cb) => {
    cb(0);
  },

  create: (path, mode, cb) => {
    console.log('create:', path);
    createNode(path, 'file');
    cb(0, 42);
  },

  unlink: (path, cb) => {
    console.log('unlink:', path);
    const parts = path.split('/').filter(p => p);
    const name = parts.pop();
    const parentPath = '/' + parts.join('/');
    const parent = getNode(parentPath);
    if (!parent || !parent.children[name]) return cb(Fuse.ENOENT);
    delete parent.children[name];

    // Удаляем из Telegram, если был загружен
    const msgId = fileMessageMap.get(path);
    if (msgId) {
      bot.deleteMessage(CHAT_ID, msgId).catch(() => {});
      fileMessageMap.delete(path);
    }

    cb(0);
  },

  mkdir: (path, mode, cb) => {
    console.log('mkdir:', path);
    createNode(path, 'dir');
    cb(0);
  },

  rmdir: (path, cb) => {
    console.log('rmdir:', path);
    const node = getNode(path);
    if (!node || node.type !== 'dir' || Object.keys(node.children).length > 0) {
      return cb(Fuse.ENOTEMPTY);
    }
    const parts = path.split('/').filter(p => p);
    const name = parts.pop();
    const parentPath = '/' + parts.join('/');
    const parent = getNode(parentPath);
    delete parent.children[name];
    cb(0);
  },

  read: async (path, handle, buf, len, offset, cb) => {
    console.log('read:', path, offset, len);
    const node = getNode(path);
    if (!node || node.type !== 'file') return cb(Fuse.ENOENT);

    // Если файл в Telegram — скачиваем
    if (!node.content || node.content.length === 0) {
      const msgId = fileMessageMap.get(path);
      if (msgId) {
        try {
          const file = await bot.getFile(msgId);
          const filePath = await bot.downloadFile(file.file_id, __dirname);
          node.content = fs.readFileSync(filePath);
          node.size = node.content.length;
          fs.unlinkSync(filePath);
        } catch (err) {
          console.error('Download failed:', err);
          return cb(0);
        }
      }
    }

    if (!node.content) return cb(0);

    const data = node.content.slice(offset, offset + len);
    data.copy(buf);
    cb(data.length);
  },

  write: async (path, handle, buf, len, offset, cb) => {
    console.log('write:', path, offset, len);
    let node = getNode(path);
    if (!node) {
      node = createNode(path, 'file');
    }

    const newData = Buffer.from(buf);
    if (offset === 0) {
      node.content = newData;
    } else {
      const old = node.content || Buffer.from([]);
      const combined = Buffer.alloc(offset + len);
      old.copy(combined);
      newData.copy(combined, offset);
      node.content = combined;
    }

    node.size = node.content.length;
    node.mtime = new Date();

    cb(len);
  },

  truncate: (path, size, cb) => {
    console.log('truncate:', path, size);
    const node = getNode(path);
    if (!node || node.type !== 'file') return cb(Fuse.ENOENT);
    if (size === 0) {
      node.content = Buffer.from('');
    } else if (node.content) {
      node.content = node.content.slice(0, size);
    }
    node.size = size;
    node.mtime = new Date();
    cb(0);
  },

  flush: async (path, handle, cb) => {
    console.log('flush:', path);
    const node = getNode(path);
    if (!node || node.type !== 'file' || !node.content) return cb(0);

    // Отправляем в Telegram
    try {
      const stream = require('stream');
      const bufferStream = new stream.PassThrough();
      bufferStream.end(node.content);

      const filename = path.split('/').pop() || 'file.bin';
      const message = await bot.sendDocument(CHAT_ID, bufferStream, {}, {
        filename,
        contentType: 'application/octet-stream'
      });

      fileMessageMap.set(path, message.message_id);
    } catch (err) {
      console.error('Upload failed:', err);
    }

    cb(0);
  },
};

// === Запуск FUSE ===
const fuse = new Fuse(MOUNT_POINT, ops, { debug: false, displayFolder: true });

fuse.mount(err => {
  if (err) throw err;
  console.log(`Файловая система смонтирована в ${MOUNT_POINT}`);
  console.log(`Данные сохраняются в Telegram группу: ${CHAT_ID}`);
});

// Обработка завершения
process.on('SIGINT', () => {
  fuse.unmount(err => {
    if (err) console.error('Ошибка размонтирования:', err);
    else console.log('Размонтировано.');
    process.exit();
  });
});