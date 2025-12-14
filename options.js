// Default API config (OpenAI compatible)
const DEFAULT_CONFIG = {
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  apiKey: 'sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  apiModel: 'gpt-4o-mini'
};

// 当前待确认的操作
let pendingAction = null;

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadBackups();
  await loadAccountStatus();
  bindEvents();
  
  // 显示版本号
  const manifest = chrome.runtime.getManifest();
  document.getElementById('versionBadge').textContent = `v${manifest.version}`;
});

// 绑定事件
function bindEvents() {
  // Tab 切换
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      
      // 书签管理器打开新页面
      if (tabName === 'manager') {
        chrome.tabs.create({ url: chrome.runtime.getURL('bookmarks.html') });
        return;
      }
      
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`section-${tabName}`).classList.add('active');
      
      // 切换到整理tab时刷新统计
      if (tabName === 'organize') {
        refreshBookmarkStats();
      }
    });
  });
  
  // 模型选择
  document.getElementById('apiModel').addEventListener('change', (e) => {
    const customGroup = document.getElementById('customModelGroup');
    customGroup.style.display = e.target.value === 'custom' ? 'block' : 'none';
  });
  
  // API 设置
  document.getElementById('testApiBtn').addEventListener('click', testApi);
  document.getElementById('saveApiBtn').addEventListener('click', saveSettings);
  
  // AI 整理
  document.getElementById('refreshStatsBtn').addEventListener('click', refreshBookmarkStats);
  document.getElementById('previewOrganizeBtn').addEventListener('click', previewOrganize);
  document.getElementById('startOrganizeBtn').addEventListener('click', confirmStartOrganize);
  
  // 高级设置展开/收起
  document.getElementById('toggleAdvanced').addEventListener('click', () => {
    const advanced = document.getElementById('advancedOptions');
    const btn = document.getElementById('toggleAdvanced');
    if (advanced.style.display === 'none') {
      advanced.style.display = 'block';
      btn.textContent = '收起';
    } else {
      advanced.style.display = 'none';
      btn.textContent = '展开';
    }
  });
  
  // 重命名风格切换 - 自动调整参数
  document.getElementById('renameStyle').addEventListener('change', (e) => {
    const style = e.target.value;
    applyRenameStyle(style);
  });
  
  // 备份操作
  document.getElementById('createBackupBtn').addEventListener('click', createBackup);
  document.getElementById('exportAllBtn').addEventListener('click', exportAllBackups);
  document.getElementById('importBackupBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', importBackup);
  
  // Modal
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  document.getElementById('modalConfirm').addEventListener('click', confirmAction);
  
  // Report Modal
  document.getElementById('closeReportModal').addEventListener('click', closeReportModal);
  document.getElementById('closeReportBtn').addEventListener('click', closeReportModal);
  document.getElementById('downloadReportBtn').addEventListener('click', downloadReport);
  
  // 账号相关事件
  document.getElementById('registerBtn').addEventListener('click', handleRegister);
  document.getElementById('loginBtn').addEventListener('click', handleLogin);
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);
  document.getElementById('syncNowBtn').addEventListener('click', handleSyncNow);
  document.getElementById('autoSyncToggle').addEventListener('change', handleAutoSyncToggle);
}

// 加载设置
async function loadSettings() {
  const result = await chrome.storage.local.get(['apiConfig']);
  const config = result.apiConfig || DEFAULT_CONFIG;
  
  document.getElementById('apiUrl').value = config.apiUrl || '';
  document.getElementById('apiKey').value = config.apiKey || '';
  
  // 检查是否是预设模型
  const modelSelect = document.getElementById('apiModel');
  const options = Array.from(modelSelect.options).map(o => o.value);
  
  if (options.includes(config.apiModel)) {
    modelSelect.value = config.apiModel;
  } else {
    modelSelect.value = 'custom';
    document.getElementById('customModelGroup').style.display = 'block';
    document.getElementById('customModel').value = config.apiModel;
  }
}

// 保存设置
async function saveSettings() {
  const apiUrl = document.getElementById('apiUrl').value.trim();
  const apiKey = document.getElementById('apiKey').value.trim();
  let apiModel = document.getElementById('apiModel').value;
  
  if (apiModel === 'custom') {
    apiModel = document.getElementById('customModel').value.trim();
    if (!apiModel) {
      showToast('请输入自定义模型名称', 'error');
      return;
    }
  }
  
  if (!apiUrl) {
    showToast('请输入 API 地址', 'error');
    return;
  }
  
  if (!apiKey) {
    showToast('请输入 API 密钥', 'error');
    return;
  }
  
  await chrome.storage.local.set({
    apiConfig: { apiUrl, apiKey, apiModel }
  });
  
  showToast('设置已保存', 'success');
}

// 测试 API
async function testApi() {
  const btn = document.getElementById('testApiBtn');
  btn.disabled = true;
  btn.textContent = '测试中...';
  
  const apiUrl = document.getElementById('apiUrl').value.trim();
  const apiKey = document.getElementById('apiKey').value.trim();
  let apiModel = document.getElementById('apiModel').value;
  
  if (apiModel === 'custom') {
    apiModel = document.getElementById('customModel').value.trim();
  }
  
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: apiModel,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5
      })
    });
    
    if (response.ok) {
      showToast('连接成功！', 'success');
    } else {
      const data = await response.json();
      showToast(`连接失败: ${data.error?.message || response.status}`, 'error');
    }
  } catch (e) {
    showToast(`连接失败: ${e.message}`, 'error');
  }
  
  btn.disabled = false;
  btn.textContent = '测试连接';
}

