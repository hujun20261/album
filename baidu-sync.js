/**
 * baidu-sync.js —— 百度网盘云同步模块
 * ------------------------------------------------------------
 * 使用百度网盘 XPan API 实现照片/视频的云端备份与恢复。
 * OAuth2 授权流程：用户点击"授权登录" → 弹窗打开百度授权页 →
 * 回调获取 access_token → 保存到 localStorage。
 */

const BAIDU_CONFIG_KEY = 'album-baidu-config';
const BAIDU_TOKEN_KEY = 'album-baidu-token';

// 百度网盘 OAuth 配置（需要在百度开放平台申请）
// 这里使用 implicit grant 方式，无需后端
const BAIDU_OAUTH = {
  // 注意：实际部署时需要替换为你自己的 App Key
  // 申请地址：https://pan.baidu.com/union/doc/0ksg0sbig
  appId: '你的AppID',      // 替换为实际的 App ID
  appKey: '你的AppKey',    // 替换为实际的 App Key
  redirectUri: 'https://hujun20261.github.io/album/callback.html', // 回调地址
};

// XPan API 基础地址
const API_BASE = 'https://pan.baidu.com/rest/2.0/xpan';

/* ---------- 配置管理 ---------- */

/** 保存百度网盘配置 */
export function saveBaiduConfig(appId, appKey, redirectUri) {
  localStorage.setItem(BAIDU_CONFIG_KEY, JSON.stringify({ appId, appKey, redirectUri }));
}

