/**
 * app.js —— 私密相册 主逻辑
 * ------------------------------------------------------------
 * 纯原生 ES Module，无框架、无构建。
 * 负责：界面渲染（单页切换）、上传、缩略图生成、灯箱、
 * 多选批量操作、云同步入口等。
 */

import {
  openDB, uid, addPhoto, getAllPhotos, getVideos, getFavorites,
  getByAlbum, updatePhoto, deletePhoto, deletePhotos, addAlbum, getAlbums,
  getAlbum, deleteAlbum, getStats,
} from './db.js';

import {
  saveConfig, loadConfig, isConfigured, backupToCloud, restoreFromCloud,
} from './sync.js';

/* ===================== DOM 引用 ===================== */
const $ = (id) => document.getElementById(id);

const sidebar = $('sidebar');
const overlay = $('overlay');
const menuBtn = $('menuBtn');
const topTitle = $('topTitle');
const storageText = $('storageText');
const storageFill = $('storageFill');
const uploadBtn = $('uploadBtn');
const fileInput = $('fileInput');
const content = $('content');
const actionbar = $('actionbar');
const abCancel = $('abCancel');
const abCount = $('abCount');
const abFav = $('abFav');
const abMove = $('abMove');
const abDel = $('abDel');
const lightbox = $('lightbox');
const lbClose = $('lbClose');
const lbPrev = $('lbPrev');
const lbNext = $('lbNext');
const lbStage = $('lbStage');
const lbFav = $('lbFav');
const lbDel = $('lbDel');
const lbCount = $('lbCount');
const modalMask = $('modalMask');
const modalTitle = $('modalTitle');
const modalBody = $('modalBody');
const modalActions = $('modalActions');
const toast = $('toast');

const BADGES = {
  photos: $('badge-photos'),
  albums: $('badge-albums'),
  videos: $('badge-videos'),
  favorites: $('badge-favorites'),
};

/* ===================== 全局状态 ===================== */
let currentView = 'home';     // home | photos | albums | videos | favorites | settings | album
let currentAlbumId = null;    // 相册详情视图下的相册 id
let currentList = [];         // 当前视图展示的列表（灯箱用它来上下张切换）
let selectionMode = false;    // 是否处于多选模式
const selectedIds = new Set(); // 已选中的照片 id

let lightboxList = [];
let lightboxIndex = 0;
let lbUrl = null;             // 当前灯箱的对象 URL（关闭时释放）

let longPressed = false;      // 移动端长按标记，避免触发点击
let pressTimer = null;
let toastTimer = null;

/* ===================== 工具函数 ===================== */

/** HTML 转义，防止标题中的特殊字符破坏页面 */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 字节数友好显示：B / KB / MB / GB */
function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const v = bytes / Math.pow(1024, i);
  return (i === 0 ? v : v.toFixed(1)) + ' ' + units[i];
}

/** 轻提示 */
function showToast(msg, ms = 2200) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), ms);
}

/** 空状态组件 */
function emptyStateHTML(title, desc) {
  return `
    <div class="empty">
      <div class="empty-icon">📷</div>
      <div class="empty-title">${escapeHtml(title)}</div>
      <div class="empty-desc">${escapeHtml(desc)}</div>
      <button class="btn btn-primary" id="emptyUpload">＋ 上传照片</button>
    </div>`;
}

/* ===================== 缩略图生成 ===================== */

