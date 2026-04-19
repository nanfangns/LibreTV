// 改进的API请求处理函数
const SPECIAL_SOURCE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const SPECIAL_SOURCE_HTML_HEADERS = {
    'User-Agent': SPECIAL_SOURCE_USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};
const SPECIAL_SOURCE_JSON_HEADERS = {
    'User-Agent': SPECIAL_SOURCE_USER_AGENT,
    'Accept': 'application/json,text/plain,*/*'
};

async function buildProxiedUrl(targetUrl) {
    return window.ProxyAuth?.addAuthToProxyUrl
        ? await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(targetUrl))
        : PROXY_URL + encodeURIComponent(targetUrl);
}

async function fetchProxiedResponse(targetUrl, options = {}) {
    const proxiedUrl = await buildProxiedUrl(targetUrl);
    return fetch(proxiedUrl, options);
}

async function fetchProxiedText(targetUrl, options = {}) {
    const response = await fetchProxiedResponse(targetUrl, options);
    if (!response.ok) {
        throw new Error(`请求失败: ${response.status}`);
    }
    return await response.text();
}

async function fetchProxiedJson(targetUrl, options = {}) {
    const response = await fetchProxiedResponse(targetUrl, options);
    if (!response.ok) {
        throw new Error(`请求失败: ${response.status}`);
    }
    return await response.json();
}

async function fetchProxiedArrayBuffer(targetUrl, options = {}) {
    const response = await fetchProxiedResponse(targetUrl, options);
    if (!response.ok) {
        throw new Error(`请求失败: ${response.status}`);
    }
    return await response.arrayBuffer();
}

function parseHtmlDocument(html) {
    return new DOMParser().parseFromString(html, 'text/html');
}

function getAbsoluteUrl(baseUrl, url) {
    if (!url) return '';
    try {
        return new URL(url, baseUrl).toString();
    } catch (error) {
        return url;
    }
}

function getTextContent(element) {
    return element ? element.textContent.replace(/\s+/g, ' ').trim() : '';
}

function get4kvmWasmCache() {
    if (!window.__FOURKVM_WASM_CACHE__) {
        window.__FOURKVM_WASM_CACHE__ = new Map();
    }
    return window.__FOURKVM_WASM_CACHE__;
}

async function get4kvmWasmModule(wasmConfig) {
    if (!wasmConfig?.jsUrl || !wasmConfig?.wasmUrl) {
        throw new Error('4KVM wasm 配置缺失');
    }

    const cacheKey = `${wasmConfig.jsUrl}|${wasmConfig.wasmUrl}`;
    const cache = get4kvmWasmCache();

    if (cache.has(cacheKey)) {
        return await cache.get(cacheKey);
    }

    const loadPromise = (async () => {
        const jsSource = await fetchProxiedText(wasmConfig.jsUrl, {
            headers: SPECIAL_SOURCE_HTML_HEADERS
        });
        const wasmBytes = await fetchProxiedArrayBuffer(wasmConfig.wasmUrl, {
            headers: SPECIAL_SOURCE_JSON_HEADERS
        });

        const blobUrl = URL.createObjectURL(new Blob([jsSource], { type: 'text/javascript' }));

        try {
            const wasmModule = await import(blobUrl);
            if (typeof wasmModule.initSync === 'function') {
                wasmModule.initSync({ module: wasmBytes });
            }
            return wasmModule;
        } finally {
            URL.revokeObjectURL(blobUrl);
        }
    })().catch(error => {
        cache.delete(cacheKey);
        throw error;
    });

    cache.set(cacheKey, loadPromise);
    return await loadPromise;
}

function prepare4kvmRuntimeMeta(metaConfig = {}) {
    const entries = {
        'nb-st': metaConfig.nbSt || '',
        'nb-plt': Date.now().toString()
    };
    const cleanupTasks = [];

    Object.entries(entries).forEach(([id, content]) => {
        if (!content) return;

        let element = document.getElementById(id);
        const created = !element;
        const previousContent = element ? element.getAttribute('content') : null;

        if (!element) {
            element = document.createElement('meta');
            element.id = id;
            document.head.appendChild(element);
        }

        element.setAttribute('content', content);

        cleanupTasks.push(() => {
            if (created) {
                element.remove();
                return;
            }

            if (previousContent === null) {
                element.removeAttribute('content');
            } else {
                element.setAttribute('content', previousContent);
            }
        });
    });

    return () => {
        cleanupTasks.reverse().forEach(task => task());
    };
}

