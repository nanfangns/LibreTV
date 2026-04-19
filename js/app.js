// 全局变量
let selectedAPIs = JSON.parse(localStorage.getItem('selectedAPIs') || '["tyyszy", "bfzy", "ruyi", "liteapple"]'); // 默认选中资源
let customAPIs = JSON.parse(localStorage.getItem('customAPIs') || '[]'); // 存储自定义API列表
const ADULT_INDEX_STORAGE_PREFIX = 'adultIndexCache:';

// 添加当前播放的集数索引
let currentEpisodeIndex = 0;
// 添加当前视频的所有集数
let currentEpisodes = [];
// 添加当前视频的标题
let currentVideoTitle = '';
// 全局变量用于倒序状态
let episodesReversed = false;

function slugifyKey(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'site';
}

function getAdultIndexCacheKey(indexKey) {
    return `${ADULT_INDEX_STORAGE_PREFIX}${indexKey}`;
}

function readAdultIndexCache(indexKey) {
    try {
        const cacheKey = getAdultIndexCacheKey(indexKey);
        const raw = localStorage.getItem(cacheKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const ttl = window.ADULT_INDEX_CACHE_TTL_MS || 0;
        if (!parsed || !parsed.timestamp || !Array.isArray(parsed.sites)) return null;
        if (ttl > 0 && (Date.now() - parsed.timestamp) > ttl) return null;
        return parsed.sites;
    } catch (error) {
        console.warn('读取成人索引缓存失败:', error);
        return null;
    }
}

function writeAdultIndexCache(indexKey, sites) {
    try {
        const cacheKey = getAdultIndexCacheKey(indexKey);
        localStorage.setItem(cacheKey, JSON.stringify({
            timestamp: Date.now(),
            sites
        }));
    } catch (error) {
        console.warn('写入成人索引缓存失败:', error);
    }
}

function normalizeAdultIndexSites(indexConfig, sites) {
    const indexKey = slugifyKey(indexConfig.key);
    const normalized = {};

    sites.forEach((site, index) => {
        if (!site || typeof site.api !== 'string') return;
        const apiUrl = site.api.trim();
        if (!/^https?:\/\//i.test(apiUrl)) return;
        if (typeof site.type === 'number' && site.type === 3) return; // 跳过需要爬虫的源

        const baseSlug = slugifyKey(site.key || site.name || `site_${index}`);
        const uniqueKey = `${indexKey}_${baseSlug}_${index}`;
        const name = `${site.name || site.key || '成人源'} · ${indexConfig.name}`;

        normalized[uniqueKey] = {
            api: apiUrl.replace(/\/$/, ''),
            name,
            adult: true,
            fromIndex: indexConfig.key
        };
    });

    return normalized;
}

async function loadAdultIndexSources() {
    const indexSources = window.ADULT_INDEX_SOURCES || [];
    if (indexSources.length === 0) return;

    const mergedSites = {};

    for (const indexConfig of indexSources) {
        try {
            const cachedSites = readAdultIndexCache(indexConfig.key);
            let sites = cachedSites;

            if (!sites) {
                const response = await fetch(indexConfig.url);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                const data = await response.json();
                sites = Array.isArray(data?.sites) ? data.sites : [];
                writeAdultIndexCache(indexConfig.key, sites);
            }

            Object.assign(mergedSites, normalizeAdultIndexSites(indexConfig, sites));
        } catch (error) {
            console.warn(`加载成人索引源失败: ${indexConfig.name}`, error);
        }
    }

    if (Object.keys(mergedSites).length > 0) {
        extendAPISites(mergedSites);
    }
}

function updateAdultBulkActionsVisibility() {
    const adultBulkActions = document.getElementById('adultBulkActions');
    const yellowFilterToggle = document.getElementById('yellowFilterToggle');
    if (!adultBulkActions || !yellowFilterToggle) return;
    adultBulkActions.style.display = yellowFilterToggle.checked ? 'none' : '';
}

// 页面初始化
document.addEventListener('DOMContentLoaded', async function () {
    await loadAdultIndexSources();
    // 初始化API复选框
    initAPICheckboxes();

    // 初始化自定义API列表
    renderCustomAPIsList();

    // 初始化显示选中的API数量
    updateSelectedApiCount();

    // 渲染搜索历史
    renderSearchHistory();

    // 设置默认API选择（如果是第一次加载）
    if (!localStorage.getItem('hasInitializedDefaults')) {
        // 默认选中资源
        selectedAPIs = ["tyyszy", "bfzy", "ruyi", "liteapple"];
        localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));

        // 默认选中过滤开关
        localStorage.setItem('yellowFilterEnabled', 'true');
        localStorage.setItem(PLAYER_CONFIG.adFilteringStorage, 'true');

        // 默认启用豆瓣功能
        localStorage.setItem('doubanEnabled', 'true');

        // 标记已初始化默认值
        localStorage.setItem('hasInitializedDefaults', 'true');
    }

    // 设置黄色内容过滤器开关初始状态
    const yellowFilterToggle = document.getElementById('yellowFilterToggle');
    if (yellowFilterToggle) {
        yellowFilterToggle.checked = localStorage.getItem('yellowFilterEnabled') === 'true';
    }
    updateAdultBulkActionsVisibility();

    // 设置广告过滤开关初始状态
    const adFilterToggle = document.getElementById('adFilterToggle');
    if (adFilterToggle) {
        adFilterToggle.checked = localStorage.getItem(PLAYER_CONFIG.adFilteringStorage) !== 'false'; // 默认为true
    }

    // 设置事件监听器
    setupEventListeners();

    // 初始检查成人API选中状态
    setTimeout(checkAdultAPIsSelected, 100);

    // --- 页面功能初始化 (原本在 index-page.js) ---
    // 1. 免责声明弹窗
    const hasSeenDisclaimer = localStorage.getItem('hasSeenDisclaimer');
    if (!hasSeenDisclaimer) {
        const disclaimerModal = document.getElementById('disclaimerModal');
        if (disclaimerModal) {
            disclaimerModal.style.display = 'flex';
            const acceptBtn = document.getElementById('acceptDisclaimerBtn');
            if (acceptBtn) {
                acceptBtn.addEventListener('click', function () {
                    localStorage.setItem('hasSeenDisclaimer', 'true');
                    disclaimerModal.style.display = 'none';
                });
            }
        }
    }

    // 2. URL 搜索参数处理 (/s=keyword 或 ?s=keyword)
    const path = window.location.pathname;
    const searchPrefix = '/s=';
    const urlParams = new URLSearchParams(window.location.search);
    const searchQuery = urlParams.get('s');

    let targetKeyword = '';
    if (path.startsWith(searchPrefix)) {
        targetKeyword = decodeURIComponent(path.substring(searchPrefix.length));
    } else if (searchQuery) {
        targetKeyword = searchQuery;
    }

    if (targetKeyword) {
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.value = targetKeyword;
            if (typeof toggleClearButton === 'function') toggleClearButton();
            setTimeout(() => {
                if (typeof search === 'function') search(true); // 使用 true 表示是初始化或历史导航，不 pushState
                // 规范化 URL 路径
                try {
                    window.history.replaceState(
                        { search: targetKeyword },
                        `搜索: ${targetKeyword} - 南方许`,
                        `/s=${encodeURIComponent(targetKeyword)}`
                    );
                } catch (e) {
                    console.error('更新 URL 失败:', e);
                }
            }, 300);
        }
    }

    // 3. 处理浏览器前进后退
    window.addEventListener('popstate', function (event) {
        if (event.state && event.state.search) {
            // 如果历史记录中有搜索关键词，执行搜索但不推送新历史
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.value = event.state.search;
                if (typeof toggleClearButton === 'function') toggleClearButton();
                search(true);
            }
        } else {
            // 否则返回首页状态
            resetSearchArea(true);
        }
    });
    // 4. 初始化豆瓣推荐 (显式调用确保逻辑准时上线)
    if (typeof initDouban === 'function') {
        initDouban();
    }
});