/** 图片：用 canvas 等比缩放到 max 像素以内，导出 JPEG dataURL */
function makeImageThumb(file, max = 400) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width || max, img.height || max));
      const w = Math.round((img.width || max) * scale);
      const h = Math.round((img.height || max) * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      try {
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

/** 视频：抽第一帧做封面（seek 到中部避免黑屏），导出 JPEG dataURL */
function makeVideoThumb(file, max = 400) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.preload = 'metadata';
    video.muted = true;
    video.src = url;
    video.onloadedmetadata = () => {
      // 跳到一个较靠后的帧，很多视频开头是黑屏
      const target = isFinite(video.duration) ? Math.min(1, video.duration / 2) : 0.1;
      video.currentTime = target;
    };
    video.onseeked = () => {
      const scale = Math.min(1, max / Math.max(video.videoWidth || max, video.videoHeight || max));
      const w = Math.round((video.videoWidth || max) * scale);
      const h = Math.round((video.videoHeight || max) * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      try {
        canvas.getContext('2d').drawImage(video, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      } catch {
        resolve(null);
      }
      URL.revokeObjectURL(url);
    };
    video.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
  });
}

/* ===================== 卡片渲染 ===================== */

/** 单个照片卡片 HTML */
function cardHTML(p) {
  const sel = selectionMode ? ' selectable' : '';
  const checked = selectedIds.has(p.id) ? ' checked' : '';
  const inner = p.thumb
    ? `<img class="card-img" src="${p.thumb}" alt="${escapeHtml(p.title)}" loading="lazy">`
    : `<div class="card-ph">${p.type === 'video' ? '▶' : '🖼️'}</div>`;
  const badge = p.type === 'video' ? '<span class="card-type">▶</span>' : '';
  const fav = p.favorite ? '<span class="card-fav">★</span>' : '';
  return `<div class="card${sel}${checked}" data-id="${p.id}">
    <span class="check"></span>${badge}${fav}${inner}
  </div>`;
}

/* ===================== 各视图渲染 ===================== */

/** 顶栏标题映射 */
const VIEW_TITLES = {
  home: '首页', photos: '全部照片', albums: '相册',
  videos: '视频', favorites: '收藏', settings: '设置',
};

/** 刷新当前视图（最常用入口） */
async function refresh() {
  switch (currentView) {
    case 'home': await renderHome(); break;
    case 'photos': await renderPhotos(); break;
    case 'albums': await renderAlbums(); break;
    case 'videos': await renderVideos(); break;
    case 'favorites': await renderFavorites(); break;
    case 'settings': await renderSettings(); break;
    case 'album': await renderAlbumDetail(currentAlbumId); break;
    default: await renderHome();
  }
  if (selectionMode) updateSelBar(); else actionbar.hidden = true;
}

async function renderHome() {
  const s = await getStats();
  updateBadges(s);
  const recent = (await getAllPhotos()).slice(0, 12);
  currentList = recent;
  let html = `
    <div class="stats">
      <div class="stat-card"><div class="stat-num">${s.photoCount}</div><div class="stat-label">照片数</div></div>
      <div class="stat-card"><div class="stat-num">${s.videoCount}</div><div class="stat-label">视频数</div></div>
      <div class="stat-card"><div class="stat-num">${s.albumCount}</div><div class="stat-label">相册数</div></div>
      <div class="stat-card"><div class="stat-num">${s.percent.toFixed(1)}%</div><div class="stat-label">已用存储占比</div></div>
    </div>`;
  if (recent.length === 0) {
    html += emptyStateHTML('还没有任何照片', '点击下方"上传"按钮，把美好瞬间存进来吧～');
  } else {
    html += `<h2 class="section-title">最近照片</h2><div class="grid">${recent.map(cardHTML).join('')}</div>`;
  }
  content.innerHTML = html;
}

async function renderPhotos() {
  const photos = await getAllPhotos();
  currentList = photos;
  updateBadges(await getStats());
  const bar = `<div class="view-bar"><button class="btn" data-action="select-toggle">${selectionMode ? '完成' : '选择'}</button></div>`;
  const grid = photos.length
    ? `<div class="grid">${photos.map(cardHTML).join('')}</div>`
    : emptyStateHTML('还没有照片', '点击下方"上传"按钮，开始你的私密相册');
  content.innerHTML = bar + grid;
}

async function renderAlbums() {
  const albums = await getAlbums();
  updateBadges(await getStats());
  let html = `<div class="view-bar"><button class="btn" data-action="create-album">＋ 新建相册</button></div>`;
  if (!albums.length) {
    html += emptyStateHTML('还没有相册', '点击上方按钮，创建你的第一个相册');
  } else {
    html += `<div class="album-grid">` + albums.map((a) => `
      <div class="album-card" data-album-id="${a.id}">
        <div class="album-cover">📁</div>
        <div class="album-name">${escapeHtml(a.name)}</div>
        <button class="album-del" data-action="album-del" data-album-id="${a.id}" aria-label="删除相册">🗑</button>
      </div>`).join('') + `</div>`;
  }
  content.innerHTML = html;
}

async function renderAlbumDetail(albumId) {
  const album = await getAlbum(albumId);
  const photos = await getByAlbum(albumId);
  currentList = photos;
  topTitle.textContent = album ? album.name : '相册';
  const bar = `<div class="view-bar">
      <button class="btn" data-action="select-toggle">${selectionMode ? '完成' : '选择'}</button>
      <button class="btn ghost" data-action="album-back">← 返回</button>
    </div>`;
  const grid = photos.length
    ? `<div class="grid">${photos.map(cardHTML).join('')}</div>`
    : emptyStateHTML('该相册还没有照片', '去"全部照片"选择照片，再移动到此相册');
  content.innerHTML = bar + grid;
}

async function renderVideos() {
  const videos = await getVideos();
  currentList = videos;
  updateBadges(await getStats());
  content.innerHTML = videos.length
    ? `<div class="grid">${videos.map(cardHTML).join('')}</div>`
    : emptyStateHTML('还没有视频', '上传视频后，会出现在这里');
}

async function renderFavorites() {
  const favs = await getFavorites();
  currentList = favs;
  updateBadges(await getStats());
  content.innerHTML = favs.length
    ? `<div class="grid">${favs.map(cardHTML).join('')}</div>`
    : emptyStateHTML('还没有收藏', '在照片上点亮 ☆，即可加入收藏');
}

async function renderSettings() {
  const cfg = loadConfig();
  const url = cfg ? cfg.url : '';
  const key = cfg ? cfg.anonKey : '';
  const ok = isConfigured();
  content.innerHTML = `
    <div class="settings">
      <h2 class="section-title">云同步设置</h2>
      <p class="hint">开启云同步后，数据会备份到你的 Supabase 云端，换设备也能恢复。
        配置仅保存在本机浏览器，不会上传给任何人。</p>
      <label class="field"><span>Supabase Project URL</span>
        <input id="cfgUrl" type="text" placeholder="https://xxxx.supabase.co" value="${escapeHtml(url)}"></label>
      <label class="field"><span>anon key（公开密钥）</span>
        <input id="cfgKey" type="password" placeholder="public anon key" value="${escapeHtml(key)}"></label>
      <div class="settings-actions">
        <button class="btn" id="saveCfg">保存配置</button>
        <button class="btn btn-primary" id="backupBtn" ${ok ? '' : 'disabled'}>备份到云端</button>
        <button class="btn" id="restoreBtn" ${ok ? '' : 'disabled'}>从云端恢复</button>
      </div>
      <p class="hint" id="syncStatus"></p>
      <p class="hint">未填写配置时，备份/恢复按钮不可用。开通方法与建表语句见 README.md。</p>
    </div>`;

  // 绑定设置页交互
  $('saveCfg').onclick = () => {
    const u = $('cfgUrl').value.trim();
    const k = $('cfgKey').value.trim();
    if (!u || !k) { showToast('请填写完整'); return; }
    saveConfig(u, k);
    showToast('配置已保存');
    $('backupBtn').disabled = false;
    $('restoreBtn').disabled = false;
  };
  $('backupBtn').onclick = async () => {
    if (!isConfigured()) { showToast('请先保存配置'); return; }
    const status = $('syncStatus');
    status.textContent = '正在备份…';
    try {
      const photos = await getAllPhotos();
      const albums = await getAlbums();
      await backupToCloud(photos, albums, (i, n) => { status.textContent = `备份中 ${i}/${n}`; });
      status.textContent = '备份完成 ✅';
      showToast('已备份到云端');
    } catch (e) {
      status.textContent = '备份失败：' + e.message;
      showToast('备份失败');
    }
  };
  $('restoreBtn').onclick = async () => {
    if (!isConfigured()) { showToast('请先保存配置'); return; }
    const status = $('syncStatus');
    status.textContent = '正在恢复…';
    try {
      await restoreFromCloud(addPhoto, addAlbum, (i, n) => { status.textContent = `恢复中 ${i}/${n}`; });
      status.textContent = '恢复完成 ✅';
      showToast('已从云端恢复');
      await refresh();
    } catch (e) {
      status.textContent = '恢复失败：' + e.message;
      showToast('恢复失败');
    }
  };
}

/* ===================== 角标 & 顶栏 ===================== */

function setBadge(el, n) {
  if (!el) return;
  if (n > 0) { el.textContent = n; el.classList.add('show'); }
  else { el.classList.remove('show'); el.textContent = ''; }
}

async function updateBadges() {
  const s = await getStats();
  setBadge(BADGES.photos, s.photoCount + s.videoCount);
  setBadge(BADGES.albums, s.albumCount);
  setBadge(BADGES.videos, s.videoCount);
  setBadge(BADGES.favorites, s.favCount);
  // 顶栏存储用量
  storageText.textContent = `${formatBytes(s.usedBytes)} / ${formatBytes(s.totalBytes)}`;
  storageFill.style.width = s.percent.toFixed(1) + '%';
  return s;
}

/* ===================== 导航 ===================== */

function setActiveNav(view) {
  document.querySelectorAll('.nav-item, .tab-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.view === view);
  });
}

