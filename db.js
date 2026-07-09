/**
 * db.js —— IndexedDB 本地存储封装
 * ------------------------------------------------------------
 * 数据全部保存在用户浏览器本地（打开即用，无需联网、无需登录）。
 * 库名：album-db
 * 对象仓：photos（照片/视频）、albums（相册）
 * 收藏用 photos 的 favorite 布尔字段表示。
 */

const DB_NAME = 'album-db';
const DB_VERSION = 1;
const STORE_PHOTOS = 'photos';
const STORE_ALBUMS = 'albums';

// 单例：数据库只打开一次，之后复用同一个连接
let dbPromise = null;

/**
 * 打开（或首次自动创建）数据库
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    // 仅在数据库首次创建或版本升级时执行
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
        const store = db.createObjectStore(STORE_PHOTOS, { keyPath: 'id' });
        store.createIndex('created', 'created', { unique: false });
        store.createIndex('albumId', 'albumId', { unique: false });
        store.createIndex('favorite', 'favorite', { unique: false });
        store.createIndex('type', 'type', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_ALBUMS)) {
        db.createObjectStore(STORE_ALBUMS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** 把 IndexedDB 请求包装成 Promise，方便用 async/await */
function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 生成唯一 id（时间戳 + 随机串），避免重复 */
export function uid() {
  return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/* ===================== 照片 / 视频 ===================== */

/** 新增一张照片或视频 */
export async function addPhoto(photo) {
  const db = await openDB();
  return promisify(
    db.transaction(STORE_PHOTOS, 'readwrite').objectStore(STORE_PHOTOS).add(photo)
  );
}

/** 获取全部照片/视频（按创建时间倒序，最新在前） */
export async function getAllPhotos() {
  const db = await openDB();
  const list = await promisify(
    db.transaction(STORE_PHOTOS, 'readonly').objectStore(STORE_PHOTOS).getAll()
  );
  return list.sort((a, b) => (b.created || 0) - (a.created || 0));
}

/** 获取单张照片/视频 */
export async function getPhoto(id) {
  const db = await openDB();
  return promisify(db.transaction(STORE_PHOTOS, 'readonly').objectStore(STORE_PHOTOS).get(id));
}

/** 仅获取视频 */
export async function getVideos() {
  const all = await getAllPhotos();
  return all.filter((p) => p.type === 'video');
}

/** 仅获取已收藏项 */
export async function getFavorites() {
  const all = await getAllPhotos();
  return all.filter((p) => p.favorite === true);
}

/** 按相册获取（albumId 为 null 表示未分类） */
export async function getByAlbum(albumId) {
  const all = await getAllPhotos();
  return all.filter((p) => (p.albumId ?? null) === albumId);
}

/** 更新照片/视频的部分字段（如收藏、所属相册） */
export async function updatePhoto(id, changes) {
  const db = await openDB();
  const store = db.transaction(STORE_PHOTOS, 'readwrite').objectStore(STORE_PHOTOS);
  const photo = await promisify(store.get(id));
  if (!photo) return;
  const updated = { ...photo, ...changes, id };
  return promisify(store.put(updated));
}

/** 删除单张 */
export async function deletePhoto(id) {
  const db = await openDB();
  return promisify(db.transaction(STORE_PHOTOS, 'readwrite').objectStore(STORE_PHOTOS).delete(id));
}

/** 批量删除 */
export async function deletePhotos(ids) {
  const db = await openDB();
  const store = db.transaction(STORE_PHOTOS, 'readwrite').objectStore(STORE_PHOTOS);
  await Promise.all(ids.map((id) => promisify(store.delete(id))));
}

/* ===================== 相册 ===================== */

/** 新建相册 */
export async function addAlbum(album) {
  const db = await openDB();
  return promisify(db.transaction(STORE_ALBUMS, 'readwrite').objectStore(STORE_ALBUMS).add(album));
}

/** 获取全部相册（倒序） */
export async function getAlbums() {
  const db = await openDB();
  const list = await promisify(
    db.transaction(STORE_ALBUMS, 'readonly').objectStore(STORE_ALBUMS).getAll()
  );
  return list.sort((a, b) => (b.created || 0) - (a.created || 0));
}

/** 获取单个相册 */
export async function getAlbum(id) {
  const db = await openDB();
  return promisify(db.transaction(STORE_ALBUMS, 'readonly').objectStore(STORE_ALBUMS).get(id));
}

/** 删除相册，并把里面的照片移回"未分类" */
export async function deleteAlbum(id) {
  const db = await openDB();
  await promisify(db.transaction(STORE_ALBUMS, 'readwrite').objectStore(STORE_ALBUMS).delete(id));
  const inAlbum = await getByAlbum(id);
  await Promise.all(inAlbum.map((p) => updatePhoto(p.id, { albumId: null })));
}

/* ===================== 统计 ===================== */

/**
 * 汇总统计信息（供首页卡片与顶栏使用）
 * @returns {Promise<{photoCount:number, videoCount:number, albumCount:number, favCount:number, usedBytes:number, totalBytes:number, percent:number}>}
 */
export async function getStats() {
  const photos = await getAllPhotos();
  const albums = await getAlbums();
  const totalBytes = 5 * 1024 * 1024 * 1024; // 套餐上限 5GB
  const usedBytes = photos.reduce((sum, p) => sum + (p.size || 0), 0);
  return {
    photoCount: photos.filter((p) => p.type !== 'video').length,
    videoCount: photos.filter((p) => p.type === 'video').length,
    albumCount: albums.length,
    favCount: photos.filter((p) => p.favorite === true).length,
    usedBytes,
    totalBytes,
    percent: Math.min(100, (usedBytes / totalBytes) * 100),
  };
}
