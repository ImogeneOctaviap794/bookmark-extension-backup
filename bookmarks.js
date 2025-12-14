// 书签管理器

// Default API config (OpenAI compatible)
const DEFAULT_CONFIG = {
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  apiKey: 'sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  apiModel: 'gpt-4o-mini'
};

let allBookmarks = [];
let allFolders = [];
let currentFolderId = null;
let currentView = 'list'; // list | grid
let searchQuery = '';
let currentEditBookmark = null;
let currentAiSuggestion = null;
let confirmCallback = null;

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  await loadBookmarks();
  bindEvents();
});

// 绑定事件
function bindEvents() {
  // 搜索
  document.getElementById('searchInput').addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    renderBookmarks();
  });
  
  // 刷新
  document.getElementById('refreshBtn').addEventListener('click', loadBookmarks);
  
  // 设置
  document.getElementById('optionsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  
  // 视图切换
  document.getElementById('listViewBtn').addEventListener('click', () => {
    currentView = 'list';
    document.getElementById('listViewBtn').classList.add('active');
    document.getElementById('gridViewBtn').classList.remove('active');
    renderBookmarks();
  });
  
  document.getElementById('gridViewBtn').addEventListener('click', () => {
    currentView = 'grid';
    document.getElementById('gridViewBtn').classList.add('active');
    document.getElementById('listViewBtn').classList.remove('active');
    renderBookmarks();
  });
  
  // 书签列表事件委托（只绑定一次）
  const bookmarkList = document.getElementById('bookmarkList');
  
  bookmarkList.addEventListener('click', handleBookmarkAction);
  
  bookmarkList.addEventListener('dblclick', (e) => {
    const item = e.target.closest('.bookmark-item');
    if (item && !e.target.closest('.action-btn')) {
      openBookmark(item.dataset.id);
    }
  });
  
  // 编辑弹窗事件
  document.getElementById('editModalClose').addEventListener('click', closeEditModal);
  document.getElementById('editModalCancel').addEventListener('click', closeEditModal);
  document.getElementById('editModalSave').addEventListener('click', saveEditBookmark);
  document.getElementById('aiAnalyzeBtn').addEventListener('click', aiAnalyzeBookmark);
  document.getElementById('applyAiSuggest').addEventListener('click', applyAiSuggestion);
  
  // 确认弹窗事件
  document.getElementById('confirmCancel').addEventListener('click', closeConfirmModal);
  document.getElementById('confirmOk').addEventListener('click', () => {
    if (confirmCallback) confirmCallback();
    closeConfirmModal();
  });
}

// 加载书签
async function loadBookmarks() {
  try {
    const tree = await chrome.bookmarks.getTree();
    allBookmarks = [];
    allFolders = [];
    
    // 递归遍历
    function traverse(nodes, depth = 0, parentPath = '') {
      for (const node of nodes) {
        const path = parentPath ? `${parentPath} / ${node.title}` : node.title;
        
        if (node.url) {
          // 书签
          allBookmarks.push({
            id: node.id,
            title: node.title || '未命名',
            url: node.url,
            parentId: node.parentId,
            dateAdded: node.dateAdded
          });
        } else if (node.children) {
          // 文件夹
          if (node.id !== '0') {
            const bookmarkCount = countBookmarks(node);
            allFolders.push({
              id: node.id,
              title: node.title || '书签栏',
              depth: depth,
              path: path,
              count: bookmarkCount,
              children: node.children.filter(c => !c.url).map(c => c.id)
            });
          }
          traverse(node.children, depth + 1, path);
        }
      }
    }
    
    // 计算书签数量
    function countBookmarks(node) {
      let count = 0;
      if (node.children) {
        for (const child of node.children) {
          if (child.url) count++;
          else count += countBookmarks(child);
        }
      }
      return count;
    }
    
    traverse(tree);
    
    // 更新统计
    document.getElementById('headerStats').textContent = 
      `${allBookmarks.length} 个书签 · ${allFolders.length} 个文件夹`;
    
    // 渲染
    renderFolderTree();
    renderBookmarks();
    
  } catch (e) {
    console.error('加载书签失败:', e);
    showToast('加载书签失败', 'error');
  }
}