// 初始化API复选框
function initAPICheckboxes() {
    const container = document.getElementById('apiCheckboxes');
    container.innerHTML = '';

    // 添加普通API组标题
    const normaldiv = document.createElement('div');
    normaldiv.id = 'normaldiv';
    normaldiv.className = 'grid grid-cols-2 gap-2';
    const normalTitle = document.createElement('div');
    normalTitle.className = 'api-group-title';
    normalTitle.textContent = '普通资源';
    normaldiv.appendChild(normalTitle);

    // 创建普通API源的复选框
    Object.keys(API_SITES).forEach(apiKey => {
        const api = API_SITES[apiKey];
        if (api.adult) return; // 跳过成人内容API，稍后添加

        const checked = selectedAPIs.includes(apiKey);

        const checkbox = document.createElement('div');
        checkbox.className = 'flex items-center';
        checkbox.innerHTML = `
            <input type="checkbox" id="api_${apiKey}" 
                   class="form-checkbox h-3 w-3 text-blue-600 bg-[#222] border border-[#333]" 
                   ${checked ? 'checked' : ''} 
                   data-api="${apiKey}">
            <label for="api_${apiKey}" class="ml-1 text-xs text-gray-400 truncate">${api.name}</label>
        `;
        normaldiv.appendChild(checkbox);

        // 添加事件监听器
        checkbox.querySelector('input').addEventListener('change', function () {
            updateSelectedAPIs();
            checkAdultAPIsSelected();
        });
    });
    container.appendChild(normaldiv);

    // 添加成人API列表
    addAdultAPI();

    // 初始检查成人内容状态
    checkAdultAPIsSelected();
}

// 添加成人API列表
function addAdultAPI() {
    if (document.getElementById('adultdiv')) return;
    // 仅在隐藏设置为false时添加成人API组
    if (!HIDE_BUILTIN_ADULT_APIS && (localStorage.getItem('yellowFilterEnabled') === 'false')) {
        const container = document.getElementById('apiCheckboxes');

        // 添加成人API组标题
        const adultdiv = document.createElement('div');
        adultdiv.id = 'adultdiv';
        adultdiv.className = 'grid grid-cols-2 gap-2';
        const adultTitle = document.createElement('div');
        adultTitle.className = 'api-group-title adult';
        adultTitle.innerHTML = `黄色资源采集站 <span class="adult-warning">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
        </span>`;
        adultdiv.appendChild(adultTitle);

        // 创建成人API源的复选框
        Object.keys(API_SITES).forEach(apiKey => {
            const api = API_SITES[apiKey];
            if (!api.adult) return; // 仅添加成人内容API

            const checked = selectedAPIs.includes(apiKey);

            const checkbox = document.createElement('div');
            checkbox.className = 'flex items-center';
            checkbox.innerHTML = `
                <input type="checkbox" id="api_${apiKey}" 
                       class="form-checkbox h-3 w-3 text-blue-600 bg-[#222] border border-[#333] api-adult" 
                       ${checked ? 'checked' : ''} 
                       data-api="${apiKey}">
                <label for="api_${apiKey}" class="ml-1 text-xs google-text-accent truncate">${api.name}</label>
            `;
            adultdiv.appendChild(checkbox);

            // 添加事件监听器
            checkbox.querySelector('input').addEventListener('change', function () {
                updateSelectedAPIs();
                checkAdultAPIsSelected();
            });
        });
        container.appendChild(adultdiv);
    }
}

// 检查是否有成人API被选中
function checkAdultAPIsSelected() {
    // 查找所有内置成人API复选框
    const adultBuiltinCheckboxes = document.querySelectorAll('#apiCheckboxes .api-adult:checked');

    // 查找所有自定义成人API复选框
    const customApiCheckboxes = document.querySelectorAll('#customApisList .api-adult:checked');

    const hasAdultSelected = adultBuiltinCheckboxes.length > 0 || customApiCheckboxes.length > 0;

    const yellowFilterToggle = document.getElementById('yellowFilterToggle');
    const yellowFilterContainer = yellowFilterToggle.closest('div').parentNode;
    const filterDescription = yellowFilterContainer.querySelector('p.filter-description');

    // 如果选择了成人API，禁用黄色内容过滤器
    if (hasAdultSelected) {
        yellowFilterToggle.checked = false;
        yellowFilterToggle.disabled = true;
        localStorage.setItem('yellowFilterEnabled', 'false');

        // 添加禁用样式
        yellowFilterContainer.classList.add('filter-disabled');

        // 修改描述文字
        if (filterDescription) {
            filterDescription.innerHTML = '<strong class="google-text-accent">选中黄色资源站时无法启用此过滤</strong>';
        }

        // 移除提示信息（如果存在）
        const existingTooltip = yellowFilterContainer.querySelector('.filter-tooltip');
        if (existingTooltip) {
            existingTooltip.remove();
        }
    } else {
        // 启用黄色内容过滤器
        yellowFilterToggle.disabled = false;
        yellowFilterContainer.classList.remove('filter-disabled');

        // 恢复原来的描述文字
        if (filterDescription) {
            filterDescription.innerHTML = '过滤"伦理片"等黄色内容';
        }

        // 移除提示信息
        const existingTooltip = yellowFilterContainer.querySelector('.filter-tooltip');
        if (existingTooltip) {
            existingTooltip.remove();
        }
    }

    // 当过滤已关闭但成人分组尚未渲染时，补充渲染
    if (!document.getElementById('adultdiv') &&
        !HIDE_BUILTIN_ADULT_APIS &&
        localStorage.getItem('yellowFilterEnabled') === 'false') {
        addAdultAPI();
    }

    updateAdultBulkActionsVisibility();
}

// 渲染自定义API列表
function renderCustomAPIsList() {
    const container = document.getElementById('customApisList');
    if (!container) return;

    if (customAPIs.length === 0) {
        container.innerHTML = '<p class="text-xs text-gray-500 text-center my-2">未添加自定义API</p>';
        return;
    }

    container.innerHTML = '';
    customAPIs.forEach((api, index) => {
        const apiItem = document.createElement('div');
        apiItem.className = 'flex items-center justify-between p-1 mb-1 bg-[#222] rounded';
        const textColorClass = api.isAdult ? 'google-text-accent' : 'text-white';
        const adultTag = api.isAdult ? '<span class="text-xs google-text-accent mr-1">(18+)</span>' : '';
        // 新增 detail 地址显示
        const detailLine = api.detail ? `<div class="text-xs text-gray-400 truncate">detail: ${api.detail}</div>` : '';
        apiItem.innerHTML = `
            <div class="flex items-center flex-1 min-w-0">
                <input type="checkbox" id="custom_api_${index}" 
                       class="form-checkbox h-3 w-3 text-blue-600 mr-1 ${api.isAdult ? 'api-adult' : ''}" 
                       ${selectedAPIs.includes('custom_' + index) ? 'checked' : ''} 
                       data-custom-index="${index}">
                <div class="flex-1 min-w-0">
                    <div class="text-xs font-medium ${textColorClass} truncate">
                        ${adultTag}${api.name}
                    </div>
                    <div class="text-xs text-gray-500 truncate">${api.url}</div>
                    ${detailLine}
                </div>
            </div>
            <div class="flex items-center">
                <button class="text-blue-500 hover:text-blue-700 text-xs px-1" onclick="editCustomApi(${index})">✎</button>
                <button class="text-red-500 hover:text-red-700 text-xs px-1" onclick="removeCustomApi(${index})">✕</button>
            </div>
        `;
        container.appendChild(apiItem);
        apiItem.querySelector('input').addEventListener('change', function () {
            updateSelectedAPIs();
            checkAdultAPIsSelected();
        });
    });
}

// 编辑自定义API
function editCustomApi(index) {
    if (index < 0 || index >= customAPIs.length) return;
    const api = customAPIs[index];
    document.getElementById('customApiName').value = api.name;
    document.getElementById('customApiUrl').value = api.url;
    document.getElementById('customApiDetail').value = api.detail || '';
    const isAdultInput = document.getElementById('customApiIsAdult');
    if (isAdultInput) isAdultInput.checked = api.isAdult || false;
    const form = document.getElementById('addCustomApiForm');
    if (form) {
        form.classList.remove('hidden');
        const buttonContainer = form.querySelector('div:last-child');
        buttonContainer.innerHTML = `
            <button onclick="updateCustomApi(${index})" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs">更新</button>
            <button onclick="cancelEditCustomApi()" class="bg-[#444] hover:bg-[#555] text-white px-3 py-1 rounded text-xs">取消</button>
        `;
    }
}

