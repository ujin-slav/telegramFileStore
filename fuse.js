const fuse = require('fuse-bindings');
const { Buffer } = require('node:buffer');

// Хранилище: Map с путями как ключами
const storage = new Map();

/**
 * Инициализация корневой директории
 */
function initRoot() {
  // Корневая директория
  storage.set('/', {
    type: 'dir',
    ino: 1,
    size: 4096,
    mtime: new Date(),
    atime: new Date(),
    ctime: new Date(),
    children: new Set(['hello.txt', 'subdir']),
  });

  // Файл hello.txt
  storage.set('/hello.txt', {
    type: 'file',
    ino: 2,
    size: 13,
    mtime: new Date(),
    atime: new Date(),
    ctime: new Date(),
    content: Buffer.from('Hello, World!'),
  });

  // Поддиректория
  storage.set('/subdir', {
    type: 'dir',
    ino: 3,
    size: 4096,
    mtime: new Date(),
    atime: new Date(),
    ctime: new Date(),
    children: new Set(['nested.txt']),
  });

  storage.set('/subdir/nested.txt', {
    type: 'file',
    ino: 4,
    size: 6,
    mtime: new Date(),
    atime: new Date(),
    ctime: new Date(),
    content: Buffer.from('Nested'),
  });
}

// Утилита: нормализация пути
function normalize(path) {
  return path.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

// Утилита: получение родителя
function getParent(path) {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/') || '/';
}

const ops = {
  readdir(path, cb) {
    path = normalize(path);
    console.log('readdir', path);

    const entry = storage.get(path);
    if (!entry || entry.type !== 'dir') {
      return cb(fuse.ENOENT);
    }

    cb(0, Array.from(entry.children));
  },

  getattr(path, cb) {
    path = normalize(path);
    console.log('getattr', path);

    const entry = storage.get(path);
    if (!entry) {
      return cb(fuse.ENOENT);
    }

    const now = new Date();
    const stat = {
      ino: entry.ino,
      size: entry.size,
      mode: entry.type === 'dir' ? 16877 : 33188, // dir: 040755, file: 100644
      atime: entry.atime,
      mtime: entry.mtime,
      ctime: entry.ctime,
      nlink: 1,
      uid: process.getuid ? process.getuid() : 0,
      gid: process.getgid ? process.getgid() : 0,
    };

    cb(0, stat);
  },

  open(path, flags, cb) {
    path = normalize(path);
    console.log('open', path, flags);

    const entry = storage.get(path);
    if (!entry || entry.type !== 'file') {
      return cb(fuse.ENOENT);
    }

    cb(0, 42); // file handle
  },

  read(path, handle, buf, len, offset, cb) {
    path = normalize(path);
    console.log('read', path, offset, len);

    const entry = storage.get(path);
    if (!entry || entry.type !== 'file') {
      return cb(fuse.ENOENT);
    }

    const data = entry.content;
    if (offset >= data.length) {
      return cb(0);
    }

    const slice = data.slice(offset, offset + len);
    slice.copy(buf);
    cb(slice.length);
  },

  // Опционально: поддержка записи
  write(path, handle, buf, len, offset, cb) {
    path = normalize(path);
    console.log('write', path, offset, len);

    let entry = storage.get(path);
    if (!entry || entry.type !== 'file') {
      return cb(fuse.ENOENT);
    }

    const newData = Buffer.alloc(Math.max(entry.content.length, offset + len));
    entry.content.copy(newData);
    buf.copy(newData, offset, 0, len);

    entry.content = newData;
    entry.size = newData.length;
    entry.mtime = new Date();

    storage.set(path, entry);
    cb(len);
  },

  create(path, mode, cb) {
    path = normalize(path);
    console.log('create', path);

    if (storage.has(path)) {
      return cb(fuse.EEXIST);
    }

    const parentPath = getParent(path);
    const parent = storage.get(parentPath);
    if (!parent || parent.type !== 'dir') {
      return cb(fuse.ENOENT);
    }

    const filename = path.split('/').pop();
    const ino = storage.size + 1;

    storage.set(path, {
      type: 'file',
      ino,
      size: 0,
      mtime: new Date(),
      atime: new Date(),
      ctime: new Date(),
      content: Buffer.alloc(0),
    });

    parent.children.add(filename);
    storage.set(parentPath, parent);

    cb(0, 42); // handle
  },

  mkdir(path, mode, cb) {
    path = normalize(path);
    console.log('mkdir', path);

    if (storage.has(path)) {
      return cb(fuse.EEXIST);
    }

    const parentPath = getParent(path);
    const parent = storage.get(parentPath);
    if (!parent || parent.type !== 'dir') {
      return cb(fuse.ENOENT);
    }

    const dirname = path.split('/').pop();
    const ino = storage.size + 1;

    storage.set(path, {
      type: 'dir',
      ino,
      size: 4096,
      mtime: new Date(),
      atime: new Date(),
      ctime: new Date(),
      children: new Set(),
    });

    parent.children.add(dirname);
    storage.set(parentPath, parent);

    cb(0);
  },

  // Поддержка удаления (опционально)
  unlink(path, cb) {
    path = normalize(path);
    console.log('unlink', path);

    const entry = storage.get(path);
    if (!entry || entry.type !== 'file') {
      return cb(fuse.ENOENT);
    }

    const parentPath = getParent(path);
    const parent = storage.get(parentPath);
    const filename = path.split('/').pop();
    parent.children.delete(filename);

    storage.delete(path);
    cb(0);
  },

  rmdir(path, cb) {
    path = normalize(path);
    console.log('rmdir', path);

    const entry = storage.get(path);
    if (!entry || entry.type !== 'dir' || entry.children.size > 0) {
      return cb(entry.children.size > 0 ? fuse.ENOTEMPTY : fuse.ENOENT);
    }

    const parentPath = getParent(path);
    const parent = storage.get(parentPath);
    const dirname = path.split('/').pop();
    parent.children.delete(dirname);

    storage.delete(path);
    cb(0);
  },
};

// Инициализация
initRoot();

// Монтирование
const mountPath = process.argv[2] || '/tmp/fuse-map-fs';

fuse.mount(mountPath, ops, (err) => {
  if (err) throw err;
  console.log(`Файловая система смонтирована на ${mountPath}`);
  console.log(`Содержимое:`);
  console.log('  /hello.txt');
  console.log('  /subdir/nested.txt');
});

// Отмонтирование при завершении
process.on('SIGINT', () => {
  fuse.unmount(mountPath, (err) => {
    if (err) console.error('Ошибка отмонтирования:', err);
    else console.log('Отмонтировано');
    process.exit();
  });
});