// 渲染文件夹树
function renderFolderTree() {
  const container = document.getElementById('folderTree');
  
  // 添加"所有书签"选项
  let html = `
    <div class="folder-item ${currentFolderId === null ? 'active' : ''}" data-folder-id="all">
      <svg class="folder-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
      </svg>
      <span class="folder-name">所有书签</span>
      <span class="folder-count">${allBookmarks.length}</span>
    </div>
  `;
  
  // 渲染文件夹
  for (const folder of allFolders) {
    const indent = folder.depth > 0 ? `margin-left: ${(folder.depth - 1) * 16}px` : '';
    html += `
      <div class="folder-item ${currentFolderId === folder.id ? 'active' : ''}" 
           data-folder-id="${folder.id}" style="${indent}">
        <svg class="folder-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span class="folder-name">${escapeHtml(folder.title)}</span>
        <span class="folder-count">${folder.count}</span>
      </div>
    `;
  }
  
  container.innerHTML = html;
  
  // 绑定点击事件
  container.querySelectorAll('.folder-item').forEach(item => {
    item.addEventListener('click', () => {
      const folderId = item.dataset.folderId;
      currentFolderId = folderId === 'all' ? null : folderId;
      
      // 更新激活状态
      container.querySelectorAll('.folder-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      
      // 更新标题
      if (currentFolderId === null) {
        document.getElementById('contentTitle').textContent = '所有书签';
      } else {
        const folder = allFolders.find(f => f.id === currentFolderId);
        document.getElementById('contentTitle').textContent = folder ? folder.title : '书签';
      }
      
      renderBookmarks();
    });
  });
}

// 渲染书签列表
function renderBookmarks() {
  const container = document.getElementById('bookmarkList');
  
  // 过滤书签
  let bookmarks = allBookmarks;
  
  // 按文件夹过滤
  if (currentFolderId !== null) {
    bookmarks = bookmarks.filter(b => b.parentId === currentFolderId);
  }
  
  // 按搜索过滤
  if (searchQuery) {
    bookmarks = bookmarks.filter(b => 
      b.title.toLowerCase().includes(searchQuery) || 
      b.url.toLowerCase().includes(searchQuery)
    );
  }
  
  // 空状态
  if (bookmarks.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
        </svg>
        <p>${searchQuery ? '没有找到匹配的书签' : '这个文件夹是空的'}</p>
      </div>
    `;
    return;
  }
  
  // 渲染列表
  container.className = currentView === 'grid' ? 'bookmark-grid' : 'bookmark-list';
  
  let html = '';
  for (const bookmark of bookmarks) {
    const favicon = getFaviconUrl(bookmark.url);
    html += `
      <div class="bookmark-item" data-id="${bookmark.id}" data-url="${escapeHtml(bookmark.url)}">
        <img class="bookmark-favicon" src="${favicon}" alt="" 
             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23666%22 stroke-width=%222%22><path d=%22M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z%22/></svg>'">
        <div class="bookmark-info">
          <div class="bookmark-title">${escapeHtml(bookmark.title)}</div>
          <div class="bookmark-url">${escapeHtml(bookmark.url)}</div>
        </div>
        <div class="bookmark-actions">
          <button class="action-btn" data-action="open" title="打开">打开</button>
          <button class="action-btn" data-action="edit" title="编辑">编辑</button>
          <button class="action-btn danger" data-action="delete" title="删除">删除</button>
        </div>
      </div>
    `;
  }
  
  container.innerHTML = html;
}

// 处理书签操作
function handleBookmarkAction(e) {
  const btn = e.target.closest('.action-btn');
  if (!btn) return;
  
  const item = btn.closest('.bookmark-item');
  if (!item) return;
  
  const id = item.dataset.id;
  const action = btn.dataset.action;
  
  e.stopPropagation();
  
  switch (action) {
    case 'open':
      openBookmark(id);
      break;
    case 'edit':
      editBookmark(id);
      break;
    case 'delete':
      deleteBookmark(id);
      break;
  }
}

// 获取 Favicon
function getFaviconUrl(url) {
  try {
    const urlObj = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
  } catch {
    return '';
  }
}

// 打开书签
function openBookmark(id) {
  const bookmark = allBookmarks.find(b => b.id === id);
  if (bookmark) {
    chrome.tabs.create({ url: bookmark.url });
  }
}

// 编辑书签 - 打开编辑弹窗
function editBookmark(id) {
  const bookmark = allBookmarks.find(b => b.id === id);
  if (!bookmark) return;
  
  currentEditBookmark = bookmark;
  currentAiSuggestion = null;
  
  document.getElementById('editBookmarkName').value = bookmark.title;
  document.getElementById('editBookmarkUrl').value = bookmark.url;
  document.getElementById('aiSuggestBox').style.display = 'none';
  document.getElementById('editModal').classList.add('show');
}

// 关闭编辑弹窗
function closeEditModal() {
  document.getElementById('editModal').classList.remove('show');
  currentEditBookmark = null;
  currentAiSuggestion = null;
}

// 保存编辑
async function saveEditBookmark() {
  if (!currentEditBookmark) return;
  
  // 如果有 AI 建议且输入框没被手动修改，自动应用建议
  let newTitle = document.getElementById('editBookmarkName').value.trim();
  
  if (currentAiSuggestion && newTitle === currentEditBookmark.title) {
    newTitle = currentAiSuggestion;
  }
  
  if (!newTitle) {
    showToast('名称不能为空', 'error');
    return;
  }
  
  if (newTitle !== currentEditBookmark.title) {
    try {
      await chrome.bookmarks.update(currentEditBookmark.id, { title: newTitle });
      showToast('书签已更新', 'success');
      loadBookmarks();
    } catch (e) {
      showToast('更新失败', 'error');
    }
  } else {
    showToast('名称未变更', 'info');
  }
  
  closeEditModal();
}

// 抓取页面内容
async function fetchPageContent(url) {
  try {
    // 跳过特殊页面
    if (url.startsWith('chrome://') || url.startsWith('edge://') || 
        url.startsWith('about:') || url.startsWith('chrome-extension://')) {
      return null;
    }
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BookmarkBot/1.0)' }
    });
    clearTimeout(timeout);
    
    if (!response.ok) return null;
    
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // 提取关键信息
    const title = doc.querySelector('title')?.textContent?.trim() || '';
    const description = doc.querySelector('meta[name="description"]')?.content?.trim() || '';
    const keywords = doc.querySelector('meta[name="keywords"]')?.content?.trim() || '';
    const h1 = doc.querySelector('h1')?.textContent?.trim() || '';
    const ogTitle = doc.querySelector('meta[property="og:title"]')?.content?.trim() || '';
    
    // 获取正文预览
    const mainContent = doc.querySelector('main, article, .content, #content, .main');
    let text = '';
    if (mainContent) {
      text = mainContent.textContent?.replace(/\s+/g, ' ').trim().slice(0, 300) || '';
    }
    
    return { title, description, keywords, h1, ogTitle, text };
  } catch (e) {
    console.warn('抓取页面失败:', url, e.message);
    return null;
  }
}

// AI 分析书签
async function aiAnalyzeBookmark() {
  if (!currentEditBookmark) return;
  
  const btn = document.getElementById('aiAnalyzeBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>抓取页面...';
  
  try {
    // 加载API配置
    const result = await chrome.storage.local.get(['apiConfig']);
    const config = result.apiConfig || DEFAULT_CONFIG;
    
    // 先抓取页面内容
    btn.innerHTML = '<span class="spinner"></span>抓取页面...';
    const pageContent = await fetchPageContent(currentEditBookmark.url);
    
    btn.innerHTML = '<span class="spinner"></span>AI 分析...';
    
    const systemPrompt = `You are a bookmark naming expert. Based on URL, current name and page content, provide a concise professional bookmark name.

Format: "SiteName - ContentTitle"
- SiteName: Extract from URL domain or page (e.g., LinuxDo, GitHub, Zhihu, V2EX)
- ContentTitle: Core topic, 5-10 characters

Examples:
- linux.do post → "LinuxDo - 结婚迷茫心情贴"
- GitHub project → "GitHub - Claude Code"
- Zhihu Q&A → "知乎 - 如何学编程"
- Product docs → "Playwright - Python Docs"
- Tool homepage → "Cursor - AI Code Editor"

Rules:
1. Forum/community posts must use "Site - Topic" format
2. Project/product pages keep the project name
3. Total length max 20 chars
4. Remove useless words like "Home", "Welcome", "Official"

Output name only, no explanation. Keep Chinese content in Chinese.`;

    // 构建用户消息
    let userContent = `URL: ${currentEditBookmark.url}\n当前名称: ${currentEditBookmark.title}`;
    
    if (pageContent) {
      userContent = `URL: ${currentEditBookmark.url}
当前名称: ${currentEditBookmark.title}
页面标题: ${pageContent.title}
OG标题: ${pageContent.ogTitle}
描述: ${pageContent.description}
H1: ${pageContent.h1}
关键词: ${pageContent.keywords}
内容预览: ${pageContent.text}`;
    }

    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.apiModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        temperature: 0.3,
        max_tokens: 50
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      const suggestion = data.choices[0].message.content.trim();
      
      if (suggestion && suggestion !== currentEditBookmark.title) {
        currentAiSuggestion = suggestion;
        document.getElementById('aiSuggestContent').textContent = suggestion;
        document.getElementById('aiSuggestBox').style.display = 'block';
      } else {
        showToast('当前名称已是最佳', 'success');
      }
    } else {
      throw new Error('API请求失败');
    }
  } catch (e) {
    console.error('AI分析失败:', e);
    showToast('AI分析失败', 'error');
  }
  
  btn.disabled = false;
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 4px;">
    <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
  </svg>AI 分析`;
}

// 应用 AI 建议
function applyAiSuggestion() {
  if (currentAiSuggestion) {
    document.getElementById('editBookmarkName').value = currentAiSuggestion;
    document.getElementById('aiSuggestBox').style.display = 'none';
  }
}

// 删除书签 - 显示确认弹窗
function deleteBookmark(id) {
  const bookmark = allBookmarks.find(b => b.id === id);
  if (!bookmark) return;
  
  showConfirm(
    '删除书签',
    `确定删除书签 "${bookmark.title}"？`,
    async () => {
      try {
        await chrome.bookmarks.remove(id);
        showToast('书签已删除', 'success');
        loadBookmarks();
      } catch (e) {
        showToast('删除失败', 'error');
      }
    }
  );
}

// 显示确认弹窗
function showConfirm(title, message, callback) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  confirmCallback = callback;
  document.getElementById('confirmModal').classList.add('show');
}

// 关闭确认弹窗
function closeConfirmModal() {
  document.getElementById('confirmModal').classList.remove('show');
  confirmCallback = null;
}

// HTML 转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

// 显示提示
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast show ' + type;
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}