// 更新自定义API
function updateCustomApi(index) {
    if (index < 0 || index >= customAPIs.length) return;
    const nameInput = document.getElementById('customApiName');
    const urlInput = document.getElementById('customApiUrl');
    const detailInput = document.getElementById('customApiDetail');
    const isAdultInput = document.getElementById('customApiIsAdult');
    const name = nameInput.value.trim();
    let url = urlInput.value.trim();
    const detail = detailInput ? detailInput.value.trim() : '';
    const isAdult = isAdultInput ? isAdultInput.checked : false;
    if (!name || !url) {
        showToast('请输入API名称和链接', 'warning');
        return;
    }
    if (!/^https?:\/\/.+/.test(url)) {
        showToast('API链接格式不正确，需以http://或https://开头', 'warning');
        return;
    }
    if (url.endsWith('/')) url = url.slice(0, -1);
    // 保存 detail 字段
    customAPIs[index] = { name, url, detail, isAdult };
    localStorage.setItem('customAPIs', JSON.stringify(customAPIs));
    renderCustomAPIsList();
    checkAdultAPIsSelected();
    restoreAddCustomApiButtons();
    nameInput.value = '';
    urlInput.value = '';
    if (detailInput) detailInput.value = '';
    if (isAdultInput) isAdultInput.checked = false;
    document.getElementById('addCustomApiForm').classList.add('hidden');
    showToast('已更新自定义API: ' + name, 'success');
}

// 取消编辑自定义API
function cancelEditCustomApi() {
    // 清空表单
    document.getElementById('customApiName').value = '';
    document.getElementById('customApiUrl').value = '';
    document.getElementById('customApiDetail').value = '';
    const isAdultInput = document.getElementById('customApiIsAdult');
    if (isAdultInput) isAdultInput.checked = false;

    // 隐藏表单
    document.getElementById('addCustomApiForm').classList.add('hidden');

    // 恢复添加按钮
    restoreAddCustomApiButtons();
}

// 恢复自定义API添加按钮
function restoreAddCustomApiButtons() {
    const form = document.getElementById('addCustomApiForm');
    const buttonContainer = form.querySelector('div:last-child');
    buttonContainer.innerHTML = `
        <button onclick="addCustomApi()" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs">添加</button>
        <button onclick="cancelAddCustomApi()" class="bg-[#444] hover:bg-[#555] text-white px-3 py-1 rounded text-xs">取消</button>
    `;
}

// 更新选中的API列表
function updateSelectedAPIs() {
    // 获取所有内置API复选框
    const builtInApiCheckboxes = document.querySelectorAll('#apiCheckboxes input:checked');

    // 获取选中的内置API
    const builtInApis = Array.from(builtInApiCheckboxes).map(input => input.dataset.api);

    // 获取选中的自定义API
    const customApiCheckboxes = document.querySelectorAll('#customApisList input:checked');
    const customApiIndices = Array.from(customApiCheckboxes).map(input => 'custom_' + input.dataset.customIndex);

    // 合并内置和自定义API
    selectedAPIs = [...builtInApis, ...customApiIndices];

    // 保存到localStorage
    localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));

    // 更新显示选中的API数量
    updateSelectedApiCount();
}

// 更新选中的API数量显示
function updateSelectedApiCount() {
    const countEl = document.getElementById('selectedApiCount');
    if (countEl) {
        countEl.textContent = selectedAPIs.length;
    }
}

// 全选或取消全选API（支持普通/成人分组）
function selectAllAPIs(selectAll = true, group = 'all') {
    const checkboxes = document.querySelectorAll(
        '#apiCheckboxes input[type="checkbox"], #customApisList input[type="checkbox"]'
    );

    checkboxes.forEach(checkbox => {
        const isAdult = checkbox.classList.contains('api-adult');
        const shouldToggle = group === 'all' ||
            (group === 'adult' && isAdult) ||
            (group === 'normal' && !isAdult);

        if (shouldToggle) {
            checkbox.checked = selectAll;
        }
    });

    updateSelectedAPIs();
    checkAdultAPIsSelected();
}

// 显示添加自定义API表单
function showAddCustomApiForm() {
    const form = document.getElementById('addCustomApiForm');
    if (form) {
        form.classList.remove('hidden');
    }
}

// 取消添加自定义API - 修改函数来重用恢复按钮逻辑
function cancelAddCustomApi() {
    const form = document.getElementById('addCustomApiForm');
    if (form) {
        form.classList.add('hidden');
        document.getElementById('customApiName').value = '';
        document.getElementById('customApiUrl').value = '';
        document.getElementById('customApiDetail').value = '';
        const isAdultInput = document.getElementById('customApiIsAdult');
        if (isAdultInput) isAdultInput.checked = false;

        // 确保按钮是添加按钮
        restoreAddCustomApiButtons();
    }
}

// 添加自定义API
function addCustomApi() {
    const nameInput = document.getElementById('customApiName');
    const urlInput = document.getElementById('customApiUrl');
    const detailInput = document.getElementById('customApiDetail');
    const isAdultInput = document.getElementById('customApiIsAdult');
    const name = nameInput.value.trim();
    let url = urlInput.value.trim();
    const detail = detailInput ? detailInput.value.trim() : '';
    const isAdult = isAdultInput ? isAdultInput.checked : false;
    if (!name || !url) {
        showToast('请输入API名称和链接', 'warning');
        return;
    }
    if (!/^https?:\/\/.+/.test(url)) {
        showToast('API链接格式不正确，需以http://或https://开头', 'warning');
        return;
    }
    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }
    // 保存 detail 字段
    customAPIs.push({ name, url, detail, isAdult });
    localStorage.setItem('customAPIs', JSON.stringify(customAPIs));
    const newApiIndex = customAPIs.length - 1;
    selectedAPIs.push('custom_' + newApiIndex);
    localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));

    // 重新渲染自定义API列表
    renderCustomAPIsList();
    updateSelectedApiCount();
    checkAdultAPIsSelected();
    nameInput.value = '';
    urlInput.value = '';
    if (detailInput) detailInput.value = '';
    if (isAdultInput) isAdultInput.checked = false;
    document.getElementById('addCustomApiForm').classList.add('hidden');
    showToast('已添加自定义API: ' + name, 'success');
}

// 移除自定义API
function removeCustomApi(index) {
    if (index < 0 || index >= customAPIs.length) return;

    const apiName = customAPIs[index].name;

    // 从列表中移除API
    customAPIs.splice(index, 1);
    localStorage.setItem('customAPIs', JSON.stringify(customAPIs));

    // 从选中列表中移除此API
    const customApiId = 'custom_' + index;
    selectedAPIs = selectedAPIs.filter(id => id !== customApiId);

    // 更新大于此索引的自定义API索引
    selectedAPIs = selectedAPIs.map(id => {
        if (id.startsWith('custom_')) {
            const currentIndex = parseInt(id.replace('custom_', ''));
            if (currentIndex > index) {
                return 'custom_' + (currentIndex - 1);
            }
        }
        return id;
    });

    localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));

    // 重新渲染自定义API列表
    renderCustomAPIsList();

    // 更新选中的API数量
    updateSelectedApiCount();

    // 重新检查成人API选中状态
    checkAdultAPIsSelected();

    showToast('已移除自定义API: ' + apiName, 'info');
}

function toggleSettings(e) {
    const settingsPanel = document.getElementById('settingsPanel');
    if (!settingsPanel) return;

    if (settingsPanel.classList.contains('show')) {
        settingsPanel.classList.remove('show');
    } else {
        settingsPanel.classList.add('show');
    }

    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
}