// ===== 备份功能 =====

// 加载备份列表
async function loadBackups() {
  const result = await chrome.storage.local.get(['bookmarkBackups']);
  const backups = result.bookmarkBackups || [];
  
  const list = document.getElementById('backupList');
  
  if (backups.length === 0) {
    list.innerHTML = '<div class="empty-state">暂无备份</div>';
    return;
  }
  
  list.innerHTML = backups.map((backup, index) => `
    <div class="backup-item" data-index="${index}">
      <div class="backup-info">
        <div class="backup-name">${backup.name}</div>
        <div class="backup-meta">
          ${new Date(backup.timestamp).toLocaleString('zh-CN')} · 
          ${backup.count} 个书签
        </div>
      </div>
      <div class="backup-actions">
        <button class="btn btn-secondary restore-btn" data-index="${index}">还原</button>
        <button class="btn btn-secondary export-btn" data-index="${index}">导出</button>
        <button class="btn btn-danger delete-btn" data-index="${index}">删除</button>
      </div>
    </div>
  `).join('');
  
  // 绑定按钮事件
  list.querySelectorAll('.restore-btn').forEach(btn => {
    btn.addEventListener('click', () => confirmRestore(parseInt(btn.dataset.index)));
  });
  
  list.querySelectorAll('.export-btn').forEach(btn => {
    btn.addEventListener('click', () => exportBackup(parseInt(btn.dataset.index)));
  });
  
  list.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => confirmDelete(parseInt(btn.dataset.index)));
  });
}

// 创建备份
async function createBackup() {
  const nameInput = document.getElementById('backupName');
  const name = nameInput.value.trim() || `备份 ${new Date().toLocaleString('zh-CN')}`;
  
  try {
    // 获取所有书签
    const tree = await chrome.bookmarks.getTree();
    
    // 计算书签数量
    function countBookmarks(nodes) {
      let count = 0;
      for (const node of nodes) {
        if (node.url) count++;
        if (node.children) count += countBookmarks(node.children);
      }
      return count;
    }
    
    const count = countBookmarks(tree);
    
    // 创建备份对象
    const backup = {
      name,
      timestamp: Date.now(),
      count,
      data: tree
    };
    
    // 保存到存储
    const result = await chrome.storage.local.get(['bookmarkBackups']);
    const backups = result.bookmarkBackups || [];
    backups.unshift(backup); // 添加到开头
    
    // 最多保留20个备份
    if (backups.length > 20) {
      backups.pop();
    }
    
    await chrome.storage.local.set({ bookmarkBackups: backups });
    
    showToast(`备份创建成功: ${name}`, 'success');
    nameInput.value = '';
    await loadBackups();
    
  } catch (e) {
    showToast(`备份失败: ${e.message}`, 'error');
  }
}

// 确认还原
function confirmRestore(index) {
  pendingAction = { type: 'restore', index };
  showModal('确认还原', '还原后将覆盖当前所有书签，此操作不可撤销。建议先创建当前书签的备份。');
}

// 确认删除
function confirmDelete(index) {
  pendingAction = { type: 'delete', index };
  showModal('确认删除', '确定要删除这个备份吗？此操作不可撤销。');
}

// 执行还原
async function restoreBackup(index) {
  // 显示加载提示
  showToast('正在还原书签，请稍候...', 'info');
  
  try {
    const result = await chrome.storage.local.get(['bookmarkBackups']);
    const backups = result.bookmarkBackups || [];
    const backup = backups[index];
    
    if (!backup) {
      showToast('备份不存在', 'error');
      return;
    }
    
    console.log('开始还原备份:', backup.name);
    console.log('备份数据结构:', JSON.stringify(backup.data, null, 2).slice(0, 500));
    
    // 递归还原书签
    async function restoreNode(node, parentId) {
      try {
        if (node.url) {
          // 这是一个书签
          await chrome.bookmarks.create({
            parentId,
            title: node.title || '未命名',
            url: node.url
          });
          console.log('还原书签:', node.title);
        } else if (node.children) {
          // 这是一个文件夹
          let targetFolderId = parentId;
          
          // 跳过根节点，但处理其子节点
          // 根节点ID: 0=根, 1=书签栏, 2=其他书签
          if (node.id === '0') {
            // 根节点，遍历子节点
            for (const child of node.children) {
              await restoreNode(child, parentId);
            }
            return;
          } else if (node.id === '1' || node.id === '2') {
            // 书签栏或其他书签，使用对应的ID
            targetFolderId = node.id;
          } else {
            // 普通文件夹，创建新文件夹
            const folder = await chrome.bookmarks.create({
              parentId,
              title: node.title || '未命名文件夹'
            });
            targetFolderId = folder.id;
            console.log('创建文件夹:', node.title, '-> ID:', folder.id);
          }
          
          // 还原子节点
          for (const child of node.children) {
            await restoreNode(child, targetFolderId);
          }
        }
      } catch (e) {
        console.error('还原节点失败:', node.title, e);
      }
    }
    
    // 从备份数据开始还原
    // backup.data 是 getTree() 的结果，是一个数组，第一个元素是根节点
    const backupRoot = backup.data[0];
    
    if (!backupRoot) {
      showToast('备份数据为空', 'error');
      return;
    }
    
    let restoredCount = 0;
    
    // 遍历根节点的子节点（书签栏、其他书签等）
    for (const rootChild of (backupRoot.children || [])) {
      // rootChild.id 可能是 '1'（书签栏）或 '2'（其他书签）
      const targetParentId = rootChild.id; // 直接使用原始ID
      
      console.log('处理根文件夹:', rootChild.title, 'ID:', rootChild.id);
      
      // 还原这个根文件夹下的所有内容
      for (const child of (rootChild.children || [])) {
        await restoreNode(child, targetParentId);
        restoredCount++;
      }
    }
    
    showToast(`还原成功！已还原 ${restoredCount} 个项目`, 'success');
    console.log('还原完成，共', restoredCount, '个项目');
    
    // 提示用户刷新书签
    setTimeout(() => {
      showToast('书签已还原，可以查看书签栏了', 'info');
    }, 2000);
    
  } catch (e) {
    console.error('还原失败:', e);
    showToast(`还原失败: ${e.message}`, 'error');
  }
}

