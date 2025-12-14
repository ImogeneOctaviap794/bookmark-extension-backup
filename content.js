// Bookmark Sidebar - Content Script
(function() {
  let injected = false;
  let bookmarks = [];
  let apiConfig = null;

  // Listen for toggle message
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (msg.action === 'toggleSidebar') {
      toggle();
      respond({ ok: true });
    }
    return true;
  });

  async function toggle() {
    if (!injected) await inject();
    const el = document.getElementById('bookmark-sidebar');
    if (el) {
      el.classList.toggle('open');
      if (el.classList.contains('open')) {
        await loadData();
        document.getElementById('sbInput').focus();
      }
    }
  }

  async function inject() {
    // CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('sidebar.css');
    document.head.appendChild(link);

    // HTML
    const res = await fetch(chrome.runtime.getURL('sidebar.html'));
    const html = await res.text();
    const div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div.firstElementChild);

    injected = true;
    bindEvents();
  }

  function bindEvents() {
    // Close
    document.getElementById('sbClose').onclick = () => {
      document.getElementById('bookmark-sidebar').classList.remove('open');
    };

    // New chat
    document.getElementById('sbNewChat').onclick = newChat;

    // Send
    document.getElementById('sbSend').onclick = send;
    
    const input = document.getElementById('sbInput');
    input.onkeypress = (e) => {
      if (e.key === 'Enter') send();
    };
    
    // 阻止键盘事件冒泡，让 Ctrl+C/V 等快捷键正常工作
    input.onkeydown = (e) => e.stopPropagation();
    input.onkeyup = (e) => e.stopPropagation();

    // Tags
    document.querySelectorAll('.sb-tag').forEach(t => {
      t.onclick = () => {
        document.getElementById('sbInput').value = t.dataset.q;
        send();
      };
    });

    // Click outside
    document.addEventListener('click', (e) => {
      const sb = document.getElementById('bookmark-sidebar');
      if (sb?.classList.contains('open') && !sb.contains(e.target)) {
        sb.classList.remove('open');
      }
    });
  }

  async function loadData() {
    try {
      // 通过 background 获取书签（content script 无法直接访问 bookmarks API）
      const response = await chrome.runtime.sendMessage({ action: 'getBookmarks' });
      if (response.error) {
        throw new Error(response.error);
      }
      bookmarks = response.bookmarks || [];
      console.log('[Bookmark Sidebar] Loaded', bookmarks.length, 'bookmarks');

      // API config
      const r = await chrome.storage.local.get(['apiConfig']);
      apiConfig = r.apiConfig;
    } catch (e) {
      console.error('[Bookmark Sidebar] Load error:', e);
      addAiMsg('加载书签失败: ' + e.message);
    }
  }

  function newChat() {
    document.getElementById('sbChat').innerHTML = `
      <div class="sb-msg sb-msg-ai">
        <div class="sb-text">搜索你的书签，试试这些：</div>
        <div class="sb-tags">
          <button class="sb-tag" data-q="GitHub">GitHub</button>
          <button class="sb-tag" data-q="AI">AI</button>
          <button class="sb-tag" data-q="文档">文档</button>
          <button class="sb-tag" data-q="工具">工具</button>
        </div>
      </div>
    `;
    document.querySelectorAll('.sb-tag').forEach(t => {
      t.onclick = () => {
        document.getElementById('sbInput').value = t.dataset.q;
        send();
      };
    });
  }

  async function send() {
    const input = document.getElementById('sbInput');
    const q = input.value.trim();
    if (!q) return;

    addUserMsg(q);
    input.value = '';

    const loadId = addLoading();

    // 确保书签已加载
    if (bookmarks.length === 0) {
      await loadData();
    }

    // 先本地搜索
    const localResults = search(q);
    
    // 如果本地结果少于3个，用AI智能搜索
    if (localResults.length < 3 && apiConfig?.apiUrl && apiConfig?.apiKey) {
      try {
        const aiResults = await aiSearch(q, localResults);
        removeEl(loadId);
        if (aiResults && aiResults.results?.length > 0) {
          addResults(aiResults.summary || `AI 找到 ${aiResults.results.length} 个相关书签`, aiResults.results);
          if (aiResults.tip) {
            addAiMsg(aiResults.tip);
          }
        } else if (localResults.length > 0) {
          addResults(`找到 ${localResults.length} 个结果`, localResults);
        } else {
          addAiMsg(aiResults?.tip || `没有找到「${q}」相关书签`);
        }
      } catch (e) {
        console.error('AI search error:', e);
        removeEl(loadId);
        if (localResults.length > 0) {
          addResults(`找到 ${localResults.length} 个结果`, localResults);
        } else {
          addAiMsg(`没有找到「${q}」相关书签`);
        }
      }
    } else {
      removeEl(loadId);
      if (localResults.length > 0) {
        addResults(`找到 ${localResults.length} 个结果`, localResults);
      } else {
        addAiMsg(`没有找到「${q}」相关书签。共 ${bookmarks.length} 个书签可搜索。`);
      }
    }
  }

  async function aiSearch(query, localResults) {
    // 获取所有分类
    const folders = [...new Set(bookmarks.map(b => b.folder).filter(Boolean))];
    
    // 构建书签列表（限制数量避免 token 过长）
    const bookmarkList = bookmarks.slice(0, 200).map(b => 
      `- ${b.title} | ${b.folder || '未分类'} | ${b.url}`
    ).join('\n');

    const systemPrompt = `你是书签搜索助手。根据用户查询从书签列表中找到最相关的书签。

分类: ${folders.slice(0, 20).join(', ')}

书签列表:
${bookmarkList}

返回 JSON 格式:
{
  "summary": "简短总结（1句话中文）",
  "results": [
    {"title": "精确匹配的书签标题", "reason": "推荐理由（10字内）"}
  ],
  "tip": "如果没找到合适的，给个建议（可选）"
}

规则:
- 最多返回6个结果，按相关度排序
- title 必须与书签列表中的标题完全匹配
- 用中文回复`;

    const response = await fetch(apiConfig.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiConfig.apiKey}`
      },
      body: JSON.stringify({
        model: apiConfig.apiModel || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query }
        ],
        temperature: 0.2,
        max_tokens: 600
      })
    });

    if (!response.ok) {
      throw new Error('API request failed');
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    // 解析 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    
    const result = JSON.parse(jsonMatch[0]);
    
    // 匹配实际书签数据
    if (result.results) {
      result.results = result.results.map(r => {
        const found = bookmarks.find(b => 
          b.title === r.title || 
          b.title.includes(r.title) || 
          r.title.includes(b.title)
        );
        if (found) {
          return { ...found, reason: r.reason };
        }
        return null;
      }).filter(Boolean);
    }
    
    return result;
  }

  function search(q) {
    const kw = q.toLowerCase().split(/\s+/);
    return bookmarks
      .map(b => {
        let score = 0;
        const t = (b.title || '').toLowerCase();
        const u = (b.url || '').toLowerCase();
        const f = (b.folder || '').toLowerCase();
        for (const k of kw) {
          if (t.includes(k)) score += 3;
          if (u.includes(k)) score += 2;
          if (f.includes(k)) score += 1;
        }
        return { ...b, score };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }

  function addUserMsg(text) {
    const chat = document.getElementById('sbChat');
    const div = document.createElement('div');
    div.className = 'sb-msg sb-msg-user';
    div.innerHTML = `<div class="sb-text">${esc(text)}</div>`;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  }

  function addAiMsg(text) {
    const chat = document.getElementById('sbChat');
    const div = document.createElement('div');
    div.className = 'sb-msg sb-msg-ai';
    div.innerHTML = `<div class="sb-text">${esc(text)}</div>`;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  }

  function addResults(summary, results) {
    const chat = document.getElementById('sbChat');
    const div = document.createElement('div');
    div.className = 'sb-msg sb-msg-ai';
    
    const items = results.map(r => {
      let icon = '';
      try {
        icon = `https://www.google.com/s2/favicons?domain=${new URL(r.url).hostname}&sz=32`;
      } catch(e) {}
      const reasonHtml = r.reason ? `<div class="sb-result-reason">✨ ${esc(r.reason)}</div>` : '';
      return `
        <a class="sb-result" href="${esc(r.url)}" target="_blank">
          <div class="sb-result-icon">
            <img src="${icon}" onerror="this.parentElement.innerHTML='📑'">
          </div>
          <div class="sb-result-info">
            <div class="sb-result-title">${esc(r.title || '无标题')}</div>
            <div class="sb-result-folder">${esc(r.folder || '未分类')}</div>
            ${reasonHtml}
          </div>
          <svg class="sb-result-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M7 17L17 7M17 7H7M17 7V17"/>
          </svg>
        </a>
      `;
    }).join('');

    div.innerHTML = `
      <div class="sb-text">${esc(summary)}</div>
      <div class="sb-results">${items}</div>
    `;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  }

  function addLoading() {
    const chat = document.getElementById('sbChat');
    const div = document.createElement('div');
    div.className = 'sb-msg sb-msg-ai';
    div.id = 'loading-' + Date.now();
    div.innerHTML = `<div class="sb-loading"><span></span><span></span><span></span></div>`;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    return div.id;
  }

  function removeEl(id) {
    document.getElementById(id)?.remove();
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }
})();