// 原生 SHA256 实现
async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 事件监听器
function setupEventListeners() {
    // 回车搜索
    const searchInput = document.getElementById('searchInput');
    const stickySearchInput = document.getElementById('stickySearchInput');

    if (searchInput) {
        searchInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                search();
            }
        });
    }

    if (searchInput && stickySearchInput) {
        const syncSearchValue = (source, target) => {
            if (target.value !== source.value) {
                target.value = source.value;
            }
        };

        searchInput.addEventListener('input', function () {
            syncSearchValue(searchInput, stickySearchInput);
        });

        stickySearchInput.addEventListener('input', function () {
            syncSearchValue(stickySearchInput, searchInput);
            toggleClearButton();
        });

        stickySearchInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                search();
            }
        });
    }

    // 点击外部关闭设置面板和历史记录面板
    document.addEventListener('click', function (e) {
        // 关闭设置面板
        const settingsPanel = document.querySelector('#settingsPanel.show');
        const settingsButton = document.querySelector('#settingsPanel .close-btn');

        if (settingsPanel && settingsButton &&
            !settingsPanel.contains(e.target) &&
            !settingsButton.contains(e.target)) {
            settingsPanel.classList.remove('show');
        }

        // 关闭历史记录面板
        const historyPanel = document.querySelector('#historyPanel.show');
        const historyButton = document.querySelector('#historyPanel .close-btn');

        if (historyPanel && historyButton &&
            !historyPanel.contains(e.target) &&
            !historyButton.contains(e.target)) {
            historyPanel.classList.remove('show');
        }
    });

    // 黄色内容过滤开关事件绑定
    const yellowFilterToggle = document.getElementById('yellowFilterToggle');
    if (yellowFilterToggle) {
        yellowFilterToggle.addEventListener('change', function (e) {
            localStorage.setItem('yellowFilterEnabled', e.target.checked);

            // 控制黄色内容接口的显示状态
            const adultdiv = document.getElementById('adultdiv');
            if (adultdiv) {
                if (e.target.checked === true) {
                    adultdiv.style.display = 'none';
                } else if (e.target.checked === false) {
                    adultdiv.style.display = ''
                }
            } else {
                // 添加成人API列表
                addAdultAPI();
            }

            updateAdultBulkActionsVisibility();
        });
    }

    // 广告过滤开关事件绑定
    const adFilterToggle = document.getElementById('adFilterToggle');
    if (adFilterToggle) {
        adFilterToggle.addEventListener('change', function (e) {
            localStorage.setItem(PLAYER_CONFIG.adFilteringStorage, e.target.checked);
        });
    }
}

// 重置搜索区域
function resetSearchArea(skipPushState = false) {
    // 清理搜索结果
    document.getElementById('results').innerHTML = '';
    document.getElementById('searchInput').value = '';

    // 恢复搜索区域的样式
    document.getElementById('searchArea').classList.add('flex-1');
    document.getElementById('searchArea').classList.remove('mb-8');
    document.getElementById('resultsArea').classList.add('hidden');

    // 确保页脚正确显示，移除相对定位
    const footer = document.querySelector('.footer');
    if (footer) {
        footer.style.position = '';
    }

    // 如果有豆瓣功能，检查是否需要显示豆瓣推荐区域
    if (typeof updateDoubanVisibility === 'function') {
        updateDoubanVisibility();
    }

    // 重置URL为主页
    if (!skipPushState) {
        try {
            window.history.pushState(
                {},
                `南方许 - 免费在线视频搜索与观看平台`,
                `/`
            );
        } catch (e) {
            console.error('更新浏览器历史失败:', e);
        }
    }
    document.title = `南方许 - 免费在线视频搜索与观看平台`;
}

// 获取自定义API信息
function getCustomApiInfo(customApiIndex) {
    const index = parseInt(customApiIndex);
    if (isNaN(index) || index < 0 || index >= customAPIs.length) {
        return null;
    }
    return customAPIs[index];
}

// 辅助函数：生成视频卡片HTML
function createVideoCardHtml(item, hasCover) {
    const safeId = item.vod_id ? item.vod_id.toString().replace(/[^\w-]/g, '') : '';
    const safeName = (item.vod_name || '').toString()
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const sourceInfo = item.source_name ?
        `<span class="bg-cyan-500/10 text-cyan-400 text-xs px-2 py-0.5 rounded-full border border-cyan-500/20">${item.source_name}</span>` : '';
    const sourceCode = item.source_code || '';
    const apiUrlAttr = item.api_url ? `data-api-url="${item.api_url.replace(/"/g, '&quot;')}"` : '';

    return `
        <div class="card-hover bg-[#0a0f1a]/80 backdrop-blur-sm rounded-xl overflow-hidden cursor-pointer transition-all h-full shadow-lg border border-white/5 animate-fadeIn" 
             onclick="showDetails('${safeId}','${safeName}','${sourceCode}')" ${apiUrlAttr}>
            <div class="flex h-full">
                ${hasCover ? `
                <div class="relative flex-shrink-0 search-card-img-container bg-[#1a1c22] overflow-hidden skeleton" style="width: 100px; height: 140px;">
                    <img src="${item.vod_pic}" alt="${safeName}" 
                         class="h-full w-full object-cover smooth-img" 
                         onload="this.classList.add('loaded'); this.parentElement.classList.remove('skeleton');"
                         onerror="this.onerror=null; this.src='https://via.placeholder.com/300x450?text=无封面'; this.classList.add('object-contain','loaded'); this.parentElement.classList.remove('skeleton');" 
                         loading="lazy">
                    <div class="absolute inset-0 bg-gradient-to-r from-black/30 to-transparent"></div>
                </div>` : ''}
                
                <div class="p-3 flex flex-col flex-grow">
                    <div class="flex-grow">
                        <h3 class="font-semibold mb-2 break-words line-clamp-2 ${hasCover ? '' : 'text-center'}" title="${safeName}">${safeName}</h3>
                        <div class="flex flex-wrap ${hasCover ? '' : 'justify-center'} gap-1 mb-2">
                            ${(item.type_name || '').toString().replace(/</g, '&lt;') ?
            `<span class="text-xs py-0.5 px-1.5 rounded bg-opacity-20 bg-blue-500 text-blue-300">
                                  ${(item.type_name || '').toString().replace(/</g, '&lt;')}
                              </span>` : ''}
                            ${(item.vod_year || '') ?
            `<span class="text-xs py-0.5 px-1.5 rounded bg-opacity-20 bg-blue-500 google-text-accent">
                                  ${item.vod_year}
                              </span>` : ''}
                        </div>
                        <p class="text-gray-400 text-sm line-clamp-2 overflow-hidden ${hasCover ? '' : 'text-center'} mb-2">
                            ${(item.vod_remarks || '暂无介绍').toString().replace(/</g, '&lt;')}
                        </p>
                    </div>
                    <div class="flex justify-between items-center mt-auto pt-2 border-t border-gray-800/50">
                        ${sourceInfo ? `<div>${sourceInfo}</div>` : '<div></div>'}
                    </div>
                </div>
            </div>
        </div>
    `;
}

// 全局变量用于存储合并后的搜索结果
window.mergedSearchResults = new Map();