function navigate(view, albumId = null) {
  currentView = view;
  if (albumId !== null) currentAlbumId = albumId;
  // 离开时清空多选状态
  selectionMode = false;
  selectedIds.clear();
  document.body.classList.remove('selecting');
  actionbar.hidden = true;
  if (view !== 'album') topTitle.textContent = VIEW_TITLES[view] || '私密相册';
  setActiveNav(view);
  closeDrawer();
  refresh();
}

/* ===================== 上传 ===================== */

async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  // 在相册详情里上传，则直接归入当前相册
  const targetAlbum = currentView === 'album' ? currentAlbumId : null;
  showToast(`正在导入 ${files.length} 个文件…`);
  let okCount = 0;
  for (const file of files) {
    const isVideo = file.type.startsWith('video/');
    const type = isVideo ? 'video' : 'image';
    try {
      const thumb = isVideo ? await makeVideoThumb(file) : await makeImageThumb(file);
      await addPhoto({
        id: uid(),
        type,
        albumId: targetAlbum,
        title: file.name,
        blob: file,        // File 本身就是 Blob，可直接存入 IndexedDB
        thumb,             // 缩略图 dataURL
        size: file.size,
        created: Date.now(),
        favorite: false,
      });
      okCount++;
    } catch (e) {
      console.error('导入失败', file.name, e);
    }
  }
  showToast(`已导入 ${okCount} 个文件`);
  await refresh();
}

