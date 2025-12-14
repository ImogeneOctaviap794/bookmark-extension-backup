# 智能书签助手 - 项目架构与学习文档

## 📁 项目结构总览

```
bookmark-extension-backup/     ← Chrome 扩展 (前端)
├── manifest.json             # 扩展配置入口
├── popup.html/js             # 弹出窗口
├── options.html/js           # 设置页
├── background.js             # 后台服务 (定时任务)
├── sync.js                   # 云端同步模块
├── content.js                # 内容脚本 (注入网页)
├── sidebar.html              # 侧边栏
└── bookmarks.html/js         # 书签管理器

bookmark-sync/                 ← 后端服务
├── server/                   # FastAPI 后端
│   ├── main.py               # 应用入口
│   ├── config.py             # 配置管理
│   ├── models.py             # 数据库模型
│   ├── auth.py               # 认证模块
│   ├── sync.py               # 智能合并算法
│   └── routers/              # API 路由
│       ├── user.py           # 用户 API
│       ├── bookmark.py       # 书签 API
│       └── admin.py          # 管理 API
└── admin/                    # Vue 管理后台
    └── src/views/            # 页面组件
```

---

## 🔄 数据流架构图

```
┌─────────────────────────────────────────────────────────────┐
│                     Chrome 扩展                              │
├─────────────────────────────────────────────────────────────┤
│  popup.js ──→ 用户点击分析 ──→ AI API ──→ 生成书签名称       │
│     ↓                                                       │
│  sync.js ──→ 获取本地书签 ──→ 上传到服务器 ──→ 智能合并      │
│     ↓                                                       │
│  background.js ──→ 定时任务 (每24小时) ──→ 自动同步          │
└─────────────────────────────────────────────────────────────┘
                              ↓ HTTP API
┌─────────────────────────────────────────────────────────────┐
│                     FastAPI 后端                             │
├─────────────────────────────────────────────────────────────┤
│  /api/register, /api/login  ──→ auth.py (JWT认证)           │
│  /api/sync                  ──→ sync.py (智能合并)           │
│  /api/bookmarks             ──→ bookmark.py (书签CRUD)       │
│  /admin/*                   ──→ admin.py (管理接口)          │
└─────────────────────────────────────────────────────────────┘
                              ↓ SQLAlchemy
┌─────────────────────────────────────────────────────────────┐
│                     MySQL 数据库                             │
├─────────────────────────────────────────────────────────────┤
│  users      ──→ 用户信息、密码哈希、最后同步时间             │
│  bookmarks  ──→ 书签数据 (URL、标题、文件夹路径)             │
│  sync_logs  ──→ 同步历史记录                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 📄 扩展文件详解

### 1. `manifest.json` - 扩展配置入口

**作用**: Chrome 扩展的核心配置文件，定义权限、入口点、图标等。

```json
{
  "manifest_version": 3,        // Chrome 扩展 API 版本
  "permissions": [
    "bookmarks",                // 读写书签
    "activeTab",                // 访问当前标签页
    "scripting",                // 注入脚本到网页
    "storage",                  // 本地存储
    "downloads",                // 下载功能 (备份)
    "alarms"                    // 定时任务 (自动同步)
  ],
  "background": {
    "service_worker": "background.js"  // 后台脚本
  },
  "action": {
    "default_popup": "popup.html"      // 点击图标弹出
  }
}
```

**学习要点**:
- Manifest V3 是最新标准，使用 Service Worker 替代 Background Page
- `permissions` 声明扩展需要的能力
- `host_permissions: ["<all_urls>"]` 允许向任意网页注入脚本

---

### 2. `popup.js` - 弹出窗口逻辑

**作用**: 用户点击扩展图标时显示的主界面，提供 AI 分析和快速操作。

**核心函数**:

```javascript
// 1. 初始化
document.addEventListener('DOMContentLoaded', async () => {
  await loadApiConfig();         // 加载 API 配置
  await loadCurrentTab();        // 获取当前标签页信息
  await loadExistingFolders();   // 加载书签分类
  await loadSyncStatus();        // 加载同步状态
});