// 删除备份
async function deleteBackup(index) {
  try {
    const result = await chrome.storage.local.get(['bookmarkBackups']);
    const backups = result.bookmarkBackups || [];
    backups.splice(index, 1);
    await chrome.storage.local.set({ bookmarkBackups: backups });
    showToast('备份已删除', 'success');
    await loadBackups();
  } catch (e) {
    showToast(`删除失败: ${e.message}`, 'error');
  }
}

// 导出单个备份
async function exportBackup(index) {
  try {
    const result = await chrome.storage.local.get(['bookmarkBackups']);
    const backups = result.bookmarkBackups || [];
    const backup = backups[index];
    
    if (!backup) {
      showToast('备份不存在', 'error');
      return;
    }
    
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `bookmark-backup-${backup.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
    showToast('导出成功', 'success');
  } catch (e) {
    showToast(`导出失败: ${e.message}`, 'error');
  }
}

// 导出所有备份
async function exportAllBackups() {
  try {
    const result = await chrome.storage.local.get(['bookmarkBackups']);
    const backups = result.bookmarkBackups || [];
    
    if (backups.length === 0) {
      showToast('没有可导出的备份', 'error');
      return;
    }
    
    const blob = new Blob([JSON.stringify(backups, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `all-bookmark-backups-${Date.now()}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
    showToast('导出成功', 'success');
  } catch (e) {
    showToast(`导出失败: ${e.message}`, 'error');
  }
}