// 搜索功能 - 聚合优化版：支持去重、多源合并、流式增量加载
async function search(isHistoryNav = false) {
    const query = document.getElementById('searchInput').value.trim();
    if (!query) { showToast('请输入搜索内容', 'info'); return; }
    if (selectedAPIs.length === 0) { showToast('请至少选择一个API源', 'warning'); return; }

    showLoading('正在全网检索并聚合资源...');
    saveSearchHistory(query);

    // 1. 准备搜索界面
    const resultsDiv = document.getElementById('results');
    const resultsArea = document.getElementById('resultsArea');
    const searchArea = document.getElementById('searchArea');
    const searchResultsCount = document.getElementById('searchResultsCount');
    const doubanArea = document.getElementById('doubanArea');

    resultsDiv.innerHTML = ''; // 清空旧结果
    if (searchResultsCount) searchResultsCount.textContent = '0';
    searchArea.classList.remove('flex-1');
    searchArea.classList.add('mb-8');
    resultsArea.classList.remove('hidden');
    if (doubanArea) doubanArea.classList.add('hidden');

    // 重置合并结果 Map
    window.mergedSearchResults.clear();

    // 更新URL
    if (!isHistoryNav) {
        try {
            const encodedQuery = encodeURIComponent(query);
            window.history.pushState({ search: query }, `搜索: ${query} - 南方许`, `/s=${encodedQuery}`);
        } catch (e) { }
    }
    document.title = `搜索: ${query} - 南方许`;
    try {
        const safeSearchUrl = `${window.location.origin}/?s=${encodeURIComponent(query)}`;
        localStorage.setItem('lastSearchPage', safeSearchUrl);
        sessionStorage.setItem('playerReturnUrl', safeSearchUrl);
    } catch (e) { }

    const yellowFilterEnabled = localStorage.getItem('yellowFilterEnabled') === 'true';
    const bannedTags = ['伦理片', '福利', '里番动漫', '门事件', '萝莉少女', '制服诱惑', '国产传媒', 'cosplay', '黑丝诱惑', '无码', '日本无码', '有码', '日本有码', 'SWAG', '网红主播', '色情片', '同性片', '福利视频', '福利片'];

    // 定义增量更新/插入卡片的函数
    const updateOrInsertCard = (item) => {
        const safeName = (item.vod_name || '未知').trim();
        const year = (item.vod_year || '').trim();
        // 生成唯一 Key
        const key = year && year !== '0' ? `${safeName}|${year}` : safeName;
        const safeKey = key.replace(/'/g, "\\'").replace(/"/g, '&quot;');

        let mergedItem;

        if (window.mergedSearchResults.has(key)) {
            // 已存在，更新源列表
            mergedItem = window.mergedSearchResults.get(key);

            // 优化封面
            if ((!mergedItem.cover || !mergedItem.cover.startsWith('http')) && (item.vod_pic && item.vod_pic.startsWith('http'))) {
                mergedItem.cover = item.vod_pic;
                // 更新 DOM 中的封面
                const cardEl = document.querySelector(`div[data-key="${safeKey}"]`);
                if (cardEl) {
                    const imgEl = cardEl.querySelector('img');
                    if (imgEl) imgEl.src = item.vod_pic;
                }
            }

            mergedItem.sources.push({
                source_code: item.source_code,
                source_name: item.source_name,
                vod_id: item.vod_id,
                api_url: item.api_url,
                last_update: item.vod_time
            });

            // 更新 DOM 中的角标
            // 由于 key 可能包含特殊字符，建议用 Base64 或者 hash 做 DOM ID，这里简单替换
            // 为了稳健，我们直接遍历查找或者在 render 时生成更安全的 ID
            // 这里我们采用 data-key 属性查找更安全
            const cardEl = document.querySelector(`div[data-key="${safeKey}"]`);
            if (cardEl) {
                const badgeEl = cardEl.querySelector('.source-count-badge');
                if (badgeEl) {
                    badgeEl.innerHTML = `
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                        ${mergedItem.sources.length}个源
                    `;
                }
            }
        } else {
            // 新增
            mergedItem = {
                key: key,
                title: safeName,
                year: year,
                type: item.type_name,
                cover: item.vod_pic,
                remarks: item.vod_remarks,
                sources: [{
                    source_code: item.source_code,
                    source_name: item.source_name,
                    vod_id: item.vod_id,
                    api_url: item.api_url,
                    last_update: item.vod_time
                }]
            };
            window.mergedSearchResults.set(key, mergedItem);

            // 插入 DOM
            const html = createMergedVideoCardHtml(mergedItem);
            resultsDiv.insertAdjacentHTML('beforeend', html);

            // 更新总数显示
            if (searchResultsCount) {
                searchResultsCount.textContent = window.mergedSearchResults.size;
            }
        }
    };

    // 2. 流式加载控制
    let completedAPIs = 0;
    let hasResult = false;
    let minimumLoadTimer = null;

    // 强行在 2 秒后隐藏 Loading (无论是否加载完)，实现“即搜即看”体验
    minimumLoadTimer = setTimeout(() => {
        hideLoading();
        // 如果此时没有任何结果，可能网络慢，Loading 消失后用户可以看到空白或部分结果
    }, 2000);

    // 3. 并行发起请求（不阻塞，流式处理）
    selectedAPIs.forEach(apiId => {
        searchByAPIAndKeyWord(apiId, query)
            .then(results => {
                if (Array.isArray(results)) {
                    let filteredResults = results;
                    if (yellowFilterEnabled) {
                        filteredResults = results.filter(item => !bannedTags.some(tag => (item.type_name || '').includes(tag)));
                    }

                    if (filteredResults.length > 0) {
                        hasResult = true;
                        // 第一次有结果时，如果还没到2秒，也可以考虑提前隐藏 Loading？
                        // 用户说“出现2到3秒就行”，保持 2s 比较稳妥，或者 let loading finish automatically if fast.
                        // 但为了那种“流式”感，2秒强制结束 loading 是个好策略。
                        filteredResults.forEach(item => updateOrInsertCard(item));
                    }
                }
            })
            .catch(err => console.warn(`API ${apiId} error:`, err))
            .finally(() => {
                completedAPIs++;
                // 全部完成后
                if (completedAPIs === selectedAPIs.length) {
                    clearTimeout(minimumLoadTimer); // 如果全部完成早于2秒，清除定时器
                    hideLoading(); // 确保 Loading 关闭

                    // 如果最终一个结果都没有
                    if (window.mergedSearchResults.size === 0) {
                        resultsDiv.innerHTML = `
                            <div class="col-span-full text-center py-20 animate-fadeIn">
                                <svg class="mx-auto h-16 w-16 text-gray-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <h3 class="text-xl font-medium text-gray-400">未发现匹配资源</h3>
                                <p class="mt-2 text-gray-500">尝试缩减关键词或在侧边栏选中更多接口</p>
                            </div>
                        `;
                    }
                }
            });
    });
}

// 渲染合并后的结果列表 (保留但不再被 search 直接调用，用于辅助)
function renderMergedResults() {
    const resultsDiv = document.getElementById('results');
    const searchResultsCount = document.getElementById('searchResultsCount');

    // 转换为数组并按相关性排序（目前简单按来源数量排序，或者保持原序? 保持原序较好，因为通常第一个结果最匹配）
    // 但 Map 遍历顺序是插入顺序，大概率也是按相关性的（取决于第一个返回的API）。
    // 我们可以根据来源数量多少来微调排序，让热门资源排前面？暂不复杂化。
    const mergedList = Array.from(window.mergedSearchResults.values());

    if (searchResultsCount) searchResultsCount.textContent = mergedList.length;

    if (mergedList.length === 0) {
        resultsDiv.innerHTML = `
            <div class="col-span-full text-center py-20 animate-fadeIn">
                <svg class="mx-auto h-16 w-16 text-gray-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <h3 class="text-xl font-medium text-gray-400">未发现匹配资源</h3>
                <p class="mt-2 text-gray-500">尝试缩减关键词或在侧边栏选中更多接口</p>
            </div>
        `;
        return;
    }

    const html = mergedList.map(item => createMergedVideoCardHtml(item)).join('');
    resultsDiv.innerHTML = html;
}

