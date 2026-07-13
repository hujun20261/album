# 百度网盘云同步功能已添加

## 已完成的修改

### 1. 新增文件

#### `baidu-sync.js` (13KB)
百度网盘 XPan API 完整封装：
- **OAuth 授权**：`getAuthUrl()`, `parseTokenFromHash()`
- **配置管理**：`saveBaiduConfig()`, `loadBaiduConfig()`, `isConfigured()`, `isAuthorized()`
- **文件操作**：`uploadFile()`, `downloadFile()`, `listFiles()`, `deleteFile()`
- **同步功能**：`backupToBaidu()`, `restoreFromBaidu()`

#### `callback.html` (3.2KB)
百度网盘 OAuth 授权回调页面：
- 解析 URL hash 中的 access_token
- 自动保存到 localStorage
- 通知父窗口授权成功

### 2. 修改文件

#### `app.js`
- 添加百度网盘模块导入
- `renderSettings()` 函数新增：
  - 百度网盘授权状态显示
  - App Key / 回调地址配置
  - 授权登录 / 退出登录按钮
  - 备份到百度网盘 / 从百度网盘恢复按钮
- Supabase 配置折叠到"高级选项"

#### `styles.css`
- 新增 `.baidu-status` 样式（授权状态卡片）
- 新增 `.advanced-section` 样式（折叠的高级选项）

#### `index.html`
- 添加隐藏 iframe 用于授权回调

## 使用说明

### 1. 申请百度网盘 API

1. 访问 [百度网盘开放平台](https://pan.baidu.com/union/doc/0ksg0sbig)
2. 创建应用，获取 **App Key**
3. 配置回调地址：`https://hujun20261.github.io/album/callback.html`

### 2. 在相册中配置

1. 打开相册 → **设置**
2. 填写 App Key（回调地址已预设）
3. 点击 **授权登录** → 在弹窗中登录百度账号
4. 授权成功后即可使用备份/恢复功能

### 3. 数据存储位置

所有数据存储在你的百度网盘 `/apps/私密相册/` 目录下：
```
/apps/私密相册/
├── albums.json          # 相册列表
├── photos/              # 照片/视频原图
│   ├── {id}.jpg
│   └── {id}.mp4
└── meta/                # 照片元数据
    └── {id}.json
```

## 手动推送步骤

需要 GitHub Token 来推送代码。你可以：

### 方法 1：提供 GitHub Token
告诉我你的 GitHub Personal Access Token（需要 `repo` 权限）

### 方法 2：手动推送
```bash
cd /home/node/.openclaw/workspace-agent-0df5e0a1/album-static

# 方式 A：使用 SSH（如果已配置）
git remote set-url origin git@github.com:hujun20261/album.git
git push origin main

# 方式 B：使用 Token
git remote set-url origin https://<YOUR_TOKEN>@github.com/hujun20261/album.git
git push origin main
```

## 临时预览

如果需要立即查看效果，我可以启动本地服务器给你一个临时访问链接。