// 2. AI 分析当前页面
async function analyzeCurrentPage() {
  // 1) 通过 chrome.scripting 注入脚本到网页，提取内容
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: currentTab.id },
    func: () => {
      return {
        title: document.title,
        desc: document.querySelector('meta[name="description"]')?.content,
        // ... 提取更多内容
      };
    }
  });
  
  // 2) 调用 AI API 分析
  const response = await fetch(apiConfig.apiUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiConfig.apiKey}` },
    body: JSON.stringify({
      model: apiConfig.apiModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg }
      ]
    })
  });
  
  // 3) 解析 AI 返回的 JSON，显示建议
  const aiSuggestion = JSON.parse(content);
}

// 3. 保存书签
async function saveBookmark() {
  await chrome.bookmarks.create({
    parentId: folderId,
    title: bookmarkName,
    url: currentTab.url
  });
}
```

**学习要点**:
- `chrome.scripting.executeScript` 是 MV3 的脚本注入方式
- AI 分析使用 OpenAI 兼容 API 格式
- `chrome.bookmarks` API 操作浏览器书签

---

### 3. `sync.js` - 云端同步模块

**作用**: 封装所有云端同步相关功能，被 popup.js 和 options.js 调用。

**核心数据结构**:

```javascript
const DEFAULT_SYNC_CONFIG = {
  serverUrl: '',  // 后端地址（用户自行配置）
  token: null,                                // JWT token
  email: null,                                // 用户邮箱
  lastSyncAt: null,                           // 最后同步时间
  autoSync: true                              // 自动同步开关
};
```

**核心函数**:

```javascript
// 1. 注册/登录
async function register(serverUrl, email, password) {
  const response = await fetch(`${serverUrl}/api/register`, {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  // 保存 token 到 chrome.storage
  await saveSyncConfig({ token: data.token, ... });
}

// 2. 执行同步
async function performSync() {
  // 1) 获取本地所有书签
  const localBookmarks = await getLocalBookmarks();
  
  // 2) 上传到服务器，获取合并结果
  const response = await fetch(`${config.serverUrl}/api/sync`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${config.token}` },
    body: JSON.stringify({ bookmarks: localBookmarks })
  });
  
  // 3) 将云端独有的书签添加到本地
  await mergeCloudBookmarks(result.bookmarks, localBookmarks);
}

// 3. 获取本地书签 (递归遍历)
async function getLocalBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  function walk(nodes, folderPath = '') {
    for (const node of nodes) {
      if (node.url) {
        bookmarks.push({ url, title, folderPath });
      } else if (node.children) {
        walk(node.children, newPath);  // 递归
      }
    }
  }
  walk(tree);
}

// 导出为全局模块
window.SyncModule = { register, login, performSync, ... };
```

**学习要点**:
- 使用 `chrome.storage.local` 持久化配置
- 递归遍历书签树获取所有书签
- 双向同步：本地 → 云端 + 云端 → 本地

---

### 4. `background.js` - 后台服务

**作用**: Service Worker，处理定时任务和跨脚本通信。

```javascript
// 1. 设置定时任务 (扩展安装时)
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('bookmark-daily-sync', {
    delayInMinutes: 1,           // 安装后1分钟首次执行
    periodInMinutes: 60 * 24     // 之后每24小时执行
  });
});

// 2. 监听定时任务
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'bookmark-daily-sync') {
    await performAutoSync();
  }
});

// 3. 自动同步
async function performAutoSync() {
  // 检查登录状态和自动同步开关
  if (!config.token || !config.autoSync) return;
  
  // 获取本地书签，上传同步
  const localBookmarks = await getLocalBookmarks();
  await fetch(`${config.serverUrl}/api/sync`, { ... });
}