// 导入备份
async function importBackup(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    
    const result = await chrome.storage.local.get(['bookmarkBackups']);
    const backups = result.bookmarkBackups || [];
    
    // 判断是单个备份还是多个备份
    if (Array.isArray(data)) {
      // 多个备份
      for (const backup of data) {
        if (backup.name && backup.data && backup.timestamp) {
          backups.unshift(backup);
        }
      }
      showToast(`导入了 ${data.length} 个备份`, 'success');
    } else if (data.name && data.data && data.timestamp) {
      // 单个备份
      backups.unshift(data);
      showToast('导入成功', 'success');
    } else {
      showToast('无效的备份文件', 'error');
      return;
    }
    
    // 去重并限制数量
    const seen = new Set();
    const unique = backups.filter(b => {
      const key = `${b.name}-${b.timestamp}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 20);
    
    await chrome.storage.local.set({ bookmarkBackups: unique });
    await loadBackups();
    
  } catch (e) {
    showToast(`导入失败: ${e.message}`, 'error');
  }
  
  // 清空文件选择
  e.target.value = '';
}

// ===== Modal =====

function showModal(title, message) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalMessage').textContent = message;
  document.getElementById('confirmModal').classList.add('show');
}

function closeModal() {
  document.getElementById('confirmModal').classList.remove('show');
  pendingAction = null;
}

async function confirmAction() {
  if (!pendingAction) return;
  
  // 先保存操作信息，再关闭模态框
  const action = pendingAction;
  pendingAction = null;
  
  // 禁用确认按钮防止重复点击
  const confirmBtn = document.getElementById('modalConfirm');
  confirmBtn.disabled = true;
  confirmBtn.textContent = '处理中...';
  
  document.getElementById('confirmModal').classList.remove('show');
  
  // 重置按钮状态
  setTimeout(() => {
    confirmBtn.disabled = false;
    confirmBtn.textContent = '确认';
  }, 500);
  
  if (action.type === 'restore') {
    await restoreBackup(action.index);
  } else if (action.type === 'delete') {
    await deleteBackup(action.index);
  } else if (action.type === 'organize') {
    await startOrganize();
  }
}

// ===== Toast =====

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast show ' + type;
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ===== AI 整理功能 =====

let allBookmarks = [];
let allFolders = [];
let isOrganizing = false;

// 应用重命名风格预设
function applyRenameStyle(style) {
  const enableFetch = document.getElementById('enableFetch');
  const enableRename = document.getElementById('enableRename');
  const temperature = document.getElementById('temperature');
  
  switch (style) {
    case 'conservative':
      // 保守：不抓取网页，低温度
      enableFetch.checked = false;
      enableRename.checked = true;
      temperature.value = '0.1';
      showToast('已切换为保守模式：仅改名明显模糊的书签', 'info');
      break;
    case 'normal':
      // 正常：不抓取网页，中等温度
      enableFetch.checked = false;
      enableRename.checked = true;
      temperature.value = '0.2';
      showToast('已切换为正常模式：适度优化书签名称', 'info');
      break;
    case 'aggressive':
      // 激进：抓取网页，高温度
      enableFetch.checked = true;
      enableRename.checked = true;
      temperature.value = '0.7';
      showToast('已切换为激进模式：强制优化所有书签名称', 'info');
      break;
  }
}

// Get rename instruction based on style
function getRenameInstruction(style, enableRename) {
  if (!enableRename) {
    return '6. Do NOT modify bookmark names, leave newName empty';
  }
  
  switch (style) {
    case 'conservative':
      return '6. Rename rule (Conservative): Only provide newName when the bookmark name is very vague or hard to understand, otherwise leave empty';
    case 'aggressive':
      return `6. Rename rule (Aggressive - MUST follow):
   - You MUST provide newName for every bookmark, this is mandatory
   - Requirements: concise (max 15 chars), professional, remove useless prefix/suffix
   - Remove: site name suffix, " - xxx", "| xxx", extra symbols, duplicate words
   - Keep: core keywords, product/project name, version if needed
   - Format: "SiteName - Topic" for forum posts
   - Example: "GitHub - microsoft/vscode" → "GitHub - VSCode"
   - Even if original name looks ok, try to optimize, newName cannot be empty
   - Keep Chinese content in Chinese`;
    default: // normal
      return '6. Rename rule (Normal): Provide better name if bookmark name is unclear or can be obviously improved';
  }
}

// 服务端批量抓取分析
async function serverBatchAnalyze(urls, existingCategories, renameMode) {
  try {
    // 获取同步配置和 API 配置
    const syncResult = await chrome.storage.local.get(['syncConfig']);
    const syncConfig = syncResult.syncConfig;
    
    if (!syncConfig || !syncConfig.token) {
      console.warn('未登录云同步，无法使用服务端抓取');
      return null;
    }
    
    const apiResult = await chrome.storage.local.get(['apiConfig']);
    const apiConfig = apiResult.apiConfig || DEFAULT_CONFIG;
    
    const response = await fetch(`${syncConfig.serverUrl}/api/batch-analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${syncConfig.token}`
      },
      body: JSON.stringify({
        urls: urls,
        existingCategories: existingCategories,
        renameMode: renameMode,
        apiConfig: {
          apiUrl: apiConfig.apiUrl,
          apiKey: apiConfig.apiKey,
          apiModel: apiConfig.apiModel
        }
      })
    });
    
    if (!response.ok) {
      console.warn('服务端批量分析失败:', response.status);
      return null;
    }
    
    return await response.json();
  } catch (e) {
    console.warn('服务端批量分析错误:', e.message);
    return null;
  }
}


// 刷新书签统计
async function refreshBookmarkStats() {
  try {
    const tree = await chrome.bookmarks.getTree();
    allBookmarks = [];
    allFolders = [];
    
    // 递归提取书签和文件夹
    function traverse(nodes, depth = 0, parentId = null) {
      for (const node of nodes) {
        if (node.url) {
          allBookmarks.push({
            id: node.id,
            title: node.title,
            url: node.url,
            parentId: node.parentId
          });
        } else if (node.children) {
          if (node.id !== '0') {
            allFolders.push({
              id: node.id,
              title: node.title,
              depth: depth,
              parentId: node.parentId
            });
          }
          traverse(node.children, depth + 1, node.id);
        }
      }
    }
    
    traverse(tree);
    
    // 计算未分类（直接在书签栏根目录的书签）
    const uncategorized = allBookmarks.filter(b => b.parentId === '1' || b.parentId === '2').length;
    
    document.getElementById('totalBookmarks').textContent = allBookmarks.length;
    document.getElementById('totalFolders').textContent = allFolders.filter(f => f.id !== '1' && f.id !== '2').length;
    document.getElementById('uncategorized').textContent = uncategorized;
    
    // 更新分类下拉框
    updateFolderSelect();
    
  } catch (e) {
    console.error('刷新统计失败:', e);
    showToast('刷新统计失败', 'error');
  }
}

// 更新分类下拉框
function updateFolderSelect() {
  const select = document.getElementById('targetFolder');
  const currentValue = select.value;
  
  select.innerHTML = '<option value="all">全部书签</option>';
  
  // 添加分类选项
  for (const folder of allFolders) {
    if (folder.id === '1' || folder.id === '2') continue; // 跳过根节点
    
    const opt = document.createElement('option');
    opt.value = folder.id;
    const indent = '  '.repeat(Math.max(0, folder.depth - 1));
    opt.textContent = `${indent}${folder.title}`;
    select.appendChild(opt);
  }
  
  // 恢复之前的选择
  if (currentValue && select.querySelector(`option[value="${currentValue}"]`)) {
    select.value = currentValue;
  }
  
  // 监听变化更新统计
  select.onchange = updateSelectedStats;
  updateSelectedStats();
}

// 更新选中分类的统计
function updateSelectedStats() {
  const folderId = document.getElementById('targetFolder').value;
  
  let count;
  if (folderId === 'all') {
    count = allBookmarks.length;
  } else {
    // 获取该分类及其子分类下的所有书签
    const folderIds = getSubFolderIds(folderId);
    folderIds.push(folderId);
    count = allBookmarks.filter(b => folderIds.includes(b.parentId)).length;
  }
  
  document.getElementById('totalBookmarks').textContent = count;
}

// 获取所有子分类ID
function getSubFolderIds(parentId) {
  const ids = [];
  for (const folder of allFolders) {
    if (folder.parentId === parentId) {
      ids.push(folder.id);
      ids.push(...getSubFolderIds(folder.id));
    }
  }
  return ids;
}

// 获取要整理的书签
function getTargetBookmarks() {
  const folderId = document.getElementById('targetFolder').value;
  
  if (folderId === 'all') {
    return allBookmarks;
  }
  
  // 获取该分类及其子分类下的所有书签
  const folderIds = getSubFolderIds(folderId);
  folderIds.push(folderId);
  return allBookmarks.filter(b => folderIds.includes(b.parentId));
}

// 确认开始整理
function confirmStartOrganize() {
  if (isOrganizing) {
    showToast('整理正在进行中...', 'info');
    return;
  }
  
  const targetBookmarks = getTargetBookmarks();
  
  if (targetBookmarks.length === 0) {
    showToast('选中的分类没有书签', 'error');
    return;
  }
  
  const enableFetch = document.getElementById('enableFetch').checked;
  const fetchNote = enableFetch ? '（已启用网页抓取，速度较慢）' : '';
  
  const folderId = document.getElementById('targetFolder').value;
  const folderName = folderId === 'all' ? '全部' : allFolders.find(f => f.id === folderId)?.title || '';
  const scopeNote = folderId === 'all' ? '' : `[${folderName}] `;
  
  pendingAction = { type: 'organize' };
  showModal(
    '确认开始 AI 整理',
    `即将整理 ${scopeNote}${targetBookmarks.length} 个书签${fetchNote}，强烈建议先备份！确定要继续吗？`
  );
}

// 预览整理方案
async function previewOrganize() {
  showToast('正在生成预览...', 'info');
  
  // 获取前5个书签作为预览
  const sampleBookmarks = allBookmarks.slice(0, 5);
  const folderNames = allFolders.map(f => f.title).filter(t => t).join('、');
  
  let previewText = '预览分析结果：\n\n';
  
  for (const bookmark of sampleBookmarks) {
    previewText += `• ${bookmark.title}\n   → 分析中...\n\n`;
  }
  
  // 这里可以实际调用AI分析，但为了快速预览，先显示结构
  alert(`将分析 ${allBookmarks.length} 个书签\n现有分类：${folderNames}\n\n${previewText}请点击"开始整理"执行完整分析。`);
}

// 开始 AI 整理
async function startOrganize() {
  if (isOrganizing) return;
  isOrganizing = true;
  
  const progressBox = document.getElementById('progressBox');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const startBtn = document.getElementById('startOrganizeBtn');
  
  // 统计数据
  const stats = {
    total: 0,
    moved: 0,
    renamed: 0,
    newFolders: 0,
    skipped: 0
  };
  
  // 详细记录
  const details = {
    moved: [],      // { title, from, to }
    renamed: [],    // { oldName, newName }
    newFolders: []  // { name }
  };
  
  // 记录已创建的新文件夹
  const createdFolders = new Map();
  
  progressBox.style.display = 'block';
  startBtn.disabled = true;
  startBtn.textContent = '整理中...';
  
  // 获取选项
  const enableFetch = document.getElementById('enableFetch').checked;
  const enableRename = document.getElementById('enableRename').checked;
  const enableNewCategory = document.getElementById('enableNewCategory').checked;
  const renameStyle = document.getElementById('renameStyle').value;
  
  // 获取高级设置
  const batchSize = parseInt(document.getElementById('batchSize').value) || 5;
  const requestDelay = parseInt(document.getElementById('requestDelay').value) || 200;
  const temperature = parseFloat(document.getElementById('temperature').value) || 0.2;
  
  try {
    // 获取要处理的书签（提前获取，避免后续问题）
    const targetBookmarks = getTargetBookmarks();
    console.log('要处理的书签数:', targetBookmarks.length);
    
    if (targetBookmarks.length === 0) {
      showToast('没有要整理的书签', 'error');
      isOrganizing = false;
      startBtn.disabled = false;
      startBtn.textContent = '开始整理';
      progressBox.style.display = 'none';
      return;
    }
    
    // 先自动备份
    progressText.textContent = '自动备份中...';
    await createAutoBackup();
    
    progressText.textContent = '加载配置...';
    
    // 加载API配置
    const configResult = await chrome.storage.local.get(['apiConfig']);
    const config = configResult.apiConfig || DEFAULT_CONFIG;
    
    // 获取现有分类
    const folderNames = allFolders.map(f => f.title).filter(t => t && t !== '书签栏' && t !== '其他书签');
    
    const renameInstruction = getRenameInstruction(renameStyle, enableRename);
    
    const newCategoryInstruction = enableNewCategory
      ? `2. Category creation rules (IMPORTANT):
   - If existing categories don't match well (match rate < 70%), CREATE a new category
   - New category names should be concise (2-4 Chinese chars), like: AI工具, 云服务, 设计资源, 学习资料
   - Don't force bookmarks into vague categories like "其他", prefer creating specific ones
   - Set isNewCategory to true when suggesting new category`
      : '2. Must use existing categories only, do not create new ones, isNewCategory always false';
    
    const systemPrompt = `You are a bookmark organization expert. Based on existing categories and bookmark info, determine which category the bookmark should belong to.

Existing categories: ${folderNames.join(', ')}

Rules:
1. Match existing categories only if they are a GOOD fit (>70% relevance)
${newCategoryInstruction}
3. GitHub projects → "开发工具" or tech-specific category
4. Server/DevOps → "服务器管理" or "运维工具"
5. API/Docs → "开发文档" or "技术文档"
${renameInstruction}

Strict JSON output: {"category": "分类名", "newName": "新名称或空", "isNewCategory": true/false}
Keep category names and bookmark names in Chinese.`;

    progressText.textContent = '开始整理...';
    
    let processed = 0;
    let moved = 0;
    const total = targetBookmarks.length;
    
    console.log('配置:', { batchSize, requestDelay, temperature, enableNewCategory, enableFetch });
    
    // 如果启用网页抓取，使用服务端批量分析
    if (enableFetch) {
      progressText.textContent = '使用服务端批量抓取分析...';
      
      // 分批调用服务端 API
      for (let i = 0; i < total; i += batchSize) {
        const batch = targetBookmarks.slice(i, i + batchSize);
        const urls = batch.map(b => b.url);
        
        const serverResult = await serverBatchAnalyze(urls, folderNames, renameStyle);
        
        if (serverResult && serverResult.results) {
          // 处理服务端返回的结果
          for (const result of serverResult.results) {
            const bookmark = batch.find(b => b.url === result.url);
            if (!bookmark) continue;
            
            processed++;
            progressText.textContent = `处理中 ${processed}/${total}...`;
            progressBar.style.width = `${(processed / total) * 100}%`;
            
            if (result.success) {
              // 转换为原有格式
              const aiResult = {
                category: result.suggestedCategory,
                newName: result.suggestedName,
                isNewCategory: result.isNewCategory
              };
              await processBookmarkResult(bookmark, aiResult, false, stats, details, createdFolders, enableNewCategory);
              if (aiResult.category) moved++;
            } else {
              // 抓取失败，标记书签
              await markBookmarkFailed(bookmark, stats, details);
            }
          }
        } else {
          // 服务端调用失败，回退到仅使用标题分析
          console.warn('服务端批量分析失败，回退到标题分析');
          for (const bookmark of batch) {
            processed++;
            const result = await analyzeBookmarkByTitle(bookmark, config, systemPrompt, temperature);
            await processBookmarkResult(bookmark, result, false, stats, details, createdFolders, enableNewCategory);
            if (result && result.category) moved++;
          }
        }
        
        // 批次间延迟
        if (i + batchSize < total) {
          await new Promise(r => setTimeout(r, requestDelay));
        }
      }
    } else {
      // 不启用网页抓取，仅使用标题分析
      for (let i = 0; i < total; i += batchSize) {
        const batch = targetBookmarks.slice(i, i + batchSize);
        
        const promises = batch.map(async (bookmark) => {
          const result = await analyzeBookmarkByTitle(bookmark, config, systemPrompt, temperature);
          return { bookmark, result, fetchFailed: false };
        });
        
        const results = await Promise.all(promises);
        
        for (const { bookmark, result, fetchFailed } of results) {
          processed++;
          progressText.textContent = `处理中 ${processed}/${total}...`;
          progressBar.style.width = `${(processed / total) * 100}%`;
          
          await processBookmarkResult(bookmark, result, fetchFailed, stats, details, createdFolders, enableNewCategory);
          if (result && result.category) moved++;
        }
        
        // 批次间延迟
        if (i + batchSize < total) {
          await new Promise(r => setTimeout(r, requestDelay));
        }
      }
    }
    
    // 辅助函数：仅使用标题分析
    async function analyzeBookmarkByTitle(bookmark, config, systemPrompt, temperature) {
      try {
        const userContent = `URL: ${bookmark.url}\n标题: ${bookmark.title}`;
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
            temperature: temperature,
            max_tokens: 80
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          const content = data.choices[0].message.content;
          const start = content.indexOf('{');
          const end = content.lastIndexOf('}') + 1;
          if (start >= 0 && end > start) {
            return JSON.parse(content.slice(start, end));
          }
        }
      } catch (e) {
        console.warn('分析失败:', bookmark.title, e);
      }
      return null;
    }
    
    // 辅助函数：标记书签无法访问
    async function markBookmarkFailed(bookmark, stats, details) {
      try {
        const newTitle = bookmark.title.includes('（无法访问）') 
          ? bookmark.title 
          : `${bookmark.title}（无法访问）`;
        await chrome.bookmarks.update(bookmark.id, { title: newTitle });
        stats.renamed++;
        details.renamed.push({ oldName: bookmark.title, newName: newTitle });
        console.log('标记无法访问:', bookmark.title);
      } catch (e) {
        console.warn('标记失败:', bookmark.title, e);
      }
    }
    
    // 辅助函数：处理单个书签结果
    async function processBookmarkResult(bookmark, result, fetchFailed, stats, details, createdFolders, enableNewCategory) {
      stats.total++;
      
      if (!result || !result.category) return;
      
      // 查找目标文件夹
      let targetFolder = allFolders.find(f => 
        f.title === result.category || 
        f.title.includes(result.category)
      );
      
      // 如果是新分类，创建文件夹
      if (!targetFolder && result.isNewCategory && enableNewCategory) {
        if (createdFolders.has(result.category)) {
          targetFolder = { id: createdFolders.get(result.category), title: result.category };
        } else {
          try {
            const newFolder = await chrome.bookmarks.create({
              parentId: '1',
              title: result.category
            });
            targetFolder = { id: newFolder.id, title: result.category };
            createdFolders.set(result.category, newFolder.id);
            allFolders.push({ id: newFolder.id, title: result.category, depth: 1 });
            stats.newFolders++;
            details.newFolders.push({ name: result.category });
            console.log('创建新分类:', result.category);
          } catch (e) {
            console.warn('创建分类失败:', result.category, e);
          }
        }
      }
      
      const fromFolder = allFolders.find(f => f.id === bookmark.parentId);
      const fromName = fromFolder?.title || '未知';
      
      if (targetFolder && targetFolder.id !== bookmark.parentId) {
        try {
          await chrome.bookmarks.move(bookmark.id, { parentId: targetFolder.id });
          stats.moved++;
          details.moved.push({
            title: bookmark.title,
            from: fromName,
            to: targetFolder.title || result.category
          });
          
          // 如果有新名称，更新标题
          if (result.newName && result.newName.trim() && result.newName !== bookmark.title) {
            await chrome.bookmarks.update(bookmark.id, { title: result.newName });
            stats.renamed++;
            details.renamed.push({ oldName: bookmark.title, newName: result.newName });
          }
        } catch (e) {
          console.warn('移动失败:', bookmark.title, e);
        }
      } else if (result.newName && result.newName.trim() && result.newName !== bookmark.title) {
        // 不需要移动但需要重命名
        try {
          await chrome.bookmarks.update(bookmark.id, { title: result.newName });
          stats.renamed++;
          details.renamed.push({ oldName: bookmark.title, newName: result.newName });
        } catch (e) {
          console.warn('重命名失败:', bookmark.title, e);
        }
      }
    }
    
    progressText.textContent = `整理完成！共移动 ${moved} 个书签`;
    
    // 显示报告弹窗
    showReportModal(stats, details);
    showToast(`整理完成！共移动 ${stats.moved} 个书签`, 'success');
    
  } catch (e) {
    console.error('整理失败:', e);
    progressText.textContent = `整理失败: ${e.message}`;
    showToast(`整理失败: ${e.message}`, 'error');
  }
  
  isOrganizing = false;
  startBtn.disabled = false;
  startBtn.textContent = '开始整理';
  
  // 刷新统计
  await refreshBookmarkStats();
}

// 当前报告数据（用于下载）
let currentReportData = null;

// 显示整理报告弹窗
function showReportModal(stats, details) {
  currentReportData = { stats, details, timestamp: new Date().toISOString() };
  
  // 更新统计数字
  document.getElementById('modalReportTotal').textContent = stats.total;
  document.getElementById('modalReportMoved').textContent = stats.moved;
  document.getElementById('modalReportRenamed').textContent = stats.renamed;
  document.getElementById('modalReportNewFolders').textContent = stats.newFolders;
  document.getElementById('modalReportSkipped').textContent = stats.skipped;
  
  // 显示移动列表
  const movedSection = document.getElementById('movedSection');
  const movedList = document.getElementById('movedList');
  if (details.moved.length > 0) {
    movedSection.style.display = 'block';
    movedList.innerHTML = details.moved.map(item => `
      <div class="report-item">
        <span class="report-item-title">${escapeHtml(item.title)}</span>
        <span class="report-item-arrow">→</span>
        <span class="report-item-target">${escapeHtml(item.to)}</span>
      </div>
    `).join('');
  } else {
    movedSection.style.display = 'none';
  }
  
  // 显示重命名列表
  const renamedSection = document.getElementById('renamedSection');
  const renamedList = document.getElementById('renamedList');
  if (details.renamed.length > 0) {
    renamedSection.style.display = 'block';
    renamedList.innerHTML = details.renamed.map(item => `
      <div class="report-item">
        <span class="report-item-title">${escapeHtml(item.oldName)}</span>
        <span class="report-item-arrow">→</span>
        <span class="report-item-target">${escapeHtml(item.newName)}</span>
      </div>
    `).join('');
  } else {
    renamedSection.style.display = 'none';
  }
  
  // 显示新分类列表
  const newFoldersSection = document.getElementById('newFoldersSection');
  const newFoldersList = document.getElementById('newFoldersList');
  if (details.newFolders.length > 0) {
    newFoldersSection.style.display = 'block';
    newFoldersList.innerHTML = details.newFolders.map(item => `
      <div class="report-item">
        <span class="report-item-title">${escapeHtml(item.name)}</span>
      </div>
    `).join('');
  } else {
    newFoldersSection.style.display = 'none';
  }
  
  // 显示弹窗
  document.getElementById('reportModal').classList.add('show');
}

// HTML 转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 关闭报告弹窗
function closeReportModal() {
  document.getElementById('reportModal').classList.remove('show');
}

// 下载详细报告
function downloadReport() {
  if (!currentReportData) {
    showToast('没有可下载的报告', 'error');
    return;
  }
  
  const { stats, details, timestamp } = currentReportData;
  
  // 生成文本报告
  let report = `书签整理报告
=====================================
生成时间: ${new Date(timestamp).toLocaleString('zh-CN')}

【整理统计】
• 处理书签: ${stats.total}
• 移动书签: ${stats.moved}
• 重命名: ${stats.renamed}
• 新建分类: ${stats.newFolders}
• 跳过: ${stats.skipped}

`;
  
  if (details.moved.length > 0) {
    report += `【移动的书签】\n`;
    details.moved.forEach((item, i) => {
      report += `${i + 1}. ${item.title}\n   从: ${item.from} → 到: ${item.to}\n`;
    });
    report += '\n';
  }
  
  if (details.renamed.length > 0) {
    report += `【重命名的书签】\n`;
    details.renamed.forEach((item, i) => {
      report += `${i + 1}. ${item.oldName} → ${item.newName}\n`;
    });
    report += '\n';
  }
  
  if (details.newFolders.length > 0) {
    report += `【新建的分类】\n`;
    details.newFolders.forEach((item, i) => {
      report += `${i + 1}. ${item.name}\n`;
    });
    report += '\n';
  }
  
  report += `=====================================\n由 智能书签助手 生成`;
  
  // 下载文件
  const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `书签整理报告_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  
  showToast('报告已下载', 'success');
}

// 自动备份
async function createAutoBackup() {
  try {
    const tree = await chrome.bookmarks.getTree();
    
    function countBookmarks(nodes) {
      let count = 0;
      for (const node of nodes) {
        if (node.url) count++;
        if (node.children) count += countBookmarks(node.children);
      }
      return count;
    }
    
    const backup = {
      name: `自动备份 (整理前) ${new Date().toLocaleString('zh-CN')}`,
      timestamp: Date.now(),
      count: countBookmarks(tree),
      data: tree,
      isAuto: true
    };
    
    const result = await chrome.storage.local.get(['bookmarkBackups']);
    const backups = result.bookmarkBackups || [];
    backups.unshift(backup);
    
    // 保留最多20个备份
    if (backups.length > 20) backups.pop();
    
    await chrome.storage.local.set({ bookmarkBackups: backups });
    console.log('自动备份完成');
    
  } catch (e) {
    console.error('自动备份失败:', e);
  }
}

// ========== 云端账号功能 ==========

// 加载账号状态
async function loadAccountStatus() {
  try {
    const status = await window.SyncModule.getSyncStatus();
    updateAccountUI(status);
  } catch (e) {
    console.error('加载账号状态失败:', e);
  }
}

// 更新账号 UI
function updateAccountUI(status) {
  const loggedOutDiv = document.getElementById('accountLoggedOut');
  const loggedInDiv = document.getElementById('accountLoggedIn');
  
  if (status.loggedIn) {
    loggedOutDiv.style.display = 'none';
    loggedInDiv.style.display = 'block';
    
    document.getElementById('loggedInEmail').textContent = status.email || '-';
    document.getElementById('lastSyncTime').textContent = status.lastSyncAt 
      ? new Date(status.lastSyncAt + 'Z').toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
      : '从未同步';
    document.getElementById('cloudBookmarkCount').textContent = status.bookmarkCount || 0;
  } else {
    loggedOutDiv.style.display = 'block';
    loggedInDiv.style.display = 'none';
  }
}

// 注册
async function handleRegister() {
  const serverUrl = document.getElementById('syncServerUrl').value.trim();
  const email = document.getElementById('syncEmail').value.trim();
  const password = document.getElementById('syncPassword').value;
  
  if (!serverUrl) {
    showToast('请输入服务器地址', 'error');
    return;
  }
  
  if (!email) {
    showToast('请输入邮箱', 'error');
    return;
  }
  
  if (!password || password.length < 6) {
    showToast('密码至少6位', 'error');
    return;
  }
  
  const btn = document.getElementById('registerBtn');
  btn.disabled = true;
  btn.textContent = '注册中...';
  
  try {
    await window.SyncModule.register(serverUrl, email, password);
    showToast('注册成功！', 'success');
    await loadAccountStatus();
    
    // 自动执行首次同步
    handleSyncNow();
  } catch (e) {
    showToast(e.message || '注册失败', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '注册新账号';
  }
}

// 登录
async function handleLogin() {
  const serverUrl = document.getElementById('syncServerUrl').value.trim();
  const email = document.getElementById('syncEmail').value.trim();
  const password = document.getElementById('syncPassword').value;
  
  if (!serverUrl) {
    showToast('请输入服务器地址', 'error');
    return;
  }
  
  if (!email || !password) {
    showToast('请输入邮箱和密码', 'error');
    return;
  }
  
  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  btn.textContent = '登录中...';
  
  try {
    await window.SyncModule.login(serverUrl, email, password);
    showToast('登录成功！', 'success');
    await loadAccountStatus();
    
    // 自动执行首次同步
    handleSyncNow();
  } catch (e) {
    showToast(e.message || '登录失败', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '登录';
  }
}

// 退出登录
async function handleLogout() {
  if (!confirm('确定要退出登录吗？')) return;
  
  await window.SyncModule.logout();
  showToast('已退出登录', 'info');
  await loadAccountStatus();
}

// 立即同步
async function handleSyncNow() {
  const btn = document.getElementById('syncNowBtn');
  const progressDiv = document.getElementById('syncProgress');
  const resultDiv = document.getElementById('syncResult');
  
  btn.disabled = true;
  progressDiv.style.display = 'block';
  resultDiv.style.display = 'none';
  
  document.getElementById('syncProgressFill').style.width = '30%';
  document.getElementById('syncProgressText').textContent = '正在同步...';
  
  try {
    document.getElementById('syncProgressFill').style.width = '60%';
    const result = await window.SyncModule.performSync();
    
    document.getElementById('syncProgressFill').style.width = '100%';
    document.getElementById('syncProgressText').textContent = '同步完成！';
    
    // 显示结果
    document.getElementById('syncAdded').textContent = result.added || 0;
    document.getElementById('syncUpdated').textContent = result.updated || 0;
    document.getElementById('syncDeleted').textContent = result.deleted || 0;
    
    setTimeout(() => {
      progressDiv.style.display = 'none';
      resultDiv.style.display = 'block';
    }, 500);
    
    // 更新状态
    await loadAccountStatus();
    showToast('同步成功！', 'success');
    
  } catch (e) {
    document.getElementById('syncProgressText').textContent = '同步失败: ' + e.message;
    showToast(e.message || '同步失败', 'error');
    
    setTimeout(() => {
      progressDiv.style.display = 'none';
    }, 2000);
  } finally {
    btn.disabled = false;
  }
}

// 自动同步开关
async function handleAutoSyncToggle(e) {
  const config = await window.SyncModule.getSyncConfig();
  config.autoSync = e.target.checked;
  await window.SyncModule.saveSyncConfig(config);
  showToast(e.target.checked ? '已开启自动同步' : '已关闭自动同步', 'info');
}