/* ===================== 多选 ===================== */

function enterSelection() {
  selectionMode = true;
  selectedIds.clear();
  document.body.classList.add('selecting');
  updateSelBar();
}

function exitSelection() {
  selectionMode = false;
  selectedIds.clear();
  document.body.classList.remove('selecting');
  actionbar.hidden = true;
  refresh();
}

function toggleSelect(id) {
  if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
  const card = content.querySelector(`.card[data-id="${id}"]`);
  if (card) card.classList.toggle('checked', selectedIds.has(id));
  updateSelBar();
}

function updateSelBar() {
  if (selectionMode) {
    actionbar.hidden = false;
    abCount.textContent = `已选 ${selectedIds.size} 项`;
  } else {
    actionbar.hidden = true;
  }
}

/* ===================== 灯箱 ===================== */

function openLightbox(list, index) {
  lightboxList = list;
  lightboxIndex = index;
  lightbox.hidden = false;
  renderLightbox();
}

function renderLightbox() {
  if (lbUrl) { URL.revokeObjectURL(lbUrl); lbUrl = null; }
  const p = lightboxList[lightboxIndex];
  if (!p) { closeLightbox(); return; }
  lbStage.innerHTML = '';
  lbUrl = URL.createObjectURL(p.blob);
  if (p.type === 'video') {
    const v = document.createElement('video');
    v.src = lbUrl; v.controls = true; v.style.maxWidth = '92vw'; v.style.maxHeight = '82vh';
    lbStage.appendChild(v);
  } else {
    const img = document.createElement('img');
    img.src = lbUrl; img.style.maxWidth = '92vw'; img.style.maxHeight = '82vh';
    lbStage.appendChild(img);
  }
  lbCount.textContent = `${lightboxIndex + 1} / ${lightboxList.length}`;
  lbFav.textContent = p.favorite ? '★ 已收藏' : '☆ 收藏';
}