// 4. 跨脚本通信
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getBookmarks') {
    chrome.bookmarks.getTree().then(tree => {
      sendResponse({ bookmarks });
    });
    return true;  // 异步响应
  }
});
```

**学习要点**:
- `chrome.alarms` 实现定时任务
- Service Worker 是无状态的，需要每次从 storage 读取配置
- `return true` 保持消息通道开放，支持异步响应

---

### 5. `options.js` - 设置页逻辑

**作用**: 扩展设置页面，管理 API 配置、云端账号、备份等。

**主要功能模块**:

```javascript
// 1. Tab 切换
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

// 2. API 设置
async function saveApiSettings() {
  await chrome.storage.local.set({
    apiConfig: { apiUrl, apiKey, apiModel }
  });
}

// 3. 云端账号 (调用 SyncModule)
async function handleRegister() {
  await window.SyncModule.register(serverUrl, email, password);
}

async function handleSyncNow() {
  const result = await window.SyncModule.performSync();
  showToast(`同步完成: 新增${result.added}, 更新${result.updated}`);
}

// 4. 备份管理
async function exportBackup() {
  const tree = await chrome.bookmarks.getTree();
  const html = generateBookmarkHtml(tree);
  // 下载为 HTML 文件
  chrome.downloads.download({
    url: URL.createObjectURL(new Blob([html])),
    filename: `bookmarks_backup_${date}.html`
  });
}
```

---

## 📄 后端文件详解

### 1. `main.py` - 应用入口

**作用**: FastAPI 应用初始化，注册路由和中间件。

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Bookmark Sync API")

# CORS 允许跨域 (扩展需要)
app.add_middleware(CORSMiddleware, allow_origins=["*"], ...)

# 注册路由
app.include_router(user.router)      # /api/register, /api/login
app.include_router(bookmark.router)  # /api/sync, /api/bookmarks
app.include_router(admin.router)     # /admin/*

# 启动时初始化数据库和管理员账号
@app.on_event("startup")
async def startup():
    init_db()
    # 创建默认管理员...
```

---

### 2. `models.py` - 数据库模型

**作用**: 定义数据表结构 (ORM)。

```python
class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True)
    password_hash = Column(String(255))
    is_admin = Column(Boolean, default=False)
    status = Column(Enum(UserStatus))        # active/disabled
    last_sync_at = Column(DateTime)
    
    bookmarks = relationship("Bookmark", back_populates="user")

class Bookmark(Base):
    __tablename__ = "bookmarks"
    
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    url = Column(Text)
    title = Column(String(500))
    folder_path = Column(Text)               # 如 "工具/开发"
    deleted_at = Column(DateTime)            # 软删除

class SyncLog(Base):
    __tablename__ = "sync_logs"
    
    action = Column(Enum(SyncAction))        # upload/download/merge
    added = Column(Integer)
    updated = Column(Integer)
    deleted = Column(Integer)
```

**学习要点**:
- 使用 SQLAlchemy ORM
- `relationship` 定义表关联
- 软删除：`deleted_at` 不为空表示已删除

---

### 3. `auth.py` - 认证模块

**作用**: JWT Token 生成、验证、密码哈希。

```python
import jwt
import bcrypt

# 密码哈希 (使用 bcrypt)
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt()).decode()

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode()[:72], hashed.encode())

# JWT Token
def create_token(user_id: int, email: str, is_admin: bool) -> str:
    payload = {
        "sub": str(user_id),
        "email": email,
        "is_admin": is_admin,
        "exp": datetime.utcnow() + timedelta(hours=720)  # 30天
    }
    return jwt.encode(payload, settings.JWT_SECRET)

# 依赖注入：获取当前用户
async def get_current_user(credentials, db) -> User:
    token = credentials.credentials
    payload = jwt.decode(token, settings.JWT_SECRET)
    user = db.query(User).filter(User.id == payload["sub"]).first()
    return user
```

**学习要点**:
- bcrypt 是安全的密码哈希算法
- JWT 无状态认证，Token 包含用户信息
- FastAPI Depends 实现依赖注入

---

### 4. `sync.py` - 智能合并算法 ⭐

