// Default API config (OpenAI compatible)
const DEFAULT_CONFIG = {
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  apiKey: 'sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  apiModel: 'gpt-4o-mini'
};

// 当前配置
let apiConfig = null;

// 当前页面信息
let currentTab = null;
let existingFolders = [];
let aiSuggestion = null;

// 加载API配置
async function loadApiConfig() {
  const result = await chrome.storage.local.get(['apiConfig']);
  apiConfig = result.apiConfig || DEFAULT_CONFIG;
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  await loadApiConfig();
  await loadCurrentTab();
  await loadExistingFolders();
  await loadSyncStatus();
  
  // 绑定事件监听器（避免CSP问题）
  document.getElementById('analyzeBtn').addEventListener('click', analyzeCurrentPage);
  document.getElementById('saveBtn').addEventListener('click', saveBookmark);
  document.getElementById('cancelBtn').addEventListener('click', () => window.close());
  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  
  // 侧边栏按钮
  document.getElementById('sidebarBtn').addEventListener('click', async () => {
    // 关闭 popup，然后打开侧边栏
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.runtime.sendMessage({ action: 'openSidebar', tabId: tab.id });
    }
    window.close();
  });
  
  // 快速同步按钮
  document.getElementById('quickSyncBtn').addEventListener('click', handleQuickSync);
});

// 获取当前标签页信息
async function loadCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;
    
    document.getElementById('pageTitle').textContent = tab.title || '无标题';
    document.getElementById('pageUrl').textContent = tab.url || '-';
    document.getElementById('bookmarkName').value = tab.title || '';
  } catch (e) {
    console.error('获取标签页失败:', e);
    showToast('获取页面信息失败', 'error');
  }
}

// 加载现有书签文件夹
async function loadExistingFolders() {
  try {
    const tree = await chrome.bookmarks.getTree();
    existingFolders = [];
    
    // 递归提取所有文件夹
    function extractFolders(nodes, depth = 0) {
      for (const node of nodes) {
        if (node.children) {
          // 跳过根节点
          if (node.id !== '0') {
            existingFolders.push({
              id: node.id,
              title: node.title || '书签栏',
              depth: depth,
              count: node.children.filter(c => c.url).length
            });
          }
          extractFolders(node.children, depth + 1);
        }
      }
    }
    
    extractFolders(tree);
    
    // 更新下拉框
    const select = document.getElementById('bookmarkFolder');
    select.innerHTML = '';
    
    // 添加默认选项
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = '-- 选择分类 --';
    select.appendChild(defaultOpt);
    
    // 添加文件夹选项
    for (const folder of existingFolders) {
      const opt = document.createElement('option');
      opt.value = folder.id;
      const indent = '  '.repeat(Math.max(0, folder.depth - 1));
      opt.textContent = `${indent}${folder.title} (${folder.count})`;
      select.appendChild(opt);
    }
    
    document.getElementById('folderCount').textContent = 
      `共 ${existingFolders.length} 个分类`;
    
  } catch (e) {
    console.error('加载书签失败:', e);
    showToast('加载书签失败', 'error');
  }
}

