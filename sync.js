/**
 * sync.js —— 云同步模块（Supabase，可选启用）
 * ------------------------------------------------------------
 * 重要：默认不加载任何网络库。只有用户在"设置"页点击
 * "备份到云端 / 从云端恢复"时，本模块才会通过 CDN 动态加载
 * Supabase SDK：import('https://esm.sh/@supabase/supabase-js@2')
 * 因此 offline（离线）时应用依然可正常使用。
 */

const STORAGE_KEY = 'album-supabase-config';
const BUCKET = 'album-media'; // 云端存储桶名称（需与 README 中建桶一致）

/* ---------- 配置（仅保存在本机 localStorage，绝不上传） ---------- */

/** 保存 Supabase 配置 */
export function saveConfig(url, anonKey) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ url, anonKey }));
}

/** 读取配置 */
export function loadConfig() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
  } catch {
    return null;
  }
}

/** 是否已正确配置 */
export function isConfigured() {
  const c = loadConfig();
  return !!(c && c.url && c.anonKey);
}

/** 动态获取 Supabase 客户端（首次调用时按需加载 SDK） */
async function getClient() {
  const config = loadConfig();
  if (!config || !config.url || !config.anonKey) {
    throw new Error('未配置 Supabase，请先在设置页填写 Project URL 与 anon key');
  }
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  return createClient(config.url, config.anonKey);
}

/* ---------- 备份：本地 → 云端 ---------- */

/**
 * 把本地数据备份到云端
 * @param {Array} dbPhotos 本地全部照片/视频
 * @param {Array} dbAlbums 本地全部相册
 * @param {(done:number, total:number)=>void} onProgress 进度回调
 */
export async function backupToCloud(dbPhotos, dbAlbums, onProgress) {
  const supabase = await getClient();

  // 1) 上传相册元数据（按 id 覆盖，重复备份安全）
  if (dbAlbums.length) {
    const { error } = await supabase.from('albums').upsert(dbAlbums);
    if (error) throw new Error('上传相册失败：' + error.message);
  }

  // 2) 逐张上传照片：原文件进存储桶，缩略图+元数据进数据表
  for (let i = 0; i < dbPhotos.length; i++) {
    const p = dbPhotos[i];
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload('photos/' + p.id, p.blob, {
        upsert: true,
        contentType: p.type === 'video' ? 'video/mp4' : 'image/jpeg',
      });
    if (upErr) throw new Error('上传文件失败：' + upErr.message);

    const row = {
      id: p.id,
      type: p.type,
      albumId: p.albumId ?? null,
      title: p.title ?? '',
      size: p.size ?? 0,
      created: p.created,
      favorite: p.favorite === true,
      thumb: p.thumb ?? null,
    };
    const { error } = await supabase.from('photos').upsert(row);
    if (error) throw new Error('写入照片数据失败：' + error.message);

    if (onProgress) onProgress(i + 1, dbPhotos.length);
  }
}

/* ---------- 恢复：云端 → 本地 ---------- */

/**
 * 从云端恢复数据到本地 IndexedDB
 * @param {(photo:object)=>Promise<void>} addPhoto 本地写入照片的函数
 * @param {(album:object)=>Promise<void>} addAlbum 本地写入相册的函数
 * @param {(done:number, total:number)=>void} onProgress 进度回调
 */
export async function restoreFromCloud(addPhoto, addAlbum, onProgress) {
  const supabase = await getClient();

  // 1) 恢复相册
  const { data: albums, error: aErr } = await supabase.from('albums').select('*');
  if (aErr) throw new Error('读取云端相册失败：' + aErr.message);
  for (const a of albums || []) {
    await addAlbum({ id: a.id, name: a.name, created: a.created });
  }

  // 2) 恢复照片（从存储桶下载原文件）
  const { data: photos, error: pErr } = await supabase.from('photos').select('*');
  if (pErr) throw new Error('读取云端照片失败：' + pErr.message);
  const list = photos || [];
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    const { data: blob, error: dlErr } = await supabase.storage
      .from(BUCKET)
      .download('photos/' + row.id);
    if (dlErr) throw new Error('下载文件失败：' + dlErr.message);
    await addPhoto({
      id: row.id,
      type: row.type,
      albumId: row.albumId ?? null,
      title: row.title ?? '',
      blob,
      thumb: row.thumb ?? null,
      size: row.size ?? 0,
      created: row.created,
      favorite: row.favorite === true,
    });
    if (onProgress) onProgress(i + 1, list.length);
  }
}