/** 读取百度网盘配置 */
export function loadBaiduConfig() {
  try {
    const raw = localStorage.getItem(BAIDU_CONFIG_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return BAIDU_OAUTH; // 未配置时使用默认值
}

/** 保存 access_token */
export function saveToken(token, expiresIn) {
  const expireAt = Date.now() + expiresIn * 1000;
  localStorage.setItem(BAIDU_TOKEN_KEY, JSON.stringify({ token, expireAt }));
}

/** 读取 access_token */
export function loadToken() {
  try {
    const raw = localStorage.getItem(BAIDU_TOKEN_KEY);
    if (!raw) return null;
    const { token, expireAt } = JSON.parse(raw);
    if (Date.now() > expireAt) {
      localStorage.removeItem(BAIDU_TOKEN_KEY);
      return null; // 已过期
    }
    return token;
  } catch {
    return null;
  }
}

/** 清除 token（退出登录） */
export function clearToken() {
  localStorage.removeItem(BAIDU_TOKEN_KEY);
}

/** 是否已授权 */
export function isAuthorized() {
  return !!loadToken();
}

/** 是否已配置 */
export function isConfigured() {
  const cfg = loadBaiduConfig();
  return !!(cfg && cfg.appKey && cfg.appKey !== '你的AppKey');
}

/* ---------- OAuth 授权 ---------- */

/** 生成授权 URL */
export function getAuthUrl() {
  const cfg = loadBaiduConfig();
  const params = new URLSearchParams({
    response_type: 'token',
    client_id: cfg.appKey,
    redirect_uri: cfg.redirectUri,
    scope: 'basic,netdisk',
    display: 'popup',
  });
  return `https://openapi.baidu.com/oauth/2.0/authorize?${params}`;
}

/** 从 URL hash 中提取 access_token（回调页面调用） */
export function parseTokenFromHash(hash) {
  // hash 格式：#access_token=xxx&expires_in=xxx&...
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const token = params.get('access_token');
  const expiresIn = parseInt(params.get('expires_in') || '2592000', 10);
  if (token) {
    saveToken(token, expiresIn);
    return { token, expiresIn };
  }
  return null;
}

/* ---------- XPan API 封装 ---------- */

/** 带认证的 API 请求 */
async function api(method, path, params = {}, body = null) {
  const token = loadToken();
  if (!token) throw new Error('未授权，请先登录百度网盘');
  
  const url = new URL(`${API_BASE}${path}`);
  url.searchParams.set('access_token', token);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  
  const opts = { method, headers: {} };
  if (body) {
    opts.body = body;
    if (typeof body === 'string') opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  
  const res = await fetch(url, opts);
  const data = await res.json();
  
  if (data.errno !== 0) {
    throw new Error(`百度网盘错误: ${data.errmsg || data.errno}`);
  }
  
  return data;
}

/** 获取用户信息和空间配额 */
export async function getUserInfo() {
  const data = await api('GET', '/nas', { method: 'info' });
  return {
    baiduName: data.baidu_name,
    avatarUrl: data.avatar_url,
    total: data.total,      // 总空间（字节）
    used: data.used,        // 已用空间（字节）
    free: data.free,        // 剩余空间（字节）
  };
}

/** 创建目录 */
async function mkdir(path) {
  try {
    await api('POST', '/file', { method: 'create', path });
    return true;
  } catch (e) {
    // 目录已存在不算错误
    if (e.message.includes('31062')) return true;
    throw e;
  }
}

/** 预上传（获取 uploadid） */
async function preUpload(path, size, md5) {
  const data = await api('POST', '/file', { 
    method: 'precreate',
    path,
    size,
    isdir: 0,
    autoinit: 1,
    block_list: JSON.stringify([md5]),
  });
  return {
    uploadid: data.uploadid,
    blockList: data.block_list,
  };
}

/** 分片上传 */
async function uploadBlock(uploadid, path, blockIndex, blob) {
  const token = loadToken();
  const url = new URL('https://d.pcs.baidu.com/rest/2.0/pcs/superfile2');
  url.searchParams.set('access_token', token);
  url.searchParams.set('method', 'upload');
  url.searchParams.set('type', 'tmpfile');
  url.searchParams.set('path', path);
  url.searchParams.set('uploadid', uploadid);
  url.searchParams.set('partseq', blockIndex);
  
  const fd = new FormData();
  fd.append('file', blob);
  
  const res = await fetch(url, { method: 'POST', body: fd });
  return await res.json();
}

/** 创建文件（完成上传） */
async function createFile(path, size, uploadid, md5) {
  await api('POST', '/file', {
    method: 'create',
    path,
    size,
    isdir: 0,
    uploadid,
    block_list: JSON.stringify([md5]),
  });
}

/** 计算 MD5 */
async function calcMD5(blob) {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('MD5', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 浏览器不支持 crypto.subtle 的 MD5，使用简单实现
async function calcMD5Simple(blob) {
  // 对于大文件，这里用简化的方式：只取首尾块计算
  // 实际生产环境应该使用 spark-md5 等库
  const chunkSize = 4 * 1024 * 1024; // 4MB
  const chunks = [];
  
  if (blob.size <= chunkSize) {
    // 小文件直接读取
    const buffer = await blob.arrayBuffer();
    const view = new Uint8Array(buffer);
    let hash = 0;
    for (let i = 0; i < view.length; i++) {
      hash = ((hash << 5) - hash + view[i]) & 0xFFFFFFFF;
    }
    return Math.abs(hash).toString(16).padStart(32, '0');
  }
  
  // 大文件：取首块和尾块
  const head = blob.slice(0, chunkSize);
  const tail = blob.slice(blob.size - chunkSize);
  
  const [headHash, tailHash] = await Promise.all([
    calcMD5Simple(head),
    calcMD5Simple(tail),
  ]);
  
  // 组合 MD5
  let combined = '';
  for (let i = 0; i < 32; i++) {
    combined += String.fromCharCode(
      (parseInt(headHash[i], 16) + parseInt(tailHash[i], 16)) % 16 + 0x30
    );
  }
  return combined;
}

/** 上传文件到百度网盘 */
export async function uploadFile(remotePath, blob, onProgress) {
  // 1. 确保目录存在
  const dir = remotePath.substring(0, remotePath.lastIndexOf('/'));
  if (dir) await mkdir(dir);
  
  // 2. 预上传
  const md5 = await calcMD5Simple(blob);
  const { uploadid } = await preUpload(remotePath, blob.size, md5);
  
  // 3. 分片上传（每片 4MB）
  const chunkSize = 4 * 1024 * 1024;
  const chunks = Math.ceil(blob.size / chunkSize);
  
  for (let i = 0; i < chunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, blob.size);
    const chunk = blob.slice(start, end);
    
    await uploadBlock(uploadid, remotePath, i, chunk);
    
    if (onProgress) onProgress(i + 1, chunks);
  }
  
  // 4. 完成上传
  await createFile(remotePath, blob.size, uploadid, md5);
  
  return remotePath;
}

/** 列出目录下的文件 */
export async function listFiles(remoteDir, start = 0, limit = 1000) {
  const data = await api('GET', '/file', {
    method: 'list',
    dir: remoteDir,
    start,
    limit,
    folder: 0,
  });
  
  return (data.list || []).map(f => ({
    path: f.path,
    filename: f.server_filename,
    size: f.size,
    isDir: f.isdir === 1,
    mtime: f.mtime * 1000,
    md5: f.md5,
  }));
}

/** 下载文件 */
export async function downloadFile(remotePath) {
  const token = loadToken();
  const url = `https://d.pcs.baidu.com/rest/2.0/pcs/file?method=download&access_token=${token}&path=${encodeURIComponent(remotePath)}`;
  
  const res = await fetch(url);
  if (!res.ok) throw new Error('下载失败: ' + res.status);
  
  return await res.blob();
}

/** 删除文件 */
export async function deleteFile(remotePaths) {
  const paths = Array.isArray(remotePaths) ? remotePaths : [remotePaths];
  await api('POST', '/file', { method: 'filemanager', oper: 'delete' }, 
    `async=0&filelist=${encodeURIComponent(JSON.stringify(paths))}`
  );
}

/* ---------- 相册同步 ---------- */

const ALBUM_DIR = '/apps/私密相册';

/** 同步相册元数据到百度网盘 */
export async function syncAlbums(albums) {
  const metaPath = `${ALBUM_DIR}/albums.json`;
  const blob = new Blob([JSON.stringify(albums, null, 2)], { type: 'application/json' });
  await uploadFile(metaPath, blob);
}

/** 从百度网盘恢复相册元数据 */
export async function restoreAlbums() {
  try {
    const blob = await downloadFile(`${ALBUM_DIR}/albums.json`);
    const text = await blob.text();
    return JSON.parse(text);
  } catch {
    return []; // 文件不存在
  }
}

/** 同步单张照片 */
export async function syncPhoto(photo, onProgress) {
  const ext = photo.type === 'video' ? 'mp4' : 'jpg';
  const remotePath = `${ALBUM_DIR}/photos/${photo.id}.${ext}`;
  
  await uploadFile(remotePath, photo.blob, onProgress);
  
  // 同时保存元数据
  const meta = {
    id: photo.id,
    type: photo.type,
    albumId: photo.albumId,
    title: photo.title,
    size: photo.size,
    created: photo.created,
    favorite: photo.favorite,
    thumb: photo.thumb, // 缩略图 base64
  };
  
  const metaPath = `${ALBUM_DIR}/meta/${photo.id}.json`;
  const blob = new Blob([JSON.stringify(meta)], { type: 'application/json' });
  await uploadFile(metaPath, blob);
  
  return remotePath;
}

/** 从百度网盘恢复所有照片 */
export async function restorePhotos(addPhoto, onProgress) {
  // 1. 获取所有元数据文件
  const metaFiles = await listFiles(`${ALBUM_DIR}/meta`);
  const photos = [];
  
  for (let i = 0; i < metaFiles.length; i++) {
    const metaFile = metaFiles[i];
    if (metaFile.isDir) continue;
    
    // 下载元数据
    const metaBlob = await downloadFile(metaFile.path);
    const meta = JSON.parse(await metaBlob.text());
    
    // 下载原图
    const ext = meta.type === 'video' ? 'mp4' : 'jpg';
    const photoPath = `${ALBUM_DIR}/photos/${meta.id}.${ext}`;
    const blob = await downloadFile(photoPath);
    
    await addPhoto({
      ...meta,
      blob,
    });
    
    if (onProgress) onProgress(i + 1, metaFiles.length);
  }
  
  return photos.length;
}

/* ---------- 备份与恢复入口 ---------- */

/**
 * 备份到百度网盘
 * @param {Array} photos 本地照片列表
 * @param {Array} albums 本地相册列表
 * @param {(msg:string)=>void} onStatus 状态回调
 */
export async function backupToBaidu(photos, albums, onStatus) {
  onStatus('正在准备备份...');
  
  // 1. 同步相册元数据
  onStatus('正在同步相册列表...');
  await syncAlbums(albums);
  
  // 2. 逐张上传照片
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    onStatus(`正在上传照片 ${i + 1}/${photos.length}...`);
    await syncPhoto(p, (chunk, total) => {
      onStatus(`上传照片 ${i + 1}/${photos.length} (${chunk}/${total} 片)`);
    });
  }
  
  onStatus(`备份完成！共 ${photos.length} 张照片`);
}

/**
 * 从百度网盘恢复
 * @param {(photo:object)=>Promise<void>} addPhoto 写入本地照片
 * @param {(album:object)=>Promise<void>} addAlbum 写入本地相册
 * @param {(msg:string)=>void} onStatus 状态回调
 */
export async function restoreFromBaidu(addPhoto, addAlbum, onStatus) {
  onStatus('正在从百度网盘恢复...');
  
  // 1. 恢复相册
  onStatus('正在恢复相册列表...');
  const albums = await restoreAlbums();
  for (const a of albums) {
    await addAlbum(a);
  }
  
  // 2. 恢复照片
  await restorePhotos(addPhoto, (i, total) => {
    onStatus(`正在恢复照片 ${i}/${total}...`);
  });
  
  onStatus('恢复完成！');
}