function pick4kvmPlayableUrl(playData) {
    const qualityUrls = Array.isArray(playData?.quality_urls) ? playData.quality_urls : [];
    const currentQuality = qualityUrls[playData?.current_quality];

    if (currentQuality?.url && currentQuality.url !== '1' && currentQuality.locked !== true) {
        return currentQuality.url;
    }

    const candidates = qualityUrls
        .filter(item => item?.url && item.url !== '1' && item.locked !== true)
        .sort((a, b) => (Number(b?.bitrate) || 0) - (Number(a?.bitrate) || 0));

    return candidates[0]?.url || '';
}

async function mapWithConcurrency(items, limit, mapper) {
    const results = new Array(items.length);
    let currentIndex = 0;

    async function worker() {
        while (true) {
            const index = currentIndex++;
            if (index >= items.length) break;
            results[index] = await mapper(items[index], index);
        }
    }

    const workerCount = Math.min(limit, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}

function parse4kvmSearchResults(html, sourceCode) {
    const doc = parseHtmlDocument(html);
    const sourceName = API_SITES[sourceCode]?.name || '4KVM';
    const cards = Array.from(doc.querySelectorAll('a[href^="/play/"].block'));
    const seen = new Set();
    const results = [];

    cards.forEach(card => {
        const href = card.getAttribute('href') || '';
        const vodId = href.match(/^\/play\/([^/?#]+)/)?.[1] || '';
        const title = getTextContent(card.querySelector('h3')) || (card.querySelector('img')?.getAttribute('alt') || '').trim();

        if (!vodId || !title || seen.has(vodId)) {
            return;
        }

        seen.add(vodId);

        const image = card.querySelector('img');
        const cover = getAbsoluteUrl('https://www.4kvm.net', image?.getAttribute('data-src') || image?.getAttribute('src') || '');
        const desc = getTextContent(card.querySelector('p'));

        results.push({
            vod_id: vodId,
            vod_name: title,
            vod_pic: cover,
            vod_remarks: '',
            vod_content: desc,
            source_name: sourceName,
            source_code: sourceCode
        });
    });

    return results;
}

async function fetch4kvmSearchResults(searchQuery, sourceCode) {
    const searchUrl = `https://www.4kvm.net/search?q=${encodeURIComponent(searchQuery)}`;
    const html = await fetchProxiedText(searchUrl, {
        headers: SPECIAL_SOURCE_HTML_HEADERS
    });
    return parse4kvmSearchResults(html, sourceCode);
}

function parse4kvmDetailPage(html) {
    const doc = parseHtmlDocument(html);
    const pageBaseUrl = 'https://www.4kvm.net/';
    const title = getTextContent(doc.querySelector('h1')) ||
        (doc.querySelector('meta[property=\"og:title\"]')?.getAttribute('content') || '').split(' - 第')[0].trim();
    const cover = getAbsoluteUrl(pageBaseUrl, doc.querySelector('meta[property=\"og:image\"]')?.getAttribute('content') || '');
    const desc = (doc.querySelector('meta[name=\"description\"]')?.getAttribute('content') || '').trim();
    const playKey = html.match(/userlink:'([^']*)'/)?.[1] || '0';
    const nbSt = doc.querySelector('#nb-st')?.getAttribute('content') || '';

    const wasmConfigElement = doc.querySelector('#wasm-cfg');
    const wasmConfig = {
        jsUrl: getAbsoluteUrl(pageBaseUrl, wasmConfigElement?.getAttribute('data-js') || ''),
        wasmUrl: getAbsoluteUrl(pageBaseUrl, wasmConfigElement?.getAttribute('data-bg') || '')
    };

    const anchors = Array.from(doc.querySelectorAll('a[dataid][href^=\"/play/\"]'));
    const seen = new Set();
    const episodes = [];

    anchors.forEach((anchor, index) => {
        const href = anchor.getAttribute('href') || '';
        const secretKey = href.match(/^\/play\/([^/?#]+)/)?.[1] || '';
        const dataid = (anchor.getAttribute('dataid') || '').trim();
        const line = parseInt(anchor.getAttribute('data-line') || '1', 10);
        const episode = parseInt(anchor.getAttribute('data-episode') || `${index + 1}`, 10);
        const uniqueKey = `${line}_${episode}_${secretKey}_${dataid}`;

        if (!secretKey || !dataid || seen.has(uniqueKey)) {
            return;
        }

        seen.add(uniqueKey);
        episodes.push({
            line: Number.isFinite(line) && line > 0 ? line : 1,
            episode: Number.isFinite(episode) && episode > 0 ? episode : index + 1,
            dataid,
            secretKey
        });
    });

    if (episodes.length === 0) {
        throw new Error('未找到 4KVM 剧集信息');
    }

    const primaryLine = Math.min(...episodes.map(item => item.line));
    const primaryEpisodes = episodes
        .filter(item => item.line === primaryLine)
        .sort((a, b) => a.episode - b.episode);

    return {
        title,
        cover,
        desc,
        playKey,
        wasmConfig,
        meta: { nbSt },
        episodes: primaryEpisodes
    };
}

async function resolve4kvmEpisodeUrl(episode, detailPageData) {
    const wasmModule = await get4kvmWasmModule(detailPageData.wasmConfig);
    const restoreMeta = prepare4kvmRuntimeMeta(detailPageData.meta);
    let playApiPath = '';

    try {
        playApiPath = wasmModule.build_play_url(
            String(episode.dataid || ''),
            String(episode.secretKey || ''),
            '1080',
            String(detailPageData.playKey || '0')
        );
    } finally {
        restoreMeta();
    }

    const playApiUrl = getAbsoluteUrl('https://www.4kvm.net/', playApiPath);
    const playData = await fetchProxiedJson(playApiUrl, {
        headers: SPECIAL_SOURCE_JSON_HEADERS
    });

    const playableUrl = pick4kvmPlayableUrl(playData?.data);
    if (!playableUrl) {
        throw new Error('未返回可播放地址');
    }

    return playableUrl;
}

async function handle4kvmDetail(id, sourceCode) {
    const detailUrl = `https://www.4kvm.net/play/${encodeURIComponent(id)}`;
    const html = await fetchProxiedText(detailUrl, {
        headers: SPECIAL_SOURCE_HTML_HEADERS
    });
    const detailPageData = parse4kvmDetailPage(html);

    const episodeUrls = await mapWithConcurrency(detailPageData.episodes, 4, async (episode) => {
        try {
            return await resolve4kvmEpisodeUrl(episode, detailPageData);
        } catch (error) {
            console.warn(`4KVM 剧集解析失败: ${episode.secretKey}`, error);
            return '';
        }
    });

    const episodes = episodeUrls.filter(Boolean);
    if (episodes.length === 0) {
        throw new Error('4KVM 未解析到可播放地址');
    }

    return {
        code: 200,
        episodes,
        detailUrl,
        videoInfo: {
            title: detailPageData.title,
            cover: detailPageData.cover,
            desc: detailPageData.desc,
            source_name: API_SITES[sourceCode].name,
            source_code: sourceCode
        }
    };
}

async function handleApiRequest(url) {
    const customApi = url.searchParams.get('customApi') || '';
    const customDetail = url.searchParams.get('customDetail') || '';
    const source = url.searchParams.get('source') || 'heimuer';

    try {
        if (url.pathname === '/api/search') {
            const searchQuery = url.searchParams.get('wd');
            if (!searchQuery) {
                throw new Error('缺少搜索参数');
            }

            // 验证API和source的有效性
            if (source === 'custom' && !customApi) {
                throw new Error('使用自定义API时必须提供API地址');
            }

            if (!API_SITES[source] && source !== 'custom') {
                throw new Error('无效的API来源');
            }

            if (source !== 'custom' && API_SITES[source]?.parser === '4kvm') {
                const list = await fetch4kvmSearchResults(searchQuery, source);
                return JSON.stringify({
                    code: 200,
                    list
                });
            }

            const apiUrl = customApi
                ? `${customApi}${API_CONFIG.search.path}${encodeURIComponent(searchQuery)}`
                : `${API_SITES[source].api}${API_CONFIG.search.path}${encodeURIComponent(searchQuery)}`;

            // 添加超时处理
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            try {
                // 添加鉴权参数到代理URL
                const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl ?
                    await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(apiUrl)) :
                    PROXY_URL + encodeURIComponent(apiUrl);

                const response = await fetch(proxiedUrl, {
                    headers: API_CONFIG.search.headers,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`API请求失败: ${response.status}`);
                }

                const data = await response.json();

                // 检查JSON格式的有效性
                if (!data || !Array.isArray(data.list)) {
                    throw new Error('API返回的数据格式无效');
                }

                // 添加源信息到每个结果
                data.list.forEach(item => {
                    item.source_name = source === 'custom' ? '自定义源' : API_SITES[source].name;
                    item.source_code = source;
                    // 对于自定义源，添加API URL信息
                    if (source === 'custom') {
                        item.api_url = customApi;
                    }
                });

                return JSON.stringify({
                    code: 200,
                    list: data.list || [],
                });
            } catch (fetchError) {
                clearTimeout(timeoutId);
                throw fetchError;
            }
        }

        // 详情处理
        if (url.pathname === '/api/detail') {
            const id = url.searchParams.get('id');
            const sourceCode = url.searchParams.get('source') || 'heimuer'; // 获取源代码

            if (!id) {
                throw new Error('缺少视频ID参数');
            }

            // 验证ID格式 - 只允许数字和有限的特殊字符
            if (!/^[\w-]+$/.test(id)) {
                throw new Error('无效的视频ID格式');
            }

            // 验证API和source的有效性
            if (sourceCode === 'custom' && !customApi) {
                throw new Error('使用自定义API时必须提供API地址');
            }

            if (!API_SITES[sourceCode] && sourceCode !== 'custom') {
                throw new Error('无效的API来源');
            }

            // 对于有detail参数的源，都使用特殊处理方式
            if (sourceCode !== 'custom' && API_SITES[sourceCode]?.parser === '4kvm') {
                return JSON.stringify(await handle4kvmDetail(id, sourceCode));
            }

            if (sourceCode !== 'custom' && API_SITES[sourceCode].detail) {
                return await handleSpecialSourceDetail(id, sourceCode);
            }

            // 如果是自定义API，并且传递了detail参数，尝试特殊处理
            // 优先 customDetail
            if (sourceCode === 'custom' && customDetail) {
                return await handleCustomApiSpecialDetail(id, customDetail);
            }
            if (sourceCode === 'custom' && url.searchParams.get('useDetail') === 'true') {
                return await handleCustomApiSpecialDetail(id, customApi);
            }

            const detailUrl = customApi
                ? `${customApi}${API_CONFIG.detail.path}${id}`
                : `${API_SITES[sourceCode].api}${API_CONFIG.detail.path}${id}`;

            // 添加超时处理
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            try {
                // 添加鉴权参数到代理URL
                const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl ?
                    await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(detailUrl)) :
                    PROXY_URL + encodeURIComponent(detailUrl);

                const response = await fetch(proxiedUrl, {
                    headers: API_CONFIG.detail.headers,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`详情请求失败: ${response.status}`);
                }

                // 解析JSON
                const data = await response.json();

                // 检查返回的数据是否有效
                if (!data || !data.list || !Array.isArray(data.list) || data.list.length === 0) {
                    throw new Error('获取到的详情内容无效');
                }

                // 获取第一个匹配的视频详情
                const videoDetail = data.list[0];

                // 提取播放地址
                let episodes = [];

                if (videoDetail.vod_play_url) {
                    // 分割不同播放源
                    const playSources = videoDetail.vod_play_url.split('$$$');

                    // 提取第一个播放源的集数（通常为主要源）
                    if (playSources.length > 0) {
                        const mainSource = playSources[0];
                        const episodeList = mainSource.split('#');

                        // 从每个集数中提取URL
                        episodes = episodeList.map(ep => {
                            const parts = ep.split('$');
                            // 返回URL部分(通常是第二部分，如果有的话)
                            return parts.length > 1 ? parts[1] : '';
                        }).filter(url => url && (url.startsWith('http://') || url.startsWith('https://')));
                    }
                }

                // 如果没有找到播放地址，尝试使用正则表达式查找m3u8链接
                if (episodes.length === 0 && videoDetail.vod_content) {
                    const matches = videoDetail.vod_content.match(M3U8_PATTERN) || [];
                    episodes = matches.map(link => link.replace(/^\$/, ''));
                }

                return JSON.stringify({
                    code: 200,
                    episodes: episodes,
                    detailUrl: detailUrl,
                    videoInfo: {
                        title: videoDetail.vod_name,
                        cover: videoDetail.vod_pic,
                        desc: videoDetail.vod_content,
                        type: videoDetail.type_name,
                        year: videoDetail.vod_year,
                        area: videoDetail.vod_area,
                        director: videoDetail.vod_director,
                        actor: videoDetail.vod_actor,
                        remarks: videoDetail.vod_remarks,
                        // 添加源信息
                        source_name: sourceCode === 'custom' ? '自定义源' : API_SITES[sourceCode].name,
                        source_code: sourceCode
                    }
                });
            } catch (fetchError) {
                clearTimeout(timeoutId);
                throw fetchError;
            }
        }

        throw new Error('未知的API路径');
    } catch (error) {
        console.error('API处理错误:', error);
        return JSON.stringify({
            code: 400,
            msg: error.message || '请求处理失败',
            list: [],
            episodes: [],
        });
    }
}

// 处理自定义API的特殊详情页
async function handleCustomApiSpecialDetail(id, customApi) {
    try {
        // 构建详情页URL
        const detailUrl = `${customApi}/index.php/vod/detail/id/${id}.html`;

        // 添加超时处理
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        // 添加鉴权参数到代理URL
        const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl ?
            await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(detailUrl)) :
            PROXY_URL + encodeURIComponent(detailUrl);

        // 获取详情页HTML
        const response = await fetch(proxiedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`自定义API详情页请求失败: ${response.status}`);
        }

        // 获取HTML内容
        const html = await response.text();

        // 使用通用模式提取m3u8链接
        const generalPattern = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
        let matches = html.match(generalPattern) || [];

        // 处理链接
        matches = matches.map(link => {
            link = link.substring(1, link.length);
            const parenIndex = link.indexOf('(');
            return parenIndex > 0 ? link.substring(0, parenIndex) : link;
        });

        // 提取基本信息
        const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
        const titleText = titleMatch ? titleMatch[1].trim() : '';

        const descMatch = html.match(/<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)<\/div>/);
        const descText = descMatch ? descMatch[1].replace(/<[^>]+>/g, ' ').trim() : '';

        return JSON.stringify({
            code: 200,
            episodes: matches,
            detailUrl: detailUrl,
            videoInfo: {
                title: titleText,
                desc: descText,
                source_name: '自定义源',
                source_code: 'custom'
            }
        });
    } catch (error) {
        console.error(`自定义API详情获取失败:`, error);
        throw error;
    }
}

// 通用特殊源详情处理函数
async function handleSpecialSourceDetail(id, sourceCode) {
    try {
        // 构建详情页URL（使用配置中的detail URL而不是api URL）
        const detailUrl = `${API_SITES[sourceCode].detail}/index.php/vod/detail/id/${id}.html`;

        // 添加超时处理
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        // 添加鉴权参数到代理URL
        const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl ?
            await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(detailUrl)) :
            PROXY_URL + encodeURIComponent(detailUrl);

        // 获取详情页HTML
        const response = await fetch(proxiedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`详情页请求失败: ${response.status}`);
        }

        // 获取HTML内容
        const html = await response.text();

        // 根据不同源类型使用不同的正则表达式
        let matches = [];

        if (sourceCode === 'ffzy') {
            // 非凡影视使用特定的正则表达式
            const ffzyPattern = /\$(https?:\/\/[^"'\s]+?\/\d{8}\/\d+_[a-f0-9]+\/index\.m3u8)/g;
            matches = html.match(ffzyPattern) || [];
        }

        // 如果没有找到链接或者是其他源类型，尝试一个更通用的模式
        if (matches.length === 0) {
            const generalPattern = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
            matches = html.match(generalPattern) || [];
        }
        // 去重处理，避免一个播放源多集显示
        matches = [...new Set(matches)];
        // 处理链接
        matches = matches.map(link => {
            link = link.substring(1, link.length);
            const parenIndex = link.indexOf('(');
            return parenIndex > 0 ? link.substring(0, parenIndex) : link;
        });

        // 提取可能存在的标题、简介等基本信息
        const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
        const titleText = titleMatch ? titleMatch[1].trim() : '';

        const descMatch = html.match(/<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)<\/div>/);
        const descText = descMatch ? descMatch[1].replace(/<[^>]+>/g, ' ').trim() : '';

        return JSON.stringify({
            code: 200,
            episodes: matches,
            detailUrl: detailUrl,
            videoInfo: {
                title: titleText,
                desc: descText,
                source_name: API_SITES[sourceCode].name,
                source_code: sourceCode
            }
        });
    } catch (error) {
        console.error(`${API_SITES[sourceCode].name}详情获取失败:`, error);
        throw error;
    }
}