**作用**: 核心同步逻辑，实现双向无损合并。

```python
def smart_merge(db, user_id, local_bookmarks) -> SyncResult:
    """
    智能合并策略:
    - 新增: 云端/本地独有 → 保留
    - 修改: 同 URL 不同标题 → 取最新
    - 删除: 本地标记删除 → 云端也删除
    """
    
    # 1. 获取云端书签，建立 URL 索引
    cloud_bookmarks = db.query(Bookmark).filter(user_id=user_id).all()
    cloud_by_url = {bm.url: bm for bm in cloud_bookmarks}
    
    # 2. 处理本地书签
    for local_bm in local_bookmarks:
        url = local_bm["url"]
        
        if url in cloud_by_url:
            # 已存在 → 比较更新时间
            cloud_bm = cloud_by_url[url]
            if local_bm["dateAdded"] > cloud_bm.updated_at:
                cloud_bm.title = local_bm["title"]  # 更新
        else:
            # 本地独有 → 添加到云端
            db.add(Bookmark(url=url, title=local_bm["title"], ...))
    
    # 3. 返回合并后的完整书签列表
    return result
```

**学习要点**:
- 以 URL 为唯一键判断书签是否相同
- 时间戳比较决定保留哪个版本
- 软删除避免数据丢失

---

## 🔑 核心概念总结

| 概念 | 说明 |
|------|------|
| **Manifest V3** | Chrome 扩展最新标准，使用 Service Worker |
| **Service Worker** | 无状态后台脚本，按需唤醒 |
| **chrome.storage** | 扩展本地存储 API |
| **chrome.bookmarks** | 书签操作 API |
| **chrome.scripting** | 脚本注入 API (MV3) |
| **JWT** | 无状态认证 Token |
| **SQLAlchemy** | Python ORM 库 |
| **FastAPI** | Python 异步 Web 框架 |
| **智能合并** | 双向同步，无数据丢失 |

---

## � Chrome API 使用详解

### 1. `chrome.bookmarks` - 书签操作

```javascript
// 📍 位置: popup.js, sync.js, options.js

// 获取完整书签树
const tree = await chrome.bookmarks.getTree();
// 返回: [{ id: "0", children: [{ id: "1", title: "书签栏", children: [...] }] }]

// 创建书签
const newBookmark = await chrome.bookmarks.create({
  parentId: "1",           // 父文件夹ID，"1"是书签栏
  title: "我的网站",
  url: "https://example.com"
});

// 创建文件夹 (不传url就是文件夹)
const folder = await chrome.bookmarks.create({
  parentId: "1",
  title: "我的分类"
});

// 更新书签
await chrome.bookmarks.update("123", {
  title: "新标题",
  url: "https://new-url.com"
});

// 删除书签
await chrome.bookmarks.remove("123");

// 移动书签到其他文件夹
await chrome.bookmarks.move("123", { parentId: "456" });

// 搜索书签
const results = await chrome.bookmarks.search("github");
// 返回: [{ id, title, url, ... }, ...]
```

**项目实际使用** (`@/Users/yinghua/Documents/fly/bookmark-extension-backup/sync.js:88-111`):
```javascript
async function getLocalBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  const bookmarks = [];
  
  function walk(nodes, folderPath = '') {
    for (const node of nodes) {
      if (node.url) {
        // 是书签
        bookmarks.push({ url: node.url, title: node.title, folderPath });
      } else if (node.children) {
        // 是文件夹，递归
        walk(node.children, `${folderPath}/${node.title}`);
      }
    }
  }
  walk(tree);
  return bookmarks;
}
```

---

### 2. `chrome.storage` - 本地存储

