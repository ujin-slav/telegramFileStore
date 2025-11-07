const fuse = require('fuse-native');
const path = require('path');

// Хранилище: Map<path, data>
const storage = new Map();

// Инициализация корневой директории
storage.set('/', {
  type: 'directory',
  mode: 0o755,
  size: 4096,
  mtime: new Date(),
  children: new Set()
});

// Вспомогательная функция: получить запись по пути
function getEntry(p) {
  return storage.get(path.normalize(p));
}

// Создать директорию
function mkdir(p, mode = 0o755) {
  const parentPath = path.dirname(p);
  const name = path.basename(p);

  const parent = getEntry(parentPath);
  if (!parent || parent.type !== 'directory') return -fuse.ENOENT;

  const fullPath = path.normalize(p);
  if (storage.has(fullPath)) return -fuse.EEXIST;

  storage.set(fullPath, {
    type: 'directory',
    mode,
    size: 4096,
    mtime: new Date(),
    children: new Set()
  });

  parent.children.add(name);
  parent.mtime = new Date();
  return 0;
}

// Создать файл
function createFile(p, mode = 0o644) {
  const parentPath = path.dirname(p);
  const name = path.basename(p);

  const parent = getEntry(parentPath);
  if (!parent || parent.type !== 'directory') return -fuse.ENOENT;

  const fullPath = path.normalize(p);
  if (storage.has(fullPath)) return -fuse.EEXIST;

  storage.set(fullPath, {
    type: 'file',
    mode,
    size: 0,
    mtime: new Date(),
    ctime: new Date(),
    content: Buffer.alloc(0)
  });

  parent.children.add(name);
  parent.mtime = new Date();
  return 0;
}

// FUSE операции
const mountPath = '/tmp/fuse-map-fs'; // Путь для монтирования
const fuseOps = {
  readdir(p, cb) {
    console.log('readdir:', p);
    const entry = getEntry(p);
    if (!entry || entry.type !== 'directory') return cb(fuse.ENOENT);

    const list = ['.', '..', ...entry.children];
    cb(0, list);
  },

  getattr(p, cb) {
    console.log('getattr:', p);
    if (p === '/') {
      return cb(0, {
        mtime: new Date(),
        atime: new Date(),
        ctime: new Date(),
        nlink: 1,
        size: 4096,
        mode: 0o040755, // директория
        uid: process.getuid(),
        gid: process.getgid()
      });
    }

    const entry = getEntry(p);
    if (!entry) return cb(fuse.ENOENT);

    const stat = {
      mtime: entry.mtime,
      atime: entry.mtime,
      ctime: entry.ctime || entry.mtime,
      size: entry.size,
      mode: entry.type === 'directory' ? 0o040000 | entry.mode : 0o100000 | entry.mode,
      uid: process.getuid(),
      gid: process.getgid(),
      nlink: 1
    };

    cb(0, stat);
  },

  open(p, flags, cb) {
    console.log('open:', p, flags);
    const entry = getEntry(p);
    if (!entry) return cb(fuse.ENOENT);
    if (entry.type !== 'file') return cb(fuse.EISDIR);
    cb(0, 42); // file handle
  },

  release(p, fd, cb) {
    console.log('release:', p);
    cb(0);
  },

  read(p, fd, buf, len, offset, cb) {
    console.log('read:', p, offset, len);
    const entry = getEntry(p);
    if (!entry || entry.type !== 'file') return cb(fuse.ENOENT);

    const data = entry.content;
    if (offset >= data.length) return cb(0);

    const slice = data.slice(offset, offset + len);
    slice.copy(buf);
    cb(slice.length);
  },

  write(p, fd, buf, len, offset, cb) {
    console.log('write:', p, offset, len);
    const entry = getEntry(p);
    if (!entry || entry.type !== 'file') return cb(fuse.ENOENT);

    const newData = Buffer.alloc(Math.max(entry.content.length, offset + len));
    entry.content.copy(newData);
    buf.copy(newData, offset, 0, len);

    entry.content = newData;
    entry.size = newData.length;
    entry.mtime = new Date();

    cb(len);
  },

  truncate(p, size, cb) {
    console.log('truncate:', p, size);
    const entry = getEntry(p);
    if (!entry || entry.type !== 'file') return cb(fuse.ENOENT);

    if (size === 0) {
      entry.content = Buffer.alloc(0);
    } else if (size < entry.content.length) {
      entry.content = entry.content.slice(0, size);
    } else {
      const newBuf = Buffer.alloc(size);
      entry.content.copy(newBuf);
      newBuf.fill(0, entry.content.length);
      entry.content = newBuf;
    }

    entry.size = size;
    entry.mtime = new Date();
    cb(0);
  },

  create(p, mode, cb) {
    console.log('create:', p, mode);
    const result = createFile(p, mode);
    if (result === 0) {
      cb(0, 42); // file handle
    } else {
      cb(result);
    }
  },

  mkdir(p, mode, cb) {
    console.log('mkdir:', p, mode);
    const result = mkdir(p, mode);
    cb(result);
  },

  unlink(p, cb) {
    console.log('unlink:', p);
    const parentPath = path.dirname(p);
    const name = path.basename(p);

    const parent = getEntry(parentPath);
    if (!parent || parent.type !== 'directory') return cb(fuse.ENOENT);

    if (!storage.has(p)) return cb(fuse.ENOENT);

    storage.delete(p);
    parent.children.delete(name);
    parent.mtime = new Date();

    cb(0);
  },

  rmdir(p, cb) {
    console.log('rmdir:', p);
    const entry = getEntry(p);
    if (!entry || entry.type !== 'directory') return cb(fuse.ENOENT);
    if (entry.children.size > 0) return cb(fuse.ENOTEMPTY);

    const parentPath = path.dirname(p);
    const name = path.basename(p);
    const parent = getEntry(parentPath);
    if (parent) {
      parent.children.delete(name);
      parent.mtime = new Date();
    }

    storage.delete(p);
    cb(0);
  }
};

// Создать тестовые данные
mkdir('/hello');
createFile('/hello/world.txt');
const helloFile = getEntry('/hello/world.txt');
helloFile.content = Buffer.from('Привет из Map!\n');
helloFile.size = helloFile.content.length;

// Монтирование
console.log(`Монтирование в ${mountPath}...`);
fuse.mount(mountPath, fuseOps, (err) => {
  if (err) throw err;
  console.log('Файловая система смонтирована!');
  console.log('Нажмите Ctrl+C для размонтирования');
});

// Обработка завершения
process.on('SIGINT', () => {
  fuse.unmount(mountPath, (err) => {
    if (err) {
      console.error('Ошибка при размонтировании:', err);
    } else {
      console.log('Размонтировано.');
    }
    process.exit();
  });
});