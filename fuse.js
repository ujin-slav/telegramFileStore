const fuse = require('fuse-native');
const path = require('path');

// Внутренняя структура: Map с путями → данные
const storage = new Map();

// Инициализация корневой директории
storage.set('/', {
  type: 'directory',
  mode: 0o40755, // drwxr-xr-x
  size: 4096,
  mtime: new Date(),
  atime: new Date(),
  ctime: new Date(),
  children: new Set(['hello.txt', 'subdir'])
});

storage.set('/hello.txt', {
  type: 'file',
  mode: 0o100644, // -rw-r--r--
  size: Buffer.byteLength('Привет из Map!\n'),
  content: Buffer.from('Привет из Map!\n'),
  mtime: new Date(),
  atime: new Date(),
  ctime: new Date()
});

storage.set('/subdir', {
  type: 'directory',
  mode: 0o40755,
  size: 4096,
  mtime: new Date(),
  atime: new Date(),
  ctime: new Date(),
  children: new Set(['nested.txt'])
});

storage.set('/subdir/nested.txt', {
  type: 'file',
  mode: 0o100644,
  size: Buffer.byteLength('Вложенный файл\n'),
  content: Buffer.from('Вложенный файл\n'),
  mtime: new Date(),
  atime: new Date(),
  ctime: new Date()
});

// Утилита: нормализация пути
function normalize(p) {
  return path.posix.normalize('/' + p.replace(/^\/+/, '')).replace(/\/$/, '') || '/';
}

// FUSE операции
const ops = {
  readdir: (path, cb) => {
    const normPath = normalize(path);
    console.log('readdir:', normPath);
    const entry = storage.get(normPath);
    if (!entry || entry.type !== 'directory') return cb(fuse.ENOENT);
    return cb(null, Array.from(entry.children));
  },

  getattr: (path, cb) => {
    const normPath = normalize(path);
    console.log('getattr:', normPath);
    const entry = storage.get(normPath);
    if (!entry) return cb(fuse.ENOENT);

    const stats = {
      mode: entry.mode,
      size: entry.size,
      mtime: entry.mtime,
      atime: entry.atime,
      ctime: entry.ctime,
      uid: process.getuid ? process.getuid() : 0,
      gid: process.getgid ? process.getgid() : 0,
    };

    if (entry.type === 'directory') {
      stats.mode |= 0o040000; // directory
      stats.size = 4096;
    } else if (entry.type === 'file') {
      stats.mode |= 0o100000; // regular file
    }

    cb(null, stats);
  },

  open: (path, flags, cb) => {
    const normPath = normalize(path);
    console.log('open:', normPath);
    const entry = storage.get(normPath);
    if (!entry || entry.type !== 'file') return cb(fuse.ENOENT);
    cb(0, 42); // fd = 42
  },

  read: (path, fd, buf, len, pos, cb) => {
    const normPath = normalize(path);
    console.log('read:', normPath, pos, len);
    const entry = storage.get(normPath);
    if (!entry || entry.type !== 'file') return cb(fuse.ENOENT);

    const data = entry.content;
    if (pos >= data.length) return cb(0); // EOF
    const slice = data.slice(pos, pos + len);
    slice.copy(buf);
    cb(slice.length);
  },

  release: (path, fd, cb) => {
    console.log('release:', path);
    cb(0);
  }
};

// Монтирование
const mountPath = process.argv[2] || '/tmp/fuse-map';
console.log(`Монтируем FUSE на ${mountPath}`);

const f = new fuse(mountPath, ops, { debug: true });

f.mount(err => {
  if (err) throw err;
  console.log('Файловая система смонтирована!');
  console.log(`Попробуй: ls -la ${mountPath}`);
  console.log(`Или: cat ${mountPath}/hello.txt`);
});

// Отмонтирование по Ctrl+C
process.on('SIGINT', () => {
  f.unmount(err => {
    if (err) console.error('Ошибка отмонтирования:', err);
    else console.log('Отмонтировано.');
    process.exit();
  });
});