```javascript
// 📍 位置: sync.js, options.js, popup.js

// 保存数据
await chrome.storage.local.set({
  apiConfig: { apiUrl: "...", apiKey: "..." },
  syncConfig: { token: "...", email: "..." }
});

// 读取数据
const result = await chrome.storage.local.get(['apiConfig', 'syncConfig']);
console.log(result.apiConfig);  // { apiUrl, apiKey }
console.log(result.syncConfig); // { token, email }

// 读取所有数据
const all = await chrome.storage.local.get(null);

// 删除数据
await chrome.storage.local.remove(['apiConfig']);

// 清空所有
await chrome.storage.local.clear();

// 监听变化
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.syncConfig) {
    console.log('同步配置已更新:', changes.syncConfig.newValue);
  }
});
```

**项目实际使用** (`@/Users/yinghua/Documents/fly/bookmark-extension-backup/sync.js:11-20`):
```javascript
async function getSyncConfig() {
  const result = await chrome.storage.local.get(['syncConfig']);
  return result.syncConfig || DEFAULT_SYNC_CONFIG;
}

async function saveSyncConfig(config) {
  await chrome.storage.local.set({ syncConfig: config });
}
```

---

### 3. `chrome.scripting` - 脚本注入

```javascript
// 📍 位置: popup.js

// 在当前页面执行脚本，提取内容
const [result] = await chrome.scripting.executeScript({
  target: { tabId: currentTab.id },
  func: () => {
    // 这段代码在网页中执行！
    return {
      title: document.title,
      desc: document.querySelector('meta[name="description"]')?.content,
      h1: document.querySelector('h1')?.textContent,
      text: document.body.innerText.slice(0, 500)
    };
  }
});

const pageContent = result.result;
console.log(pageContent.title);  // 网页标题
```

**带参数的脚本注入**:
```javascript
const [result] = await chrome.scripting.executeScript({
  target: { tabId },
  func: (selector) => {
    return document.querySelector(selector)?.textContent;
  },
  args: ['h1']  // 传参
});
```

**项目实际使用** (`@/Users/yinghua/Documents/fly/bookmark-extension-backup/popup.js:140-165`):
```javascript
const [result] = await chrome.scripting.executeScript({
  target: { tabId: currentTab.id },
  func: () => {
    const title = document.title || '';
    const desc = document.querySelector('meta[name="description"]')?.content || '';
    const keywords = document.querySelector('meta[name="keywords"]')?.content || '';
    const h1 = document.querySelector('h1')?.textContent || '';
    
    // 提取正文 (移除干扰元素)
    const body = document.body.cloneNode(true);
    ['script', 'style', 'nav', 'footer'].forEach(tag => {
      body.querySelectorAll(tag).forEach(el => el.remove());
    });
    const text = body.textContent?.replace(/\s+/g, ' ').trim().slice(0, 500);
    
    return { title, desc, keywords, h1, text };
  }
});
```

---

### 4. `chrome.tabs` - 标签页操作

```javascript
// 📍 位置: popup.js

// 获取当前激活的标签页
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
console.log(tab.url);    // 当前网址
console.log(tab.title);  // 当前标题
console.log(tab.id);     // 标签页ID (用于脚本注入)

// 打开新标签页
await chrome.tabs.create({ url: 'https://example.com' });

// 更新当前标签页
await chrome.tabs.update(tabId, { url: 'https://new-url.com' });

// 关闭标签页
await chrome.tabs.remove(tabId);
```

**项目实际使用** (`@/Users/yinghua/Documents/fly/bookmark-extension-backup/popup.js:66-74`):
```javascript
async function loadCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  
  // 显示当前页面信息
  document.getElementById('currentTitle').textContent = tab.title || '无标题';
  document.getElementById('currentUrl').textContent = tab.url || '';
}
```

---

### 5. `chrome.alarms` - 定时任务

```javascript
// 📍 位置: background.js

// 创建定时任务
chrome.alarms.create('auto-sync', {
  delayInMinutes: 1,        // 首次延迟1分钟
  periodInMinutes: 60 * 24  // 之后每24小时执行
});

// 创建一次性任务
chrome.alarms.create('one-time-task', {
  when: Date.now() + 60000  // 1分钟后执行一次
});

// 监听任务触发
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'auto-sync') {
    performAutoSync();
  }
});

// 获取所有任务
const alarms = await chrome.alarms.getAll();

// 清除任务
await chrome.alarms.clear('auto-sync');
await chrome.alarms.clearAll();
```

