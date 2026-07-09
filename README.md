# 私密相册（纯静态网页版）

一款**永久免费、无需安装**的照片/视频管理网页应用。所有数据保存在你自己的浏览器本地（IndexedDB），
打开网页即可使用，**不上传任何内容到服务器**。可选的"云同步"功能由你自己的 Supabase 账号提供，
默认关闭、不联网。

> 适合电脑小白：双击 `index.html` 或托管到任意静态空间（GitHub Pages）即可。全程中文界面。

---

## 一、文件清单

| 文件 | 作用 |
|------|------|
| `index.html` | 页面骨架：侧边栏/顶栏/内容区/灯箱/弹窗等结构 |
| `styles.css` | 全部样式（自定义蓝紫渐变风格，**不依赖任何外部 CSS 框架**，离线可用） |
| `db.js` | 本地存储封装（IndexedDB 的 `openDB / addPhoto / getAllPhotos / getVideos / getFavorites / getByAlbum / updatePhoto / deletePhoto / addAlbum / getAlbums / getStats` 等） |
| `app.js` | 主逻辑：界面渲染、上传、缩略图生成、灯箱、多选、云同步入口 |
| `sync.js` | 云同步模块（Supabase，**只有在你主动点"备份/恢复"时才通过 CDN 加载 SDK**） |
| `README.md` | 本说明文档 |

---

## 二、本地预览（两种方法任选）

### 方法 A：直接双击（最简单）
双击 `index.html` 用浏览器打开即可。
> 注意：部分浏览器对 `file://` 下的 ES Module 有限制。若页面空白，请用方法 B。

### 方法 B：本地起一个小服务器（推荐）
```bash
cd album
python3 -m http.server 8000
```
然后浏览器打开：<http://localhost:8000>

（没有 python 也可用 `npx serve` 或任意静态服务器。）

---

## 三、功能说明

- **首页**：照片数 / 视频数 / 相册数 / 已用存储占比 四张统计卡片 + 最近照片网格。
- **全部照片**：网格展示所有照片视频；点"选择"进入多选，可批量**收藏 / 移动到相册 / 删除**（手机上也可**长按**图片进入多选）。
- **相册**：新建相册、查看相册列表；点相册卡片进入查看其中照片。
- **视频**：视频封面网格（自动抽第一帧做封面），点击播放。
- **收藏**：显示所有已点亮 ☆ 的项目。
- **上传**：点顶栏"＋ 上传"，选择图片/视频，自动压缩生成缩略图并存入本地。
- **灯箱**：点任意照片/视频全屏查看，支持上一张/下一张、收藏、删除、关闭（键盘 ← → Esc 也可用）。
- **空状态**：没有内容时显示友好引导与"上传"按钮。

---

## 四、部署到 GitHub Pages（由主理人操作）

1. 把 `album/` 目录下的全部文件推送到 GitHub 仓库（可放在仓库根目录、或 `docs/`、`album/` 子目录）。
2. 仓库 → **Settings → Pages → Build and deployment → Source** 选择对应分支与目录（如 `/root` 或 `/docs`）。
3. 等待一两分钟，访问 `https://<用户名>.github.io/<仓库名>/` 即可。
4. 因为是纯静态文件，无需任何构建步骤。

> 小贴士：若把文件放在子目录，访问地址需带子目录路径，例如 `.../<仓库名>/album/`。

---

## 五、开通云同步（可选，进阶）

默认数据只存在本机。若想在换设备/重装后恢复，可启用 Supabase 云同步。

### 1. 注册 Supabase
- 打开 <https://supabase.com> 注册并新建一个项目（免费额度足够个人使用）。
- 进入项目 → **Settings → API**，复制 **Project URL** 和 **anon public key**。

### 2. 建表与建存储桶
在 Supabase 控制台 **SQL Editor** 中执行以下语句：

```sql
-- 相册表
create table if not exists albums (
  id text primary key,
  name text not null,
  created bigint not null
);

-- 照片表（缩略图以文本存储，原文件存于存储桶）
create table if not exists photos (
  id text primary key,
  type text not null,
  albumId text,
  title text,
  size bigint,
  created bigint not null,
  favorite boolean default false,
  thumb text
);

-- 存储桶（也可在 Storage 页面手动新建，名称必须为 album-media）
insert into storage.buckets (id, name, public)
values ('album-media', 'album-media', false)
on conflict (id) do nothing;
```

### 3. 配置权限（重要）
用 **anon key** 访问需要权限策略。测试阶段可简单放行（生产请按需收紧）：

```sql
alter table photos enable row level security;
alter table albums enable row level security;
create policy "public all photos" on photos for all using (true) with check (true);
create policy "public all albums" on albums for all using (true) with check (true);
```

存储桶也需在 **Storage → album-media → Policies** 添加允许 anon 的读写策略（或用 SQL 同上风格）。

### 4. 在应用里启用
打开网页 → 底部"我的 / 设置" → 填写 **Project URL** 与 **anon key** → 点"保存配置"。
之后即可使用：
- **备份到云端**：把本地照片、相册上传到 Supabase。
- **从云端恢复**：把云端数据拉回本地浏览器（按 id 覆盖，可重复恢复）。

> 配置只保存在你本机浏览器（localStorage），不会上传。未填写时这两个按钮为置灰不可用状态。

---

## 六、常见问题

- **页面空白？** 请用本地服务器（方法 B）打开，不要用 `file://` 直接双击（部分浏览器限制模块）。
- **数据丢了？** 数据存于浏览器 IndexedDB，清空浏览器数据/换浏览器会导致丢失，重要资料请启用云同步备份。
- **上传失败？** 确认选择的是图片或视频文件；个别超大视频抽帧可能失败，但不影响原文件保存。
- **换电脑怎么办？** 启用云同步备份后，在新电脑登录同一网页、填写相同 Supabase 配置，点"从云端恢复"即可。

---

## 七、技术约束说明（给开发者）

- 纯静态、无 npm 构建；原生 ES Module，浏览器直接运行。
- 不依赖 React/Vue/Vite/Tailwind 等需要构建或联网的框架。
- Supabase SDK 仅在用户主动触发同步时通过 `import('https://esm.sh/@supabase/supabase-js@2')` 动态加载。
- 每个 `.js` 文件均通过 `node --check`（按 ES Module 语法）自检，确保无语法错误。