function closeLightbox() {
  if (lbUrl) { URL.revokeObjectURL(lbUrl); lbUrl = null; }
  lbStage.innerHTML = '';
  lightbox.hidden = true;
}

function openFromCurrent(id) {
  const idx = currentList.findIndex((p) => p.id === id);
  if (idx >= 0) openLightbox(currentList, idx);
}

/* ===================== 弹窗 ===================== */

function openModal(title, bodyHTML, actions = []) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHTML;
  modalActions.innerHTML = '';
  actions.forEach((a) => {
    const b = document.createElement('button');
    b.className = 'btn ' + (a.cls || '');
    b.textContent = a.label;
    b.addEventListener('click', a.onClick);
    modalActions.appendChild(b);
  });
  modalMask.hidden = false;
}

function closeModal() {
  modalMask.hidden = true;
  modalBody.innerHTML = '';
  modalActions.innerHTML = '';
}

/* ===================== 新建相册 / 移动相册 ===================== */

function openCreateAlbum() {
  const html = `<label class="field"><span>相册名称</span>
    <input id="newAlbumName" type="text" placeholder="例如：旅行 2025" maxlength="40"></label>`;
  openModal('新建相册', html, [
    { label: '取消', cls: 'ghost', onClick: closeModal },
    {
      label: '创建', cls: 'btn-primary', onClick: async () => {
        const name = document.getElementById('newAlbumName').value.trim();
        if (!name) { showToast('请输入名称'); return; }
        await addAlbum({ id: uid(), name, created: Date.now() });
        closeModal();
        showToast('相册已创建');
        refresh();
      },
    },
  ]);
  setTimeout(() => { const el = document.getElementById('newAlbumName'); if (el) el.focus(); }, 50);
}

async function openMoveModal() {
  const albums = await getAlbums();
  let html = `<div class="album-list">`;
  if (!albums.length) html += `<p class="hint">还没有相册，先新建一个吧。</p>`;
  albums.forEach((a) => {
    html += `<button class="album-opt" data-album-id="${a.id}">${escapeHtml(a.name)}</button>`;
  });
  html += `<button class="album-opt new" data-action="move-new">＋ 新建相册并移入</button></div>`;
  openModal('移动到相册', html);
  modalBody.querySelectorAll('.album-opt').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.action === 'move-new') {
        const name = window.prompt('输入新相册名称');
        if (!name) return;
        const album = { id: uid(), name: name.trim(), created: Date.now() };
        await addAlbum(album);
        await applyMove(album.id);
      } else {
        await applyMove(btn.dataset.albumId);
      }
    });
  });
}

async function applyMove(albumId) {
  for (const id of selectedIds) await updatePhoto(id, { albumId });
  closeModal();
  showToast(`已移动 ${selectedIds.size} 项`);
  exitSelection();
}

async function confirmDeleteAlbum(id) {
  if (!window.confirm('删除相册会把它里面的照片移回"未分类"，确定删除相册吗？')) return;
  await deleteAlbum(id);
  showToast('相册已删除');
  refresh();
}

/* ===================== 移动端抽屉 ===================== */

function openDrawer() { sidebar.classList.add('open'); overlay.hidden = false; }
function closeDrawer() { sidebar.classList.remove('open'); overlay.hidden = true; }

/* ===================== 事件绑定 ===================== */