// 处理聚合搜索
async function handleAggregatedSearch(searchQuery) {
    // 获取可用的API源列表（排除aggregated和custom）
    const availableSources = Object.keys(API_SITES).filter(key =>
        key !== 'aggregated' && key !== 'custom'
    );

    if (availableSources.length === 0) {
        throw new Error('没有可用的API源');
    }

    // 创建所有API源的搜索请求
    const searchPromises = availableSources.map(async (source) => {
        try {
            if (API_SITES[source]?.parser === '4kvm') {
                return await fetch4kvmSearchResults(searchQuery, source);
            }

            const apiUrl = `${API_SITES[source].api}${API_CONFIG.search.path}${encodeURIComponent(searchQuery)}`;

            // 使用Promise.race添加超时处理
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`${source}源搜索超时`)), 8000)
            );

            // 添加鉴权参数到代理URL
            const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl ?
                await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(apiUrl)) :
                PROXY_URL + encodeURIComponent(apiUrl);

            const fetchPromise = fetch(proxiedUrl, {
                headers: API_CONFIG.search.headers
            });

            const response = await Promise.race([fetchPromise, timeoutPromise]);

            if (!response.ok) {
                throw new Error(`${source}源请求失败: ${response.status}`);
            }

            const data = await response.json();

            if (!data || !Array.isArray(data.list)) {
                throw new Error(`${source}源返回的数据格式无效`);
            }

            // 为搜索结果添加源信息
            const results = data.list.map(item => ({
                ...item,
                source_name: API_SITES[source].name,
                source_code: source
            }));

            return results;
        } catch (error) {
            console.warn(`${source}源搜索失败:`, error);
            return []; // 返回空数组表示该源搜索失败
        }
    });

    try {
        // 并行执行所有搜索请求
        const resultsArray = await Promise.all(searchPromises);

        // 合并所有结果
        let allResults = [];
        resultsArray.forEach(results => {
            if (Array.isArray(results) && results.length > 0) {
                allResults = allResults.concat(results);
            }
        });

        // 如果没有搜索结果，返回空结果
        if (allResults.length === 0) {
            return JSON.stringify({
                code: 200,
                list: [],
                msg: '所有源均无搜索结果'
            });
        }

        // 去重（根据vod_id和source_code组合）
        const uniqueResults = [];
        const seen = new Set();

        allResults.forEach(item => {
            const key = `${item.source_code}_${item.vod_id}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueResults.push(item);
            }
        });

        // 按照视频名称和来源排序
        uniqueResults.sort((a, b) => {
            // 首先按照视频名称排序
            const nameCompare = (a.vod_name || '').localeCompare(b.vod_name || '');
            if (nameCompare !== 0) return nameCompare;

            // 如果名称相同，则按照来源排序
            return (a.source_name || '').localeCompare(b.source_name || '');
        });

        return JSON.stringify({
            code: 200,
            list: uniqueResults,
        });
    } catch (error) {
        console.error('聚合搜索处理错误:', error);
        return JSON.stringify({
            code: 400,
            msg: '聚合搜索处理失败: ' + error.message,
            list: []
        });
    }
}

// 处理多个自定义API源的聚合搜索
async function handleMultipleCustomSearch(searchQuery, customApiUrls) {
    // 解析自定义API列表
    const apiUrls = customApiUrls.split(CUSTOM_API_CONFIG.separator)
        .map(url => url.trim())
        .filter(url => url.length > 0 && /^https?:\/\//.test(url))
        .slice(0, CUSTOM_API_CONFIG.maxSources);

    if (apiUrls.length === 0) {
        throw new Error('没有提供有效的自定义API地址');
    }

    // 为每个API创建搜索请求
    const searchPromises = apiUrls.map(async (apiUrl, index) => {
        try {
            const fullUrl = `${apiUrl}${API_CONFIG.search.path}${encodeURIComponent(searchQuery)}`;

            // 使用Promise.race添加超时处理
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`自定义API ${index + 1} 搜索超时`)), 8000)
            );

            // 添加鉴权参数到代理URL
            const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl ?
                await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(fullUrl)) :
                PROXY_URL + encodeURIComponent(fullUrl);

            const fetchPromise = fetch(proxiedUrl, {
                headers: API_CONFIG.search.headers
            });

            const response = await Promise.race([fetchPromise, timeoutPromise]);

            if (!response.ok) {
                throw new Error(`自定义API ${index + 1} 请求失败: ${response.status}`);
            }

            const data = await response.json();

            if (!data || !Array.isArray(data.list)) {
                throw new Error(`自定义API ${index + 1} 返回的数据格式无效`);
            }

            // 为搜索结果添加源信息
            const results = data.list.map(item => ({
                ...item,
                source_name: `${CUSTOM_API_CONFIG.namePrefix}${index + 1}`,
                source_code: 'custom',
                api_url: apiUrl // 保存API URL以便详情获取
            }));

            return results;
        } catch (error) {
            console.warn(`自定义API ${index + 1} 搜索失败:`, error);
            return []; // 返回空数组表示该源搜索失败
        }
    });

    try {
        // 并行执行所有搜索请求
        const resultsArray = await Promise.all(searchPromises);

        // 合并所有结果
        let allResults = [];
        resultsArray.forEach(results => {
            if (Array.isArray(results) && results.length > 0) {
                allResults = allResults.concat(results);
            }
        });

        // 如果没有搜索结果，返回空结果
        if (allResults.length === 0) {
            return JSON.stringify({
                code: 200,
                list: [],
                msg: '所有自定义API源均无搜索结果'
            });
        }

        // 去重（根据vod_id和api_url组合）
        const uniqueResults = [];
        const seen = new Set();

        allResults.forEach(item => {
            const key = `${item.api_url || ''}_${item.vod_id}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueResults.push(item);
            }
        });

        return JSON.stringify({
            code: 200,
            list: uniqueResults,
        });
    } catch (error) {
        console.error('自定义API聚合搜索处理错误:', error);
        return JSON.stringify({
            code: 400,
            msg: '自定义API聚合搜索处理失败: ' + error.message,
            list: []
        });
    }
}