**项目实际使用** (`@/Users/yinghua/Documents/fly/bookmark-extension-backup/background.js`):
```javascript
// 扩展安装时设置定时任务
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('bookmark-daily-sync', {
    delayInMinutes: 1,
    periodInMinutes: 60 * 24  // 每24小时
  });
});

// 定时任务触发时执行同步
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'bookmark-daily-sync') {
    const config = await getSyncConfig();
    if (config.token && config.autoSync) {
      await performAutoSync();
    }
  }
});
```

---

### 6. `chrome.downloads` - 下载文件

```javascript
// 📍 位置: options.js

// 下载文件
const downloadId = await chrome.downloads.download({
  url: 'https://example.com/file.zip',
  filename: 'my-file.zip',        // 保存文件名
  saveAs: true                     // 弹出保存对话框
});

// 下载 Blob 数据 (如备份文件)
const htmlContent = '<html>...</html>';
const blob = new Blob([htmlContent], { type: 'text/html' });
const url = URL.createObjectURL(blob);

await chrome.downloads.download({
  url: url,
  filename: `bookmarks_backup_${Date.now()}.html`
});

// 下载完成后释放
URL.revokeObjectURL(url);
```

**项目实际使用** (`@/Users/yinghua/Documents/fly/bookmark-extension-backup/options.js` 备份功能):
```javascript
async function exportBackup() {
  const tree = await chrome.bookmarks.getTree();
  const html = generateBookmarkHtml(tree);  // 生成 HTML
  
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  
  await chrome.downloads.download({
    url: url,
    filename: `bookmarks_backup_${new Date().toISOString().slice(0,10)}.html`,
    saveAs: true
  });
}
```

---

### 7. `chrome.runtime` - 扩展运行时

```javascript
// 📍 位置: background.js, popup.js

// 扩展安装/更新时触发
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('首次安装');
  } else if (details.reason === 'update') {
    console.log('版本更新到:', chrome.runtime.getManifest().version);
  }
});

// 跨脚本通信 - 发送消息
chrome.runtime.sendMessage({ action: 'getBookmarks' }, (response) => {
  console.log('收到响应:', response);
});

// 跨脚本通信 - 接收消息 (background.js)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getBookmarks') {
    chrome.bookmarks.getTree().then(tree => {
      sendResponse({ bookmarks: tree });
    });
    return true;  // 重要！表示异步响应
  }
});

// 获取扩展信息
const manifest = chrome.runtime.getManifest();
console.log(manifest.version);  // "1.3.0"
```

---

## �🚀 开发调试技巧

### 扩展调试
```
1. chrome://extensions/ → 开发者模式
2. 加载已解压的扩展程序
3. 右键扩展图标 → 检查弹出内容 (DevTools)
4. 查看 Service Worker 日志
```

### 后端调试
```bash
cd bookmark-sync/server
uvicorn main:app --reload --port 8000

# API 文档
http://localhost:8000/docs
```

### 常用 Chrome API
```javascript
// 获取书签树
chrome.bookmarks.getTree()

// 创建书签
chrome.bookmarks.create({ parentId, title, url })

// 本地存储
chrome.storage.local.get(['key'])
chrome.storage.local.set({ key: value })

// 注入脚本
chrome.scripting.executeScript({ target: { tabId }, func })

// 定时任务
chrome.alarms.create('name', { periodInMinutes: 60 })
```

---

## 📚 推荐学习资源

1. **Chrome 扩展开发**
   - https://developer.chrome.com/docs/extensions/mv3/

2. **FastAPI 官方文档**
   - https://fastapi.tiangolo.com/zh/

3. **SQLAlchemy ORM**
   - https://docs.sqlalchemy.org/

4. **JWT 认证**
   - https://jwt.io/