function wireEvents() {
  // 导航项
  document.querySelectorAll('.nav-item, .tab-item').forEach((el) => {
    el.addEventListener('click', () => navigate(el.dataset.view));
  });

  // 移动端抽屉
  menuBtn.addEventListener('click', openDrawer);
  overlay.addEventListener('click', closeDrawer);

  // 上传
  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    e.target.value = ''; // 允许重复选择同一文件
  });

  // 空状态里的上传按钮（事件委托）
  content.addEventListener('click', (e) => {
    if (e.target.id === 'emptyUpload') { fileInput.click(); return; }
  });

  // 内容区点击（卡片 / 相册 / 操作按钮）
  content.addEventListener('click', onContentClick);

  // 移动端长按进入多选
  content.addEventListener('touchstart', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const id = card.dataset.id;
    pressTimer = setTimeout(() => {
      longPressed = true;
      if (currentView !== 'photos' && currentView !== 'album') return;
      if (!selectionMode) { enterSelection(); refresh(); }
      toggleSelect(id);
      pressTimer = null;
    }, 500);
  }, { passive: true });
  content.addEventListener('touchend', () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
  content.addEventListener('touchmove', () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }, { passive: true });

  // 多选操作栏
  abCancel.addEventListener('click', exitSelection);
  abFav.addEventListener('click', async () => {
    for (const id of selectedIds) await updatePhoto(id, { favorite: true });
    showToast('已加入收藏');
    exitSelection();
  });
  abMove.addEventListener('click', openMoveModal);
  abDel.addEventListener('click', async () => {
    if (!window.confirm(`确定删除选中的 ${selectedIds.size} 项吗？此操作不可恢复。`)) return;
    await deletePhotos(Array.from(selectedIds));
    showToast('已删除');
    exitSelection();
  });

  // 灯箱
  lbClose.addEventListener('click', closeLightbox);
  lbPrev.addEventListener('click', () => { if (lightboxIndex > 0) { lightboxIndex--; renderLightbox(); } });
  lbNext.addEventListener('click', () => { if (lightboxIndex < lightboxList.length - 1) { lightboxIndex++; renderLightbox(); } });
  lbFav.addEventListener('click', async () => {
    const p = lightboxList[lightboxIndex];
    await updatePhoto(p.id, { favorite: !p.favorite });
    p.favorite = !p.favorite;
    lbFav.textContent = p.favorite ? '★ 已收藏' : '☆ 收藏';
    updateBadges();
  });
  lbDel.addEventListener('click', async () => {
    const p = lightboxList[lightboxIndex];
    await deletePhoto(p.id);
    lightboxList.splice(lightboxIndex, 1);
    if (lightboxList.length === 0) { closeLightbox(); await refresh(); return; }
    if (lightboxIndex >= lightboxList.length) lightboxIndex = lightboxList.length - 1;
    renderLightbox();
    await refresh();
  });
  // 点击灯箱空白处关闭
  lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });

  // 弹窗遮罩点击关闭
  modalMask.addEventListener('click', (e) => { if (e.target === modalMask) closeModal(); });

  // 键盘快捷键：灯箱左右切换 / Esc 关闭
  document.addEventListener('keydown', (e) => {
    if (lightbox.hidden) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') lbPrev.click();
    else if (e.key === 'ArrowRight') lbNext.click();
  });
}

/** 内容区点击事件分发 */
function onContentClick(e) {
  const actionEl = e.target.closest('[data-action]');
  if (actionEl) {
    const action = actionEl.dataset.action;
    if (action === 'create-album') { openCreateAlbum(); return; }
    if (action === 'select-toggle') {
      if (selectionMode) exitSelection();
      else { enterSelection(); refresh(); }
      return;
    }
    if (action === 'album-back') { navigate('albums'); return; }
    if (action === 'album-del') { e.stopPropagation(); confirmDeleteAlbum(actionEl.dataset.albumId); return; }
  }

  // 相册卡片 → 进入相册详情
  const albumCard = e.target.closest('.album-card');
  if (albumCard && !e.target.closest('[data-action]')) {
    navigate('album', albumCard.dataset.albumId);
    return;
  }

  // 照片卡片
  const card = e.target.closest('.card');
  if (card) {
    const id = card.dataset.id;
    if (selectionMode) { toggleSelect(id); return; }
    if (longPressed) { longPressed = false; return; } // 长按后不触发点击
    openFromCurrent(id);
  }
}

/* ===================== 启动 ===================== */

async function init() {
  try {
    await openDB();
  } catch (e) {
    console.error(e);
    showToast('本地数据库打开失败');
  }
  wireEvents();
  navigate('home');
}

init();