// 拦截API请求
(function () {
    const originalFetch = window.fetch;

    window.fetch = async function (input, init) {
        const requestUrl = typeof input === 'string' ? new URL(input, window.location.origin) : input.url;

        if (
            requestUrl.pathname.startsWith('/api/') &&
            !requestUrl.pathname.startsWith('/api/auth') &&
            !requestUrl.pathname.startsWith('/api/user') &&
            !requestUrl.pathname.startsWith('/api/online')
        ) {
            try {
                const data = await handleApiRequest(requestUrl);
                return new Response(data, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                    },
                });
            } catch (error) {
                return new Response(JSON.stringify({
                    code: 500,
                    msg: '服务器内部错误',
                }), {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });
            }
        }

        // 非API请求使用原始fetch
        return originalFetch.apply(this, arguments);
    };
})();

async function testSiteAvailability(apiUrl) {
    try {
        // 使用更简单的测试查询
        const response = await fetch('/api/search?wd=test&customApi=' + encodeURIComponent(apiUrl), {
            // 添加超时
            signal: AbortSignal.timeout(5000)
        });

        // 检查响应状态
        if (!response.ok) {
            return false;
        }

        const data = await response.json();

        // 检查API响应的有效性
        return data && data.code !== 400 && Array.isArray(data.list);
    } catch (error) {
        console.error('站点可用性测试失败:', error);
        return false;
    }
}