// 生成合并后的视频卡片 HTML (修改版：增加 data-key)
function createMergedVideoCardHtml(item) {
    const hasCover = item.cover && item.cover.startsWith('http');
    const safeKey = item.key.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const sourceCount = item.sources.length;

    return `
        <div class="card-hover bg-[#0a0f1a]/80 backdrop-blur-sm rounded-xl overflow-hidden cursor-pointer transition-all h-full shadow-lg border border-white/5 animate-fadeIn" 
             data-key="${safeKey}"
             onclick="openMergedDetail('${safeKey}')">
            <div class="flex h-full">
                ${hasCover ? `
                <div class="relative flex-shrink-0 search-card-img-container bg-[#1a1c22] overflow-hidden skeleton" style="width: 100px; height: 140px;">
                    <img src="${item.cover}" alt="${item.title}" 
                         class="h-full w-full object-cover smooth-img" 
                         onload="this.classList.add('loaded'); this.parentElement.classList.remove('skeleton');"
                         onerror="this.onerror=null; this.src='https://via.placeholder.com/300x450?text=无封面'; this.classList.add('object-contain','loaded'); this.parentElement.classList.remove('skeleton');" 
                         loading="lazy">
                    <div class="absolute inset-0 bg-gradient-to-r from-black/30 to-transparent"></div>
                </div>` : ''}
                
                <div class="p-3 flex flex-col flex-grow">
                    <div class="flex-grow">
                        <h3 class="font-semibold mb-2 break-words line-clamp-2 ${hasCover ? '' : 'text-center'}" title="${item.title}">${item.title}</h3>
                        <div class="flex flex-wrap ${hasCover ? '' : 'justify-center'} gap-1 mb-2">
                             ${(item.type || '').toString().replace(/</g, '&lt;') ?
            `<span class="text-xs py-0.5 px-1.5 rounded bg-opacity-20 bg-blue-500 text-blue-300">
                                  ${(item.type || '').toString().replace(/</g, '&lt;')}
                              </span>` : ''}
                            ${(item.year || '') ?
            `<span class="text-xs py-0.5 px-1.5 rounded bg-opacity-20 bg-blue-500 google-text-accent">
                                  ${item.year}
                              </span>` : ''}
                        </div>
                        <p class="text-gray-400 text-sm line-clamp-2 overflow-hidden ${hasCover ? '' : 'text-center'} mb-2">
                            ${(item.remarks || '暂无介绍').toString().replace(/</g, '&lt;')}
                        </p>
                    </div>
                    <div class="flex justify-between items-center mt-auto pt-2 border-t border-gray-800/50">
                        <div class="source-count-badge">
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                            ${sourceCount}个源
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// 切换清空按钮的显示状态
function toggleClearButton() {
    const searchInput = document.getElementById('searchInput');
    const clearButton = document.getElementById('clearSearchInput');
    if (searchInput.value !== '') {
        clearButton.classList.remove('hidden');
    } else {
        clearButton.classList.add('hidden');
    }
}

// 清空搜索框内容
function clearSearchInput() {
    const searchInput = document.getElementById('searchInput');
    searchInput.value = '';
    const stickySearchInput = document.getElementById('stickySearchInput');
    if (stickySearchInput) {
        stickySearchInput.value = '';
    }
    const clearButton = document.getElementById('clearSearchInput');
    clearButton.classList.add('hidden');
}

// 劫持搜索框的value属性以检测外部修改
function hookInput() {
    const input = document.getElementById('searchInput');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

    // 重写 value 属性的 getter 和 setter
    Object.defineProperty(input, 'value', {
        get: function () {
            // 确保读取时返回字符串（即使原始值为 undefined/null）
            const originalValue = descriptor.get.call(this);
            return originalValue != null ? String(originalValue) : '';
        },
        set: function (value) {
            // 显式将值转换为字符串后写入
            const strValue = String(value);
            descriptor.set.call(this, strValue);
            this.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });

    // 初始化输入框值为空字符串（避免初始值为 undefined）
    input.value = '';
}
document.addEventListener('DOMContentLoaded', hookInput);

// 打开合并后的详情页
function openMergedDetail(key) {
    const item = window.mergedSearchResults.get(key);
    if (!item) {
        showToast('无法获取视频详情，请重新搜索', 'error');
        return;
    }

    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');

    // 设置标题
    modalTitle.innerHTML = `<span class="break-words">${item.title}</span> <span class="text-sm font-normal text-gray-400">(${item.year || '未知年份'})</span>`;
    currentVideoTitle = item.title;

    // 初始模态框结构 - 包含 Tab 容器 和 内容容器
    modalContent.innerHTML = `
        <!-- 源切换 Tab 栏 -->
        <div class="source-tabs-container" id="sourceTabs">
            <!-- Tabs will be inserted here -->
        </div>

        <!-- 详情内容加载区 -->
        <div id="sourceDetailContainer" class="detail-loading-container animate-fade-in">
            <!-- Content will be loaded here -->
        </div>
    `;

    modal.classList.remove('hidden');

    // 渲染 Tabs
    const tabsContainer = document.getElementById('sourceTabs');
    item.sources.forEach((source, index) => {
        const btn = document.createElement('button');
        btn.className = 'source-tab-btn';
        btn.textContent = source.source_name;
        btn.dataset.index = index;
        btn.onclick = () => switchSourceTab(key, index);
        tabsContainer.appendChild(btn);
    });

    // 默认选中第一个源
    if (item.sources.length > 0) {
        switchSourceTab(key, 0);
    }
}

// 切换数据源 Tab
function switchSourceTab(key, index) {
    const item = window.mergedSearchResults.get(key);
    if (!item || !item.sources[index]) return;

    // 更新 Tab 样式
    const tabs = document.querySelectorAll('.source-tab-btn');
    tabs.forEach((tab, idx) => {
        if (idx === index) {
            tab.classList.add('active');
            // 确保活动 Tab 可见 (滚动)
            tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        } else {
            tab.classList.remove('active');
        }
    });

    const source = item.sources[index];
    loadSourceDetail(source.source_code, source.vod_id, source.source_name);
}

// 加载特定源的详情内容
async function loadSourceDetail(sourceCode, vodId, sourceName) {
    const container = document.getElementById('sourceDetailContainer');

    // 显示加载中
    container.innerHTML = `
        <div class="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-cyan-500 mb-4"></div>
        <p class="text-gray-400 text-sm">正在请求 ${sourceName} ...</p>
    `;

    try {
        // 获取 API 基础信息
        // 内置或自定义
        let detailApiUrl = `/api/detail?id=${encodeURIComponent(vodId)}`;
        if (sourceCode.startsWith('custom_')) {
            const api = getCustomApiInfo(sourceCode.replace('custom_', ''));
            if (!api?.url) throw new Error('API config not found');
            detailApiUrl += `&source=custom&customApi=${encodeURIComponent(api.url)}`;
            if (api.detail) {
                detailApiUrl += `&customDetail=${encodeURIComponent(api.detail)}`;
            }
        } else if (API_SITES[sourceCode]) {
            detailApiUrl += `&source=${encodeURIComponent(sourceCode)}`;
        } else {
            throw new Error('未找到 API 配置');
        }

        if (!detailApiUrl) throw new Error('未找到 API 配置');

        // 构建详情URL
        const detailUrl = detailApiUrl;

        // 代理请求
        const response = await fetch(detailUrl, {
            signal: AbortSignal.timeout(20000)
        });

        if (!response.ok) throw new Error('API请求失败');

        const data = await response.json();
        if (!data || data.code !== 200) throw new Error(data?.msg || 'No detail data');
        const episodes = Array.isArray(data.episodes) ? data.episodes : [];
        const videoInfo = data.videoInfo || {};
        if (episodes.length === 0) throw new Error('No playable episodes found');
        const normalizedInfo = {
            vod_name: videoInfo.title || sourceName,
            vod_pic: videoInfo.cover || '',
            vod_content: videoInfo.desc || '',
            vod_year: videoInfo.year || '',
            vod_area: videoInfo.area || '',
            vod_director: videoInfo.director || '',
            vod_actor: videoInfo.actor || '',
            vod_remarks: videoInfo.remarks || ''
        };

        // [修复] 更新全局 currentEpisodes，确保点击播放时能传递正确的集数列表
        currentEpisodes = episodes;
        window.currentEpisodes = episodes;

        // 更新 UI
        renderSourceDetailContent(container, normalizedInfo, episodes, sourceCode, vodId, sourceName);

    } catch (error) {
        console.error('加载源详情失败:', error);
        container.innerHTML = `
            <div class="text-center py-8">
                <div class="text-red-400 mb-2">❌ 获取资源失败</div>
                <div class="text-gray-500 text-sm">${error.message || '请尝试切换其他源'}</div>
                <button onclick="loadSourceDetail('${sourceCode}', '${vodId}', '${sourceName}')" 
                        class="mt-4 px-4 py-2 bg-[#333] hover:bg-[#444] rounded text-sm text-white transition-colors">
                    重试
                </button>
            </div>
        `;
    }
}

// 渲染详情内容 (简介 + 选集)
function renderSourceDetailContent(container, info, episodes, sourceCode, vodId, sourceName) {
    // 简介信息
    const descriptionText = info.vod_content ? info.vod_content.replace(/<[^>]+>/g, '').trim() : '暂无简介';

    // 更新全局 currentEpisodes (用于播放器跳转上一集下一集，虽在此处不是必须，但保持一致性)
    // 注意：这里的 currentEpisodes 会被播放器页面覆盖，但在详情页点击播放时需要用到?
    // 其实 playVideo 会传递 index 和 source，播放器页面会重新获取或者使用传过去的。
    // 为了支持 toggleEpisodeOrder，我们需要局部存储当前的 episodes
    // 我们可以直接把 episodes 存到 container 的 dataset 或者闭包，或者简单点重新渲染。

    // 选集排序状态 (默认正序)
    let isReversed = false;

    // 内部函数：渲染集数按钮
    const renderEpisodesBtns = (reversed) => {
        const displayEpisodes = reversed ? [...episodes].reverse() : episodes;
        return displayEpisodes.map((epUrl, idx) => {
            // 计算真实索引
            const realIdx = reversed ? episodes.length - 1 - idx : idx;
            return `
                <button onclick="playVideo('${epUrl}','${info.vod_name.replace(/"/g, '&quot;')}', '${sourceCode}', ${realIdx}, '${vodId}')" 
                        class="px-4 py-2 bg-[#222] hover:bg-[#333] border border-[#333] rounded-lg transition-colors text-center episode-btn relative overflow-hidden group">
                    <span class="relative z-10">${realIdx + 1}</span>
                </button>
            `;
        }).join('');
    };

    container.innerHTML = `
        <div class="animate-fade-in">
            <!-- 简介区域 -->
            <div class="modal-detail-info mb-6">
                <div class="detail-grid">
                    ${info.type_name ? `<div class="detail-item"><span class="detail-label">类型:</span> <span class="detail-value">${info.type_name}</span></div>` : ''}
                    ${info.vod_year ? `<div class="detail-item"><span class="detail-label">年份:</span> <span class="detail-value">${info.vod_year}</span></div>` : ''}
                    ${info.vod_area ? `<div class="detail-item"><span class="detail-label">地区:</span> <span class="detail-value">${info.vod_area}</span></div>` : ''}
                    ${info.vod_director ? `<div class="detail-item"><span class="detail-label">导演:</span> <span class="detail-value">${info.vod_director}</span></div>` : ''}
                    ${info.vod_actor ? `<div class="detail-item"><span class="detail-label">主演:</span> <span class="detail-value">${info.vod_actor}</span></div>` : ''}
                </div>
                <div class="detail-desc mt-3">
                    <p class="detail-label">简介:</p>
                    <p class="detail-desc-content line-clamp-3 hover:line-clamp-none transition-all cursor-pointer" title="点击展开">${descriptionText}</p>
                </div>
            </div>

            <!-- 工具栏 -->
            <div class="flex items-center justify-between mb-4 border-t border-gray-800 pt-4">
                <div class="flex items-center gap-2">
                     <span class="text-sm text-gray-400">共 ${episodes.length} 集</span>
                </div>
                <div class="flex items-center gap-2">
                    <button id="reverseOrderBtn" class="px-3 py-1.5 bg-[#333] hover:bg-[#444] border border-[#444] rounded text-sm transition-colors flex items-center gap-1">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path>
                        </svg>
                        <span>倒序排列</span>
                    </button>
                    <button id="copyLinksBtn" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition-colors">
                        复制链接
                    </button>
                </div>
            </div>

            <!-- 选集列表 -->
            ${episodes.length > 0 ? `
                <div id="episodesList" class="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2 max-h-[400px] overflow-y-auto">
                    ${renderEpisodesBtns(false)}
                </div>
            ` : `<div class="text-center text-gray-500 py-10">暂无播放资源</div>`}
        </div>
    `;

    // 绑定事件
    if (episodes.length > 0) {
        // 倒序按钮
        container.querySelector('#reverseOrderBtn').onclick = function () {
            isReversed = !isReversed;
            const listEl = container.querySelector('#episodesList');
            listEl.innerHTML = renderEpisodesBtns(isReversed);
            this.querySelector('span').textContent = isReversed ? '正序排列' : '倒序排列';
            this.querySelector('svg').style.transform = isReversed ? 'rotate(180deg)' : 'rotate(0deg)';
        };

        // 复制链接按钮
        container.querySelector('#copyLinksBtn').onclick = function () {
            const links = (isReversed ? [...episodes].reverse() : episodes).join('\n');
            navigator.clipboard.writeText(links).then(() => {
                showToast(`已复制 ${episodes.length} 条链接`, 'success');
            }).catch(() => showToast('复制失败', 'error'));
        };
    }
}


// 更新播放视频函数，修改为使用/watch路径而不是直接打开player.html
function playVideo(url, vod_name, sourceCode, episodeIndex = 0, vodId = '') {


    // 获取当前路径作为返回页面
    let currentPath = window.location.href;

    const isSearchPage = currentPath.includes('/s=') || currentPath.includes('?s=');
    const storedSearchPage = localStorage.getItem('lastSearchPage');
    const normalizedSearchPage = isSearchPage ? (() => {
        try {
            const parsed = new URL(currentPath, window.location.origin);
            if (parsed.pathname.startsWith('/s=')) {
                const keyword = parsed.pathname.replace('/s=', '');
                return `${parsed.origin}/s=${encodeURIComponent(decodeURIComponent(keyword))}`;
            }
            if (parsed.searchParams.has('s')) {
                return `${parsed.origin}/s=${encodeURIComponent(parsed.searchParams.get('s') || '')}`;
            }
        } catch (e) { }
        return currentPath;
    })() : '';
    const returnTarget = storedSearchPage || (isSearchPage ? normalizedSearchPage : currentPath);

    // 构建播放页面URL，直接跳转至 player.html 以消除回退历史陷阱
    let playerUrl = `player.html?id=${vodId || ''}&source=${sourceCode || ''}&url=${encodeURIComponent(url)}&index=${episodeIndex}&title=${encodeURIComponent(vod_name || '')}`;

    // 添加返回URL参数 (直接传递给播放器)
    if (returnTarget) {
        playerUrl += `&returnUrl=${encodeURIComponent(returnTarget)}`;
    }

    // 保存当前状态到localStorage
    try {
        localStorage.setItem('currentVideoTitle', vod_name || '未知视频');
        localStorage.setItem('currentEpisodes', JSON.stringify(currentEpisodes));
        localStorage.setItem('currentEpisodeIndex', episodeIndex);
        localStorage.setItem('currentSourceCode', sourceCode || '');
        localStorage.setItem('lastPlayTime', Date.now());
        if (isSearchPage) {
            localStorage.setItem('lastSearchPage', normalizedSearchPage || currentPath);
        } else {
            localStorage.setItem('lastPageUrl', currentPath);
        }
        if (returnTarget && !returnTarget.includes('player.html')) {
            sessionStorage.setItem('playerReturnUrl', returnTarget);
        }
    } catch (e) {
        console.error('保存播放状态失败:', e);
    }

    // 在当前标签页中打开播放页面
    window.location.href = playerUrl;
}

// 弹出播放器页面
function showVideoPlayer(url) {
    // 在打开播放器前，隐藏详情弹窗
    const detailModal = document.getElementById('modal');
    if (detailModal) {
        detailModal.classList.add('hidden');
    }
    // 临时隐藏搜索结果和豆瓣区域，防止高度超出播放器而出现滚动条
    document.getElementById('resultsArea').classList.add('hidden');
    document.getElementById('doubanArea').classList.add('hidden');
    // 在框架中打开播放页面
    videoPlayerFrame = document.createElement('iframe');
    videoPlayerFrame.id = 'VideoPlayerFrame';
    videoPlayerFrame.className = 'fixed w-full h-screen z-40';
    videoPlayerFrame.src = url;
    document.body.appendChild(videoPlayerFrame);
    // 将焦点移入iframe
    videoPlayerFrame.focus();
}

// 关闭播放器页面
function closeVideoPlayer(home = false) {
    videoPlayerFrame = document.getElementById('VideoPlayerFrame');
    if (videoPlayerFrame) {
        videoPlayerFrame.remove();
        // 恢复搜索结果显示
        document.getElementById('resultsArea').classList.remove('hidden');
        // 关闭播放器时也隐藏详情弹窗
        const detailModal = document.getElementById('modal');
        if (detailModal) {
            detailModal.classList.add('hidden');
        }
        // 如果启用豆瓣区域则显示豆瓣区域
        if (localStorage.getItem('doubanEnabled') === 'true') {
            document.getElementById('doubanArea').classList.remove('hidden');
        }
    }
    if (home) {
        // 刷新主页
        window.location.href = '/'
    }
}

// 播放上一集
function playPreviousEpisode(sourceCode) {
    if (currentEpisodeIndex > 0) {
        const prevIndex = currentEpisodeIndex - 1;
        const prevUrl = currentEpisodes[prevIndex];
        playVideo(prevUrl, currentVideoTitle, sourceCode, prevIndex);
    }
}

// 播放下一集
function playNextEpisode(sourceCode) {
    if (currentEpisodeIndex < currentEpisodes.length - 1) {
        const nextIndex = currentEpisodeIndex + 1;
        const nextUrl = currentEpisodes[nextIndex];
        playVideo(nextUrl, currentVideoTitle, sourceCode, nextIndex);
    }
}

// 处理播放器加载错误
function handlePlayerError() {
    hideLoading();
    showToast('视频播放加载失败，请尝试其他视频源', 'error');
}

// 辅助函数用于渲染剧集按钮（使用当前的排序状态）
function renderEpisodes(vodName, sourceCode, vodId) {
    const episodes = episodesReversed ? [...currentEpisodes].reverse() : currentEpisodes;
    return episodes.map((episode, index) => {
        // 根据倒序状态计算真实的剧集索引
        const realIndex = episodesReversed ? currentEpisodes.length - 1 - index : index;
        return `
            <button id="episode-${realIndex}" onclick="playVideo('${episode}','${vodName.replace(/"/g, '&quot;')}', '${sourceCode}', ${realIndex}, '${vodId}')" 
                    class="px-4 py-2 bg-[#222] hover:bg-[#333] border border-[#333] rounded-lg transition-colors text-center episode-btn">
                ${realIndex + 1}
            </button>
        `;
    }).join('');
}

// 复制视频链接到剪贴板
function copyLinks() {
    const episodes = episodesReversed ? [...currentEpisodes].reverse() : currentEpisodes;
    const linkList = episodes.join('\r\n');
    navigator.clipboard.writeText(linkList).then(() => {
        showToast('播放链接已复制', 'success');
    }).catch(err => {
        showToast('复制失败，请检查浏览器权限', 'error');
    });
}

// 切换排序状态的函数
function toggleEpisodeOrder(sourceCode, vodId) {
    episodesReversed = !episodesReversed;
    // 重新渲染剧集区域，使用 currentVideoTitle 作为视频标题
    const episodesGrid = document.getElementById('episodesGrid');
    if (episodesGrid) {
        episodesGrid.innerHTML = renderEpisodes(currentVideoTitle, sourceCode, vodId);
    }

    // 更新按钮文本和箭头方向
    const toggleBtn = document.querySelector(`button[onclick="toggleEpisodeOrder('${sourceCode}', '${vodId}')"]`);
    if (toggleBtn) {
        toggleBtn.querySelector('span').textContent = episodesReversed ? '正序排列' : '倒序排列';
        const arrowIcon = toggleBtn.querySelector('svg');
        if (arrowIcon) {
            arrowIcon.style.transform = episodesReversed ? 'rotate(180deg)' : 'rotate(0deg)';
        }
    }
}

// 从URL导入配置
async function importConfigFromUrl() {
    // 创建模态框元素
    let modal = document.getElementById('importUrlModal');
    if (modal) {
        document.body.removeChild(modal);
    }

    modal = document.createElement('div');
    modal.id = 'importUrlModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-40';

    modal.innerHTML = `
        <div class="bg-[#191919] rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto relative">
            <button id="closeUrlModal" class="absolute top-4 right-4 text-gray-400 hover:text-white text-xl">&times;</button>
            
            <h3 class="text-xl font-bold mb-4">从URL导入配置</h3>
            
            <div class="mb-4">
                <input type="text" id="configUrl" placeholder="输入配置文件URL" 
                       class="w-full px-3 py-2 bg-[#222] border border-[#333] rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500">
            </div>
            
            <div class="flex justify-end space-x-2">
                <button id="confirmUrlImport" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">导入</button>
                <button id="cancelUrlImport" class="bg-[#444] hover:bg-[#555] text-white px-4 py-2 rounded">取消</button>
            </div>
        </div>`;

    document.body.appendChild(modal);

    // 关闭按钮事件
    document.getElementById('closeUrlModal').addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    // 取消按钮事件
    document.getElementById('cancelUrlImport').addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    // 确认导入按钮事件
    document.getElementById('confirmUrlImport').addEventListener('click', async () => {
        const url = document.getElementById('configUrl').value.trim();
        if (!url) {
            showToast('请输入配置文件URL', 'warning');
            return;
        }

        // 验证URL格式
        try {
            const urlObj = new URL(url);
            if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
                showToast('URL必须以http://或https://开头', 'warning');
                return;
            }
        } catch (e) {
            showToast('URL格式不正确', 'warning');
            return;
        }

        showLoading('正在从URL导入配置...');

        try {
            // 获取配置文件 - 直接请求URL
            const response = await fetch(url, {
                mode: 'cors',
                headers: {
                    'Accept': 'application/json'
                }
            });
            if (!response.ok) throw '获取配置文件失败';

            // 验证响应内容类型
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw '响应不是有效的JSON格式';
            }

            const config = await response.json();
            if (config.name !== '南方许TV-Settings') throw '配置文件格式不正确';

            // 验证哈希
            const dataHash = await sha256(JSON.stringify(config.data));
            if (dataHash !== config.hash) throw '配置文件哈希值不匹配';

            // 导入配置
            for (let item in config.data) {
                localStorage.setItem(item, config.data[item]);
            }

            showToast('配置文件导入成功，3 秒后自动刷新本页面。', 'success');
            setTimeout(() => {
                window.location.reload();
            }, 3000);
        } catch (error) {
            const message = typeof error === 'string' ? error : '导入配置失败';
            showToast(`从URL导入配置出错 (${message})`, 'error');
        } finally {
            hideLoading();
            document.body.removeChild(modal);
        }
    });

    // 点击模态框外部关闭
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
}

// 配置文件导入功能
async function importConfig() {
    showImportBox(async (file) => {
        try {
            // 检查文件类型
            if (!(file.type === 'application/json' || file.name.endsWith('.json'))) throw '文件类型不正确';

            // 检查文件大小
            if (file.size > 1024 * 1024 * 10) throw new Error('文件大小超过 10MB');

            // 读取文件内容
            const content = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject('文件读取失败');
                reader.readAsText(file);
            });

            // 解析并验证配置
            const config = JSON.parse(content);
            if (config.name !== '南方许TV-Settings') throw '配置文件格式不正确';

            // 验证哈希
            const dataHash = await sha256(JSON.stringify(config.data));
            if (dataHash !== config.hash) throw '配置文件哈希值不匹配';

            // 导入配置
            for (let item in config.data) {
                localStorage.setItem(item, config.data[item]);
            }

            showToast('配置文件导入成功，3 秒后自动刷新本页面。', 'success');
            setTimeout(() => {
                window.location.reload();
            }, 3000);
        } catch (error) {
            const message = typeof error === 'string' ? error : '配置文件格式错误';
            showToast(`配置文件读取出错 (${message})`, 'error');
        }
    });
}

// 配置文件导出功能
async function exportConfig() {
    // 存储配置数据
    const config = {};
    const items = {};

    const settingsToExport = [
        'selectedAPIs',
        'customAPIs',
        'yellowFilterEnabled',
        'adFilteringEnabled',
        'doubanEnabled',
        'hasInitializedDefaults'
    ];

    // 导出设置项
    settingsToExport.forEach(key => {
        const value = localStorage.getItem(key);
        if (value !== null) {
            items[key] = value;
        }
    });

    // 导出历史记录
    const viewingHistory = localStorage.getItem('viewingHistory');
    if (viewingHistory) {
        items['viewingHistory'] = viewingHistory;
    }

    const searchHistory = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (searchHistory) {
        items[SEARCH_HISTORY_KEY] = searchHistory;
    }

    const times = Date.now().toString();
    config['name'] = '南方许TV-Settings';  // 配置文件名，用于校验
    config['time'] = times;               // 配置文件生成时间
    config['cfgVer'] = '1.0.0';           // 配置文件版本
    config['data'] = items;               // 配置文件数据
    config['hash'] = await sha256(JSON.stringify(config['data']));  // 计算数据的哈希值，用于校验

    // 将配置数据保存为 JSON 文件
    saveStringAsFile(JSON.stringify(config), '南方许TV-Settings_' + times + '.json');
}

// 将字符串保存为文件
function saveStringAsFile(content, fileName) {
    // 创建Blob对象并指定类型
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    // 生成临时URL
    const url = window.URL.createObjectURL(blob);
    // 创建<a>标签并触发下载
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    // 清理临时对象
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

// 移除Node.js的require语句，因为这是在浏览器环境中运行的
