// 云端同步模块

const DEFAULT_SYNC_CONFIG = {
  serverUrl: 'https://bookmark.wyzai.top/api',
  token: null,
  email: null,
  lastSyncAt: null,
  autoSync: true
};

// 获取同步配置
async function getSyncConfig() {
  const result = await chrome.storage.local.get(['syncConfig']);
  return result.syncConfig || DEFAULT_SYNC_CONFIG;
}

// 保存同步配置
async function saveSyncConfig(config) {
  await chrome.storage.local.set({ syncConfig: config });
}

// 检查是否已登录
async function isLoggedIn() {
  const config = await getSyncConfig();
  return !!config.token;
}

// 注册
async function register(serverUrl, email, password) {
  const response = await fetch(`${serverUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || '注册失败');
  }
  
  const data = await response.json();
  
  // 保存配置
  await saveSyncConfig({
    serverUrl,
    token: data.token,
    email: data.email,
    lastSyncAt: null,
    autoSync: true
  });
  
  return data;
}

// 登录
async function login(serverUrl, email, password) {
  const response = await fetch(`${serverUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || '登录失败');
  }
  
  const data = await response.json();
  
  // 保存配置
  await saveSyncConfig({
    serverUrl,
    token: data.token,
    email: data.email,
    lastSyncAt: null,
    autoSync: true
  });
  
  return data;
}

// 退出登录
async function logout() {
  await saveSyncConfig(DEFAULT_SYNC_CONFIG);
}

// 获取本地所有书签
async function getLocalBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  const bookmarks = [];
  
  function walk(nodes, folderPath = '') {
    for (const node of nodes) {
      if (node.url) {
        bookmarks.push({
          id: node.id,
          url: node.url,
          title: node.title || '',
          folderPath: folderPath,
          dateAdded: node.dateAdded || Date.now()
        });
      } else if (node.children) {
        const newPath = folderPath ? `${folderPath}/${node.title}` : (node.title || '');
        walk(node.children, newPath);
      }
    }
  }
  
  walk(tree);
  return bookmarks;
}

// 执行同步
async function performSync() {
  const config = await getSyncConfig();
  
  if (!config.token) {
    throw new Error('未登录');
  }
  
  // 获取本地书签
  const localBookmarks = await getLocalBookmarks();
  
  // 上传到服务器并获取合并结果
  const response = await fetch(`${config.serverUrl}/api/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.token}`
    },
    body: JSON.stringify({ bookmarks: localBookmarks })
  });
  
  if (!response.ok) {
    if (response.status === 401) {
      await logout();
      throw new Error('登录已过期，请重新登录');
    }
    const error = await response.json();
    throw new Error(error.detail || '同步失败');
  }
  
  const result = await response.json();
  
  // 更新最后同步时间
  config.lastSyncAt = result.last_sync_at;
  await saveSyncConfig(config);
  
  // 处理云端独有的书签（添加到本地）
  await mergeCloudBookmarks(result.bookmarks, localBookmarks);
  
  return result;
}

// 合并云端书签到本地
async function mergeCloudBookmarks(cloudBookmarks, localBookmarks) {
  const localUrls = new Set(localBookmarks.map(b => b.url));
  
  // 找出云端独有的书签
  const cloudOnly = cloudBookmarks.filter(b => b.url && !localUrls.has(b.url));
  
  if (cloudOnly.length === 0) return;
  
  // 获取或创建文件夹映射
  const folderMap = await getFolderMap();
  
  for (const bookmark of cloudOnly) {
    try {
      // 获取目标文件夹
      let parentId = '1'; // 默认书签栏
      
      if (bookmark.folderPath) {
        parentId = await ensureFolderPath(bookmark.folderPath, folderMap);
      }
      
      // 创建书签
      await chrome.bookmarks.create({
        parentId,
        title: bookmark.title,
        url: bookmark.url
      });
    } catch (e) {
      console.warn('添加云端书签失败:', bookmark.url, e);
    }
  }
}

// 获取文件夹映射
async function getFolderMap() {
  const tree = await chrome.bookmarks.getTree();
  const map = {};
  
  function walk(nodes, path = '') {
    for (const node of nodes) {
      if (!node.url && node.children) {
        const currentPath = path ? `${path}/${node.title}` : (node.title || '');
        if (currentPath) {
          map[currentPath] = node.id;
        }
        walk(node.children, currentPath);
      }
    }
  }
  
  walk(tree);
  return map;
}

// 确保文件夹路径存在
async function ensureFolderPath(folderPath, folderMap) {
  if (folderMap[folderPath]) {
    return folderMap[folderPath];
  }
  
  const parts = folderPath.split('/');
  let currentPath = '';
  let parentId = '1'; // 书签栏
  
  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    
    if (folderMap[currentPath]) {
      parentId = folderMap[currentPath];
    } else {
      // 创建文件夹
      const folder = await chrome.bookmarks.create({
        parentId,
        title: part
      });
      folderMap[currentPath] = folder.id;
      parentId = folder.id;
    }
  }
  
  return parentId;
}

// 获取同步状态
async function getSyncStatus() {
  const config = await getSyncConfig();
  
  if (!config.token) {
    return {
      loggedIn: false,
      email: null,
      lastSyncAt: null
    };
  }
  
  try {
    const response = await fetch(`${config.serverUrl}/api/status`, {
      headers: {
        'Authorization': `Bearer ${config.token}`
      }
    });
    
    if (!response.ok) {
      if (response.status === 401) {
        await logout();
        return { loggedIn: false, email: null, lastSyncAt: null };
      }
      throw new Error('获取状态失败');
    }
    
    const data = await response.json();
    return {
      loggedIn: true,
      email: config.email,
      lastSyncAt: config.lastSyncAt || data.last_sync_at,
      bookmarkCount: data.bookmark_count,
      syncCount: data.sync_count
    };
  } catch (e) {
    return {
      loggedIn: true,
      email: config.email,
      lastSyncAt: config.lastSyncAt,
      error: e.message
    };
  }
}

// 导出函数供其他脚本使用
if (typeof window !== 'undefined') {
  window.SyncModule = {
    getSyncConfig,
    saveSyncConfig,
    isLoggedIn,
    register,
    login,
    logout,
    performSync,
    getSyncStatus,
    getLocalBookmarks
  };
}
