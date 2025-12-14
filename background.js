// Background Service Worker

// 导入同步模块配置
const SYNC_ALARM_NAME = 'bookmark-daily-sync';

// 初始化定时任务
chrome.runtime.onInstalled.addListener(() => {
  // 设置每天同步一次的定时任务
  chrome.alarms.create(SYNC_ALARM_NAME, {
    delayInMinutes: 1, // 安装后1分钟首次检查
    periodInMinutes: 60 * 24 // 每24小时
  });
  console.log('书签同步定时任务已设置');
});

// 监听定时任务
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SYNC_ALARM_NAME) {
    await performAutoSync();
  }
});

// 执行自动同步
async function performAutoSync() {
  try {
    const result = await chrome.storage.local.get(['syncConfig']);
    const config = result.syncConfig;
    
    // 检查是否已登录且开启自动同步
    if (!config || !config.token || config.autoSync === false) {
      console.log('自动同步已跳过：未登录或未开启');
      return;
    }
    
    // 检查上次同步时间，避免重复同步
    if (config.lastSyncAt) {
      const lastSync = new Date(config.lastSyncAt);
      const now = new Date();
      const hoursSinceLastSync = (now - lastSync) / (1000 * 60 * 60);
      
      if (hoursSinceLastSync < 20) { // 20小时内已同步过则跳过
        console.log('自动同步已跳过：距上次同步不足20小时');
        return;
      }
    }
    
    console.log('开始自动同步...');
    
    // 获取本地书签
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
    
    // 上传同步
    const response = await fetch(`${config.serverUrl}/api/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`
      },
      body: JSON.stringify({ bookmarks })
    });
    
    if (response.ok) {
      const data = await response.json();
      config.lastSyncAt = data.last_sync_at;
      await chrome.storage.local.set({ syncConfig: config });
      console.log('自动同步完成:', data);
    } else {
      console.error('自动同步失败:', response.status);
    }
    
  } catch (e) {
    console.error('自动同步错误:', e);
  }
}

// 监听来自 popup / content script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'openSidebar' && message.tabId) {
    openSidebarInTab(message.tabId);
    sendResponse({ success: true });
  }
  
  // 获取书签数据（content script 无法直接访问 bookmarks API）
  if (message.action === 'getBookmarks') {
    chrome.bookmarks.getTree().then(tree => {
      const bookmarks = [];
      function walk(nodes, folder = '') {
        for (const n of nodes) {
          if (n.url) {
            bookmarks.push({ title: n.title || '', url: n.url, folder });
          } else if (n.children) {
            walk(n.children, n.title || folder);
          }
        }
      }
      walk(tree);
      sendResponse({ bookmarks });
    }).catch(err => {
      sendResponse({ error: err.message });
    });
    return true; // 异步响应
  }
  
  return true;
});

// 在指定标签页打开侧边栏
async function openSidebarInTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    
    // 检查是否是特殊页面
    if (tab.url.startsWith('chrome://') || 
        tab.url.startsWith('edge://') || 
        tab.url.startsWith('about:') ||
        tab.url.startsWith('chrome-extension://')) {
      chrome.tabs.create({ url: chrome.runtime.getURL('bookmarks.html') });
      return;
    }
    
    // 尝试发送消息
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'toggleSidebar' });
    } catch (e) {
      // 注入脚本
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });
      
      await chrome.scripting.insertCSS({
        target: { tabId: tabId },
        files: ['sidebar.css']
      });
      
      setTimeout(async () => {
        await chrome.tabs.sendMessage(tabId, { action: 'toggleSidebar' });
      }, 100);
    }
  } catch (err) {
    console.error('打开侧边栏失败:', err);
    chrome.tabs.create({ url: chrome.runtime.getURL('bookmarks.html') });
  }
}

// 点击扩展图标时（如果没有 popup）
chrome.action.onClicked.addListener(async (tab) => {
  // 检查是否是特殊页面
  if (tab.url.startsWith('chrome://') || 
      tab.url.startsWith('edge://') || 
      tab.url.startsWith('about:') ||
      tab.url.startsWith('chrome-extension://')) {
    // 特殊页面无法注入内容脚本，打开 popup
    // 这里可以打开设置页或者显示提示
    chrome.tabs.create({ url: chrome.runtime.getURL('bookmarks.html') });
    return;
  }
  
  try {
    // 先尝试发送消息给已有的 content script
    await chrome.tabs.sendMessage(tab.id, { action: 'toggleSidebar' });
  } catch (e) {
    // content script 还没注入，先注入再发送消息
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['sidebar.css']
      });
      
      // 等待一下再发送消息
      setTimeout(async () => {
        await chrome.tabs.sendMessage(tab.id, { action: 'toggleSidebar' });
      }, 100);
    } catch (err) {
      console.error('无法注入脚本:', err);
      // 降级方案：打开书签管理器
      chrome.tabs.create({ url: chrome.runtime.getURL('bookmarks.html') });
    }
  }
});

// 监听快捷键
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-sidebar') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.action.onClicked.dispatch(tab);
    }
  }
});