// AI分析当前页面
async function analyzeCurrentPage() {
  if (!currentTab) {
    showToast('无法获取当前页面', 'error');
    return;
  }
  
  const btn = document.getElementById('analyzeBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>分析中...';
  
  try {
    // 获取页面内容
    let pageContent = { title: currentTab.title || '', desc: '', keywords: '', h1: '', text: '' };
    
    // 检查是否是可注入脚本的页面
    const url = currentTab.url || '';
    const isRestrictedPage = url.startsWith('chrome://') || 
                             url.startsWith('edge://') || 
                             url.startsWith('chrome-extension://') ||
                             url.startsWith('moz-extension://') ||
                             url.startsWith('about:') ||
                             url.startsWith('file://');
    
    if (!isRestrictedPage) {
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: currentTab.id },
          func: () => {
            const title = document.title || '';
            const desc = document.querySelector('meta[name="description"]')?.content || '';
            const keywords = document.querySelector('meta[name="keywords"]')?.content || '';
            const h1 = document.querySelector('h1')?.textContent || '';
            
            // 获取主要文本
            const body = document.body.cloneNode(true);
            ['script', 'style', 'nav', 'footer', 'header', 'aside'].forEach(tag => {
              body.querySelectorAll(tag).forEach(el => el.remove());
            });
            const text = body.textContent?.replace(/\s+/g, ' ').trim().slice(0, 500) || '';
            
            return { title, desc, keywords, h1, text };
          }
        });
        pageContent = result.result;
        console.log('抓取到的页面内容:', pageContent);
      } catch (e) {
        console.warn('无法获取页面内容，使用基本信息:', e.message);
        // 保持默认值，不报错
      }
    } else {
      console.log('特殊页面，跳过内容抓取');
    }
    
    // 构建分析内容
    const folderNames = existingFolders.map(f => f.title).join(', ');
    
    const systemPrompt = `你是书签整理专家。仔细分析网页信息，提取核心价值，生成有意义的书签名称。

用户已有分类: ${folderNames}

## 核心原则
**从 title 和 description 中深度提取信息！** 很多网站的 title 包含丰富描述：
- GitHub: "GitHub - user/repo: 项目描述" → 提取"项目描述"作为核心
- 文档: "章节名 | 项目名" → 组合成"项目名 - 章节名"

## 命名要求
1. 长度: 15-35字符，信息密度高
2. 必须体现页面的**核心价值/用途**，不能只是"项目主页"这种空泛描述
3. 示例:
   - ❌ "BettaFish - GitHub项目主页" (太空泛)
   - ✅ "微舆 - 多Agent舆情分析助手" (体现用途)
   - ❌ "ScriptCat - 更新日志" (缺少版本)
   - ✅ "ScriptCat v1.2.1 更新日志" (完整)

## 分类规则
优先匹配已有分类；无合适则建议新分类

## 输出
严格JSON: {"name": "书签名称", "category": "分类名", "isNew": false}`;

    const userMsg = `URL: ${currentTab.url}
Page title: ${pageContent.title}
Description: ${pageContent.desc}
Keywords: ${pageContent.keywords}
H1: ${pageContent.h1}
Content preview: ${pageContent.text}`;

    // 调用AI（使用配置的API）
    const response = await fetch(apiConfig.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiConfig.apiKey}`
      },
      body: JSON.stringify({
        model: apiConfig.apiModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMsg }
        ],
        temperature: 0.3,
        max_tokens: 200
      })
    });
    
    if (!response.ok) {
      throw new Error('API请求失败');
    }
    
    const data = await response.json();
    const content = data.choices[0].message.content;
    
    // 解析JSON
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}') + 1;
    if (start >= 0 && end > start) {
      aiSuggestion = JSON.parse(content.slice(start, end));
      
      // 显示结果
      document.getElementById('aiResult').classList.add('show');
      document.getElementById('suggestedName').textContent = aiSuggestion.name;
      document.getElementById('suggestedCategory').textContent = 
        aiSuggestion.category + (aiSuggestion.isNew ? ' (新建)' : '');
      
      // 自动填充
      document.getElementById('bookmarkName').value = aiSuggestion.name;
      
      // 自动选择分类
      const select = document.getElementById('bookmarkFolder');
      const matchFolder = existingFolders.find(f => 
        f.title === aiSuggestion.category || 
        f.title.includes(aiSuggestion.category) ||
        aiSuggestion.category.includes(f.title.replace(/^[^\w\u4e00-\u9fa5]+/, ''))
      );
      
      if (matchFolder) {
        select.value = matchFolder.id;
      }
      
      showToast('分析完成', 'success');
    } else {
      throw new Error('解析AI响应失败');
    }
    
  } catch (e) {
    console.error('分析失败:', e);
    showToast('分析失败: ' + e.message, 'error');
  }
  
  btn.disabled = false;
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
  </svg>AI 智能分析`;
}

// 保存书签
async function saveBookmark() {
  const name = document.getElementById('bookmarkName').value.trim();
  const folderId = document.getElementById('bookmarkFolder').value;
  
  if (!name) {
    showToast('请输入书签名称', 'error');
    return;
  }
  
  if (!folderId) {
    showToast('请选择分类', 'error');
    return;
  }
  
  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>保存中...';
  
  try {
    // 检查是否已存在
    const existing = await chrome.bookmarks.search({ url: currentTab.url });
    if (existing.length > 0) {
      showToast('该网址已存在书签中', 'error');
      btn.disabled = false;
      btn.textContent = '添加书签';
      return;
    }
    
    // 创建书签
    await chrome.bookmarks.create({
      parentId: folderId,
      title: name,
      url: currentTab.url
    });
    
    showToast('书签添加成功！', 'success');
    
    // 延迟关闭
    setTimeout(() => window.close(), 1500);
    
  } catch (e) {
    console.error('保存失败:', e);
    showToast('保存失败: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = '添加书签';
  }
}

// 显示提示
function showToast(message, type = 'info', duration = 1500) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast show ' + type;
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

// 加载同步状态
async function loadSyncStatus() {
  try {
    const status = await window.SyncModule.getSyncStatus();
    const statusDiv = document.getElementById('syncStatus');
    
    if (status.loggedIn) {
      statusDiv.style.display = 'flex';
      document.getElementById('syncEmail').textContent = status.email || '-';
      
      if (status.lastSyncAt) {
        // 添加 'Z' 后缀表示 UTC 时间，确保正确转换为本地时间
        const lastSync = new Date(status.lastSyncAt + 'Z');
        const now = new Date();
        const diffMs = now - lastSync;
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffHours / 24);
        
        let timeText;
        if (diffDays > 0) {
          timeText = `${diffDays}天前同步`;
        } else if (diffHours > 0) {
          timeText = `${diffHours}小时前同步`;
        } else {
          const diffMins = Math.floor(diffMs / (1000 * 60));
          timeText = diffMins > 0 ? `${diffMins}分钟前同步` : '刚刚同步';
        }
        document.getElementById('syncTime').textContent = timeText;
      } else {
        document.getElementById('syncTime').textContent = '未同步';
      }
    } else {
      statusDiv.style.display = 'none';
    }
  } catch (e) {
    console.error('加载同步状态失败:', e);
  }
}

// 快速同步
async function handleQuickSync() {
  const btn = document.getElementById('quickSyncBtn');
  btn.classList.add('syncing');
  btn.disabled = true;
  
  try {
    await window.SyncModule.performSync();
    showToast('同步成功！', 'success');
    await loadSyncStatus();
  } catch (e) {
    showToast(e.message || '同步失败', 'error');
  } finally {
    btn.classList.remove('syncing');
    btn.disabled = false;
  }
}
