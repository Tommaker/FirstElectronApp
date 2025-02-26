const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

const container = document.querySelector('.container');
const statusText = document.querySelector('.status-text');

// 添加搜索相关的常量
const searchContainer = document.getElementById('searchContainer');
const searchInput = document.getElementById('searchInput');
const moduleCheckbox = document.getElementById('moduleCheckbox');
const contextCheckbox = document.getElementById('contextCheckbox');
const closeSearch = document.getElementById('closeSearch');
const searchResults = document.getElementById('searchResults');
const searchResultsContent = document.getElementById('searchResultsContent');
const searchStatus = document.getElementById('searchStatus');

// 添加页面相关常量
const tabs = document.querySelectorAll('.tab');
const pages = document.querySelectorAll('.page');
const tableContainers = {
    trace: {
        headerRow: document.querySelector('#trace-table thead tr'),
        content: document.querySelector('#trace-table tbody'),
        table: document.querySelector('#trace-table')
    },
    messages: {
        headerRow: document.querySelector('#messages-table thead tr'),
        content: document.querySelector('#messages-table tbody'),
        table: document.querySelector('#messages-table')
    },
    ota: {
        headerRow: document.querySelector('#ota-table thead tr'),
        content: document.querySelector('#ota-table tbody'),
        table: document.querySelector('#ota-table')
    },
    bookmarks: {
        headerRow: document.querySelector('#bookmarks-table thead tr'),
        content: document.querySelector('#bookmarks-table tbody'),
        table: document.querySelector('#bookmarks-table')
    }
};

// 添加表头配置
const TABLE_HEADERS = {
    trace: ['Index', 'LogID', 'Level', 'Module', 'SFN', 'Time', 'Context'],
    messages: ['Index', 'LogID', 'SrcMod', 'DstMod', 'SFN', 'Time', 'Message', 'Msg Content'],
    ota: ['Index', 'LogID', 'SrcMod', 'DstMod', 'SFN', 'Time', 'OTA Message', 'Msg Content'],
    bookmarks: ['Index', 'LogID', 'Level/SrcMod', 'Module', 'SFN', 'Time', 'Context'] // 修改表头配置中的 bookmarks 配置
};

// 修改书签状态管理对象
const bookmarkState = {
    currentLogFile: '',
    selectedRows: new Set(),
    bookmarks: new Map() // key: index, value: { sourcePageId, index }
};

// 添加选项卡切换逻辑
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const pageName = tab.dataset.page;
        tabs.forEach(t => t.classList.remove('active'));
        pages.forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`${pageName}-page`).classList.add('active');
        updateActivePageDisplay();
        
        // 自动调整列宽
        const activeTable = document.querySelector('.page.active table');
        if (activeTable) {
            const headers = activeTable.querySelectorAll('th');
            autoAdjustAllColumns(headers.length, activeTable);
        }

        // 在页面切换完成后执行同步
        if (syncState.lastClickedIndex !== -1 && 
            Date.now() - syncState.lastClickedTime < 30000) { // 30秒内有效
            setTimeout(() => {
                syncToNearestRow(syncState.lastClickedIndex);
            }, 100); // 等待页面渲染完成
        }
    });
});

// 防止默认拖放行为
document.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    container.classList.add('dragover');
});

document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!container.contains(e.relatedTarget)) {
        container.classList.remove('dragover');
    }
});

document.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    container.classList.remove('dragover');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
        // 直接使用文件的路径
        const filePath = files[0].path;
        console.log('拖入文件路径:', filePath);
        
        // 检查文件路径是否存在
        if (filePath) {
            handleFile(filePath);
        } else {
            // 尝试使用替代方法获取路径
            const fileReader = new FileReader();
            fileReader.onload = (event) => {
                handleFileContent(event.target.result);
            };
            fileReader.readAsText(files[0]);
        }
    }
});

// 处理通过菜单打开的文件
ipcRenderer.on('file-opened', (event, filePath) => {
    handleFile(filePath);
});

// 添加快捷键监听
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        showSearch();
    } else if (e.key === 'Escape') {
        hideSearch();
    }
});

function handleFile(filePath) {
    bookmarkState.currentLogFile = filePath;
    console.log('[DEBUG] 开始处理文件:', filePath);
    const startTime = performance.now();
    statusText.textContent = '正在加载文件...';
    const progressContainer = document.querySelector('.progress-container');
    const progressBar = document.querySelector('.progress-bar');
    
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    
    try {
        console.log('[DEBUG] 读取文件信息');
        const stats = fs.statSync(filePath);
        const totalSize = stats.size;
        console.log('[DEBUG] 文件大小:', totalSize);
        
        let content = '';
        const stream = fs.createReadStream(filePath, {
            encoding: 'utf-8',
            highWaterMark: 1024 * 1024
        });

        stream.on('data', chunk => {
            content += chunk;
            const progress = (content.length / totalSize) * 40;
            progressBar.style.width = `${progress}%`;
            console.log('[DEBUG] 读取进度:', progress.toFixed(2) + '%');
        });

        stream.on('end', () => {
            console.log('[DEBUG] 文件读取完成，开始处理内容');
            progressBar.style.width = '40%';
            const lines = content.split('\n').filter(line => line.trim().length > 0);
            console.log('[DEBUG] 总行数:', lines.length);
            processFileContent(lines, progressBar, progressContainer, startTime);
        });

        stream.on('error', error => {
            console.error('[ERROR] 文件读取错误:', error);
            statusText.textContent = `文件读取失败: ${error.message}`;
            progressContainer.style.display = 'none';
        });
    } catch (error) {
        console.error('[ERROR] 文件处理错误:', error);
        statusText.textContent = `文件加载失败: ${error.message}`;
        progressContainer.style.display = 'none';
    }

    // 尝试加载对应的书签文件
    const markFilePath = filePath.replace(/\.[^.]+$/, '.mark');
    try {
        if (fs.existsSync(markFilePath)) {
            const markContent = fs.readFileSync(markFilePath, 'utf-8');
            const bookmarks = JSON.parse(markContent);
            bookmarks.forEach(bookmark => {
                dataCache.bookmarks.push(bookmark);
                bookmarkState.bookmarks.set(bookmark.index, bookmark);
            });
            console.log('[DEBUG] Loaded bookmarks from:', markFilePath);
        }
    } catch (error) {
        console.warn('[WARN] Failed to load bookmark file:', error);
    }
}

function handleFileContent(content) {
    const startTime = performance.now();
    const progressContainer = document.querySelector('.progress-container');
    const progressBar = document.querySelector('.progress-bar');
    
    // 显示进度条
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    
    try {
        const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        processFileContent(lines, progressBar, progressContainer, startTime);
    } catch (error) {
        const endTime = performance.now();
        console.error('处理文件内容错误:', error);
        statusText.textContent = `文件处理失败: ${error.message} (用时: ${((endTime - startTime)/1000).toFixed(3)}s)`;
        progressContainer.style.display = 'none';
    }
}

// 添加数据缓存
const dataCache = {
    messages: [],
    ota: [],
    trace: [],
    bookmarks: []
};

function setupTableHeader(headerRow, headers) {
    // 添加调试信息
    if (!headerRow) {
        console.error('[ERROR] headerRow is null');
        console.log('[DEBUG] Available headerRows:', {
            messages: document.getElementById('messagesHeaderRow'),
            ota: document.getElementById('otaHeaderRow'),
            trace: document.getElementById('traceHeaderRow'),
            bookmarks: document.getElementById('bookmarksHeaderRow')
        });
        return;
    }

    console.log('[DEBUG] 设置表头:', headers, '到元素:', headerRow);
    headerRow.innerHTML = '';
    
    headers.forEach((header, index) => {
        const th = document.createElement('th');
        th.textContent = header;
        th.style.minWidth = '100px'; // 设置最小宽度
        const resizer = document.createElement('div');
        resizer.className = 'resizer';
        th.appendChild(resizer);
        headerRow.appendChild(th);

        // 添加列宽拖拽功能
        let startX, startWidth;
        resizer.addEventListener('mousedown', function(e) {
            startX = e.pageX;
            startWidth = th.offsetWidth;
            
            const onMouseMove = (e) => {
                const width = startWidth + (e.pageX - startX);
                if (width > 50) {
                    th.style.width = `${width}px`;
                    const table = headerRow.closest('table');
                    if (table) {
                        const cells = table.querySelectorAll(`td:nth-child(${index + 1})`);
                        cells.forEach(cell => cell.style.width = `${width}px`);
                    }
                }
            };
            
            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                resizer.classList.remove('resizing');
            };
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            resizer.classList.add('resizing');
        });
    });
}

function processFileContent(lines, progressBar, progressContainer, startTime) {
    // 保存状态
    state.processStartTime = startTime;
    state.currentProgressBar = progressBar;
    state.currentProgressContainer = progressContainer;
    
    console.log('[DEBUG] 开始处理文件内容, startTime:', startTime);
    
    if (lines.length === 0) {
        console.log('[DEBUG] 文件内容为空');
        statusText.textContent = '文件内容为空';
        progressContainer.style.display = 'none';
        return;
    }

    // 重置页面状态
    Object.keys(dataCache).forEach(key => {
        dataCache[key] = [];
        const headerRow = tableContainers[key].headerRow;
        const content = tableContainers[key].content;
        if (headerRow) headerRow.innerHTML = '';
        if (content) content.innerHTML = '';
    });

    try {
        const workerCode = `
            self.onmessage = function(e) {
                const {line, type, index} = e.data;
                const parts = [];
                let currentPart = '';
                let spaceCount = 0;
                
                for (let i = 0; i < line.length; i++) {
                    if (line[i] === ' ') {
                        spaceCount++;
                        if (spaceCount >= 3) {
                            if (currentPart.trim()) {
                                parts.push(currentPart.trim());
                            }
                            currentPart = '';
                            spaceCount = 0;
                        } else {
                            currentPart += line[i];
                        }
                    } else {
                        currentPart += line[i];
                        spaceCount = 0;
                    }
                }
                
                if (currentPart.trim()) {
                    parts.push(currentPart.trim());
                }
                
                const logId = type === 'data' ? (parseInt(parts[1]) || 0) : 0;
                
                self.postMessage({
                    parts: parts.map(p => p.trim()),
                    type,
                    index,
                    logId
                });
            };
            console.log('[WORKER DEBUG] Worker 已启动');
        `;

        console.log('[DEBUG] 创建 Worker');
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));

        let processedCount = 0;
        const totalLines = lines.length - 1;
        console.log('[DEBUG] 需要处理的总行数:', totalLines);

        worker.onmessage = function(e) {
            const { parts, type, logId } = e.data;
            
            if (type === 'header') {
                console.log('[DEBUG] 处理表头');
                
                // 使用文件提供的表头作为备用
                const fileHeaders = parts;
                
                // 为每个页面设置预定义的表头
                Object.entries(tableContainers).forEach(([key, container]) => {
                    if (!container.headerRow) {
                        console.error(`[ERROR] 找不到表头元素: ${key}-table thead tr`);
                        return;
                    }
                    
                    try {
                        // 优先使用预定义表头，如果没有则使用文件提供的表头
                        const headers = TABLE_HEADERS[key] || fileHeaders;
                        setupTableHeader(container.headerRow, headers);
                        console.log(`[DEBUG] 成功设置 ${key} 表头`);
                    } catch (error) {
                        console.error(`[ERROR] 设置 ${key} 表头时出错:`, error);
                    }
                });
                
                // 开始处理数据行
                sendLinesToWorker(lines.slice(1), worker);
            } else {
                processedCount++;
                // 根据LogId分类数据
                if (logId === 1) {
                    dataCache.messages.push({ parts, index: processedCount });
                } else if ([2, 3, 4].includes(logId)) {
                    dataCache.ota.push({ parts, index: processedCount });
                } else {
                    dataCache.trace.push({ parts, index: processedCount });
                }
                
                if (processedCount % 1000 === 0) {
                    console.log('[DEBUG] 已处理行数:', processedCount);
                    const progress = 40 + ((processedCount / totalLines) * 60);
                    progressBar.style.width = `${progress}%`;
                    updateActivePageDisplay();
                }
                
                if (processedCount >= totalLines) {
                    finishProcessing();
                }
            }
        };

        worker.onerror = function(e) {
            console.error('[ERROR] Worker错误:', e);
            statusText.textContent = '处理失败: Worker错误';
            progressContainer.style.display = 'none';
        };

        console.log('[DEBUG] 发送表头到Worker');
        worker.postMessage({ line: lines[0], type: 'header', index: 0 });

    } catch (error) {
        console.error('[ERROR] 处理内容错误:', error);
        statusText.textContent = '处理失败: ' + error.message;
        progressContainer.style.display = 'none';
    }
}

// 添加分批发送数据的函数
function sendLinesToWorker(lines, worker) {
    const batchSize = 1000;
    let currentIndex = 0;
    
    function sendBatch() {
        const endIndex = Math.min(currentIndex + batchSize, lines.length);
        console.log(`[DEBUG] 发送数据批次 ${currentIndex} - ${endIndex}`);
        
        for (let i = currentIndex; i < endIndex; i++) {
            worker.postMessage({ line: lines[i], type: 'data', index: i });
        }
        
        currentIndex = endIndex;
        if (currentIndex < lines.length) {
            setTimeout(sendBatch, 0);
        }
    }
    
    sendBatch();
}

// 更新当前激活页面的显示
function updateActivePageDisplay() {
    const activePage = document.querySelector('.page.active');
    if (!activePage) {
        console.warn('[WARN] No active page found');
        return;
    }

    const pageId = activePage.id.replace('-page', '');
    const container = tableContainers[pageId];
    
    if (!container || !dataCache[pageId]) {
        console.warn(`[WARN] No container or data for page ${pageId}`);
        return;
    }
    
    const tableContainer = activePage.querySelector('.table-container');
    if (!tableContainer) {
        console.warn('[WARN] No table container found');
        return;
    }

    console.log(`[DEBUG] Updating display for ${pageId}`);
    renderVisibleRows(pageId, tableContainer.scrollTop);
}

// 渲染可见行
function renderVisibleRows(pageId, scrollTop, highlightIndex = -1, shouldScroll = true) {
    const container = tableContainers[pageId];
    const data = dataCache[pageId];
    
    if (!container || !data || data.length === 0) {
        console.log(`[DEBUG] Skip rendering for ${pageId}, no data available`);
        return;
    }

    console.log(`[DEBUG] Rendering ${pageId} rows, scroll position: ${scrollTop}`);
    
    const tableContainer = container.content.closest('.table-container');
    const rowHeight = 35;
    const visibleHeight = tableContainer.clientHeight;
    const bufferSize = Math.ceil(visibleHeight / rowHeight) * 2;
    
    const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - bufferSize);
    const endIndex = Math.min(data.length, Math.ceil((scrollTop + visibleHeight) / rowHeight) + bufferSize);
    
    console.log(`[DEBUG] Rendering rows from ${startIndex} to ${endIndex} for ${pageId}`);
    
    container.content.innerHTML = '';
    
    if (startIndex > 0) {
        const spacer = document.createElement('tr');
        spacer.style.height = `${startIndex * rowHeight}px`;
        container.content.appendChild(spacer);
    }
    
    for (let i = startIndex; i < endIndex; i++) {
        if (data[i]) {
            const row = createTableRow(data[i].parts, i);
            if (syncState.targetHighlight && 
                parseInt(data[i].parts[0]) === syncState.targetHighlight.index &&
                pageId === syncState.targetHighlight.pageId) {
                row.classList.add('search-highlight-fixed');
                setupHighlightObserver(row);
                syncState.currentHighlightedRow = row;
            }
            container.content.appendChild(row);
        }
    }
    
    if (endIndex < data.length) {
        const spacer = document.createElement('tr');
        spacer.style.height = `${(data.length - endIndex) * rowHeight}px`;
        container.content.appendChild(spacer);
    }
}

function setupTable(headers) {
    headerRow.innerHTML = '';
    logContent.innerHTML = '';
    
    headers.forEach((header, index) => {
        const th = document.createElement('th');
        th.textContent = header;
        const resizer = document.createElement('div');
        resizer.className = 'resizer';
        th.appendChild(resizer);
        headerRow.appendChild(th);

        // 添加双击自适应列宽功能
        resizer.addEventListener('dblclick', function(e) {
            e.stopPropagation();
            autoResizeColumn(index);
        });

        // 添加列宽拖拽功能
        let startX, startWidth;
        
        resizer.addEventListener('mousedown', function(e) {
            startX = e.pageX;
            startWidth = th.offsetWidth;
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            
            // 添加正在调整的视觉提示
            resizer.classList.add('resizing');
        });

        function onMouseMove(e) {
            const width = startWidth + (e.pageX - startX);
            if (width > 50) { // 最小宽度限制
                th.style.width = `${width}px`;
                // 更新对应的所有单元格宽度
                const cells = logContent.querySelectorAll(`td:nth-child(${index + 1})`);
                cells.forEach(cell => cell.style.width = `${width}px`);
            }
        }

        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            resizer.classList.remove('resizing');
        }
    });
}

// 添加自动调整列宽的函数
function autoResizeColumn(columnIndex) {
    const th = headerRow.children[columnIndex];
    const cells = logContent.querySelectorAll(`td:nth-child(${columnIndex + 1})`);
    const testDiv = document.createElement('div');
    testDiv.style.position = 'absolute';
    testDiv.style.visibility = 'hidden';
    testDiv.style.whiteSpace = 'nowrap';
    document.body.appendChild(testDiv);

    // 获取表头文本宽度
    testDiv.textContent = th.textContent;
    let maxWidth = testDiv.offsetWidth;

    // 获取所有单元格内容的最大宽度
    cells.forEach(cell => {
        testDiv.textContent = cell.textContent;
        maxWidth = Math.max(maxWidth, testDiv.offsetWidth);
    });

    // 添加padding和边框的宽度
    maxWidth += 32; // 16px padding on each side + borders

    // 设置最小宽度
    maxWidth = Math.max(maxWidth, 50);

    // 应用新宽度
    th.style.width = `${maxWidth}px`;
    cells.forEach(cell => {
        cell.style.width = `${maxWidth}px`;
    });

    document.body.removeChild(testDiv);
}

function initializeVirtualScroll(dataLines, headers, worker, progressBar, progressContainer, startTime, categorizedData) {
    const tableContainer = document.querySelector('.table-container');
    const rowHeight = 35; // 预估的行高
    const visibleRows = Math.ceil(tableContainer.clientHeight / rowHeight);
    const bufferSize = visibleRows * 3; // 上下各多缓存一屏
    
    let processedData = new Array(dataLines.length);
    let currentStartIndex = 0;
    let isProcessing = false;
    let pendingLines = [...dataLines]; // 保存待处理的行
    
    // 更新进度条到50%
    progressBar.style.width = '50%';
    
    // 批量处理数据的函数
    function processBatchData() {
        const batchSize = 100; // 每批处理的行数
        const currentBatch = pendingLines.splice(0, batchSize);
        
        currentBatch.forEach(line => {
            worker.postMessage({ line, type: 'data' });
        });
        
        // 如果还有待处理的行，继续处理
        if (pendingLines.length > 0) {
            setTimeout(processBatchData, 0);
        }
    }
    
    function processChunk(startIndex) {
        if (isProcessing) return;
        isProcessing = true;
        
        const endIndex = Math.min(startIndex + bufferSize, dataLines.length);
        const visibleStartIndex = Math.max(0, startIndex - visibleRows);
        const visibleEndIndex = Math.min(dataLines.length, startIndex + visibleRows * 2);
        
        // 保存当前的搜索高亮状态
        const highlightedRows = Array.from(logContent.querySelectorAll('.search-highlight')).map(row => 
            row.rowIndex - 1  // 减1是因为表头占用了第一行
        );
        
        logContent.innerHTML = '';
        
        if (visibleStartIndex > 0) {
            const spacer = document.createElement('tr');
            spacer.style.height = `${visibleStartIndex * rowHeight}px`;
            logContent.appendChild(spacer);
        }
        
        // 处理可见区域的数据
        for (let i = visibleStartIndex; i < visibleEndIndex; i++) {
            if (processedData[i]) {
                const row = createTableRow(processedData[i], i);
                // 恢复搜索高亮状态
                if (highlightedRows.includes(i)) {
                    row.classList.add('search-highlight');
                }
                logContent.appendChild(row);
            }
        }
        
        if (visibleEndIndex < dataLines.length) {
            const spacer = document.createElement('tr');
            spacer.style.height = `${(data.length - visibleEndIndex) * rowHeight}px`;
            logContent.appendChild(spacer);
        }
        
        isProcessing = false;
    }
    
    // 处理数据行
    worker.onmessage = function(e) {
        const { parts, type } = e.data;
        if (type === 'data') {
            processedData[currentStartIndex] = parts;
            currentStartIndex++;
            
            // 更新进度
            const progress = 50 + ((currentStartIndex / dataLines.length) * 50);
            progressBar.style.width = `${progress}%`;
            
            // 更新显示
            if (currentStartIndex % 100 === 0) {
                processChunk(Math.floor(tableContainer.scrollTop / rowHeight));
            }
            
            // 检查是否处理完所有数据
            if (currentStartIndex >= dataLines.length) {
                const endTime = performance.now();
                const duration = ((endTime - startTime) / 1000).toFixed(3);
                progressContainer.style.display = 'none';
                statusText.textContent = `已加载 ${currentStartIndex} 条记录（${headers.length} 列），用时：${duration}s`;
                processChunk(Math.floor(tableContainer.scrollTop / rowHeight));
                worker.terminate();
                
                // 在加载完成后自动调整列宽
                autoAdjustAllColumns(headers.length);
            }
        }
    };
    
    // 监听滚动事件
    let scrollTimeout;
    tableContainer.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            const scrollTop = tableContainer.scrollTop;
            const startIndex = Math.floor(scrollTop / rowHeight);
            processChunk(startIndex);
        }, 100);
    });
    
    // 开始处理数据
    processBatchData();
    processChunk(0);
}

// 添加自动调整所有列宽的函数
function autoAdjustAllColumns(totalColumns, table) {
    if (!table) {
        console.warn('[WARN] No table provided to autoAdjustAllColumns');
        return;
    }

    const tableContainer = table.closest('.table-container');
    if (!tableContainer) {
        console.warn('[WARN] No table container found');
        return;
    }

    const headers = table.querySelectorAll('th');
    if (headers.length === 0) {
        console.warn('[WARN] No headers found in table');
        return;
    }

    const tbody = table.querySelector('tbody');
    if (!tbody) {
        console.warn('[WARN] No tbody found in table');
        return;
    }

    const testDiv = document.createElement('div');
    testDiv.style.position = 'absolute';
    testDiv.style.visibility = 'hidden';
    testDiv.style.whiteSpace = 'nowrap';
    document.body.appendChild(testDiv);

    let totalWidth = 0;
    const containerWidth = tableContainer.clientWidth;

    // 处理除最后一列外的所有列
    for (let i = 0; i < totalColumns - 1; i++) {
        const th = headers[i];
        const cells = tbody.querySelectorAll(`td:nth-child(${i + 1})`);
        
        // 获取表头文本宽度
        testDiv.textContent = th.textContent;
        let maxWidth = testDiv.offsetWidth;

        // 获取所有单元格内容的最大宽度
        cells.forEach(cell => {
            testDiv.textContent = cell.textContent;
            maxWidth = Math.max(maxWidth, testDiv.offsetWidth);
        });

        // 添加padding和边框的宽度
        maxWidth += 32; // 16px padding on each side + borders
        
        // 设置最小宽度
        maxWidth = Math.max(maxWidth, 50);
        
        // 应用新宽度
        th.style.width = `${maxWidth}px`;
        cells.forEach(cell => {
            cell.style.width = `${maxWidth}px`;
        });
        
        totalWidth += maxWidth;
    }

    // 处理最后一列
    const remainingWidth = Math.max(containerWidth - totalWidth - 20, 100); // 20px for scrollbar, minimum 100px
    const lastColumnIndex = totalColumns - 1;
    const lastTh = headers[lastColumnIndex];
    const lastCells = tbody.querySelectorAll(`td:nth-child(${lastColumnIndex + 1})`);
    
    lastTh.style.width = `${remainingWidth}px`;
    lastCells.forEach(cell => {
        cell.style.width = `${remainingWidth}px`;
    });

    document.body.removeChild(testDiv);
}

// 修改 createTableRow 函数中的双击处理
function createTableRow(columns, index) {
    const row = document.createElement('tr');
    row.dataset.index = columns[0]; // 使用实际的日志 Index
    
    // 添加双击处理
    row.addEventListener('dblclick', function(e) {
        e.preventDefault();
        const activePage = document.querySelector('.page.active');
        const pageId = activePage.id.replace('-page', '');
        
        // 使用真实的 log index
        syncState.lastClickedIndex = parseInt(columns[0]);
        syncState.lastClickedTime = Date.now();
        syncState.sourcePageId = pageId;
        
        console.log(`[DEBUG] Double clicked row with index ${syncState.lastClickedIndex} in ${pageId}`);
        
        // 只设置高亮状态，不滚动
        highlightSyncedRow(row, false);
    });
    
    // 修改行点击事件
    row.addEventListener('click', function(e) {
        const activePage = document.querySelector('.page.active');
        const pageId = activePage.id.replace('-page', '');
        
        if (!e.ctrlKey) {
            // 单击时清除其他选中
            activePage.querySelectorAll('tr').forEach(tr => {
                tr.classList.remove('selected-row');
            });
            bookmarkState.selectedRows.clear();
        }
        
        row.classList.toggle('selected-row');
        if (row.classList.contains('selected-row')) {
            bookmarkState.selectedRows.add({
                pageId,
                index,
                data: columns
            });
        } else {
            bookmarkState.selectedRows.delete({
                pageId,
                index
            });
        }
    });
    
    columns.forEach(column => {
        const td = document.createElement('td');
        td.textContent = column;
        row.appendChild(td);
    });
    
    return row;
}

// 搜索框控制函数
function showSearch() {
    searchContainer.style.display = 'block';
    searchResults.style.display = 'block';
    document.querySelector('.table-container').classList.add('with-search-results');
    searchInput.focus();
}

function hideSearch() {
    searchContainer.style.display = 'none';
    searchResults.style.display = 'none';
    document.querySelector('.table-container').classList.remove('with-search-results');
    clearHighlights();
    // 恢复滚动位置
    document.querySelector('.table-container').scrollTop = lastScrollPosition;
}

closeSearch.addEventListener('click', hideSearch);

// 添加清除高亮的函数 - 需要移到 performSearch 函数之前定义
function clearHighlights() {
    // 清除搜索高亮
    const highlightedRows = document.querySelectorAll('.search-highlight, .search-highlight-fixed');
    highlightedRows.forEach(row => {
        row.classList.remove('search-highlight');
        row.classList.remove('search-highlight-fixed');
    });
    
    // 清空搜索结果
    if (searchResultsContent) {
        searchResultsContent.innerHTML = '';
    }
    
    // 重置搜索状态
    if (searchStatus) {
        searchStatus.textContent = '';
    }
    
    // 清除任何现有观察器
    if (syncState.currentObserver) {
        syncState.currentObserver.disconnect();
        syncState.currentObserver = null;
    }
}

// 搜索处理函数
let searchTimeout;
searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(performSearch, 300);
});

moduleCheckbox.addEventListener('change', performSearch);
contextCheckbox.addEventListener('change', performSearch);

function performSearch() {
    const searchTerm = searchInput.value.toLowerCase();
    const searchModule = moduleCheckbox.checked;
    const searchContext = contextCheckbox.checked;
    
    if (!searchTerm) {
        clearHighlights();
        return;
    }
    
    const matches = [];
    clearHighlights();
    
    // 获取当前活动页面的表格
    const activePage = document.querySelector('.page.active');
    const tableContent = activePage.querySelector('tbody');
    const rows = tableContent.querySelectorAll('tr:not([style*="height"])');
    
    rows.forEach(row => {
        let found = false;
        const cells = row.querySelectorAll('td');
        
        if (cells.length > 0) {
            if (searchModule && cells[3]) { // Module列
                if (cells[3].textContent.toLowerCase().includes(searchTerm)) {
                    found = true;
                }
            }
            if (searchContext && cells[6]) { // Context列
                if (cells[6].textContent.toLowerCase().includes(searchTerm)) {
                    found = true;
                }
            }
            
            if (found) {
                row.classList.add('search-highlight');
                // 创建一个新行用于搜索结果显示
                const resultRow = createSearchResultRow(cells, activePage.id.replace('-page', ''), row.dataset.index);
                matches.push(resultRow);
            }
        }
    });
    
    // 更新搜索结果
    searchResultsContent.innerHTML = '';
    matches.forEach(row => {
        searchResultsContent.appendChild(row);
    });
    
    searchStatus.textContent = `找到 ${matches.length} 个匹配项`;
}

// 修改创建搜索结果行的函数
function createSearchResultRow(cells, pageId, index) {
    const row = document.createElement('tr');
    row.setAttribute('data-page', pageId);
    row.setAttribute('data-index', index);
    
    cells.forEach(cell => {
        const td = document.createElement('td');
        td.textContent = cell.textContent;
        row.appendChild(td);
    });
    
    // 修改双击事件处理
    row.addEventListener('dblclick', async function(e) {
        e.preventDefault();
        const index = this.getAttribute('data-index');
        const pageId = this.getAttribute('data-page');
        
        // 移除其他行的固定高亮
        clearHighlightedRows();
        
        // 切换到对应页面
        const tab = document.querySelector(`.tab[data-page="${pageId}"]`);
        if (tab) {
            // 保存高亮信息
            syncState.targetHighlight = {
                index: parseInt(index),
                pageId: pageId
            };
            
            // 切换页面
            tab.click();
            
            // 等待页面切换完成
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // 查找目标行并高亮
            highlightTargetRow(pageId, index);
        }
    });
    
    return row;
}

// 添加清除高亮的辅助函数
function clearHighlightedRows() {
    // 清除所有固定高亮
    document.querySelectorAll('.search-highlight-fixed').forEach(el => {
        el.classList.remove('search-highlight-fixed');
    });
    
    // 清除任何存在的观察器
    if (syncState.currentObserver) {
        syncState.currentObserver.disconnect();
        syncState.currentObserver = null;
    }
}

// 添加高亮目标行的函数
function highlightTargetRow(pageId, index) {
    const data = dataCache[pageId];
    if (!data) return;
    
    // 查找真实的数组索引
    const arrayIndex = data.findIndex(item => 
        parseInt(item.parts[0]) === parseInt(index)
    );
    
    if (arrayIndex !== -1) {
        // 计算滚动位置
        const rowHeight = 35;
        const tableContainer = tableContainers[pageId].content.closest('.table-container');
        const viewportHeight = tableContainer.clientHeight;
        const scrollPosition = (arrayIndex * rowHeight) - (viewportHeight / 2) + (rowHeight / 2);
        
        // 设置滚动位置
        tableContainer.scrollTop = scrollPosition;
        
        // 渲染并高亮目标行
        setTimeout(() => {
            // 找到目标行
            const targetRow = findRowByIndex(index);
            if (targetRow) {
                // 添加高亮类
                targetRow.classList.add('search-highlight-fixed');
                
                // 确保目标行可见
                targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                
                // 设置持续观察
                setupHighlightObserver(targetRow);
                
                // 保存当前高亮行的引用
                syncState.currentHighlightedRow = targetRow;
            }
        }, 50);
    }
}

// 添加高亮观察器设置函数
function setupHighlightObserver(targetRow) {
    // 清除现有观察器
    if (syncState.currentObserver) {
        syncState.currentObserver.disconnect();
    }
    
    // 创建新的观察器
    const observer = new MutationObserver((mutations, obs) => {
        mutations.forEach(mutation => {
            if (mutation.type === 'attributes' && 
                mutation.attributeName === 'class' &&
                !targetRow.classList.contains('search-highlight-fixed')) {
                targetRow.classList.add('search-highlight-fixed');
            }
        });
    });
    
    // 开始观察
    observer.observe(targetRow, {
        attributes: true,
        attributeFilter: ['class']
    });
    
    // 保存观察器引用
    syncState.currentObserver = observer;
}

// 修改搜索相关函数的初始化
document.addEventListener('DOMContentLoaded', () => {
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(performSearch, 300);
        });
    }

    if (moduleCheckbox) {
        moduleCheckbox.addEventListener('change', performSearch);
    }

    if (contextCheckbox) {
        contextCheckbox.addEventListener('change', performSearch);
    }
});

// 添加滚动位置记忆功能
let lastScrollPosition = 0;

document.querySelector('.table-container').addEventListener('scroll', (e) => {
    lastScrollPosition = e.target.scrollTop;
});

// 添加完成处理的函数
function finishProcessing() {
    console.log('[DEBUG] 所有数据处理完成');
    const endTime = performance.now();
    const duration = ((endTime - state.processStartTime) / 1000).toFixed(3);
    
    if (state.currentProgressContainer) {
        state.currentProgressContainer.style.display = 'none';
    }
    
    statusText.textContent = `已加载数据：Messages ${dataCache.messages.length}, OTA ${dataCache.ota.length}, Trace ${dataCache.trace.length} 条记录，用时：${duration}s`;
    
    // 加载书签
    loadBookmarks();
    
    // 更新当前页面显示
    updateActivePageDisplay();
    
    // 自动调整列宽
    const activePage = document.querySelector('.page.active');
    if (!activePage) {
        console.warn('[WARN] No active page found');
        return;
    }

    const activeTable = activePage.querySelector('table');
    if (!activeTable) {
        console.warn('[WARN] No active table found');
        return;
    }

    const headers = activeTable.querySelectorAll('th');
    if (headers.length > 0) {
        autoAdjustAllColumns(headers.length, activeTable);
    } else {
        console.warn('[WARN] No headers found in active table');
    }
}

// 添加调试函数
function validateTableStructure() {
    Object.entries(tableContainers).forEach(([key, container]) => {
        console.log(`[DEBUG] Checking ${key} table structure:`, {
            headerRow: container.headerRow,
            content: container.content,
            headerExists: !!container.headerRow,
            contentExists: !!container.content
        });
    });
}

// 在DOMContentLoaded时检查表格结构
document.addEventListener('DOMContentLoaded', () => {
    console.log('[DEBUG] DOM loaded, validating table structure...');
    validateTableStructure();
    // ...rest of existing DOMContentLoaded handlers...
});

// 添加全局状态管理
const state = {
    processStartTime: 0,
    currentProgressBar: null,
    currentProgressContainer: null
};

// 修改页面和滚动相关的函数
function initializeScrollHandlers() {
    // 为每个表格容器添加滚动监听器
    Object.keys(tableContainers).forEach(pageId => {
        const pageElement = document.getElementById(`${pageId}-page`);
        const tableContainer = pageElement?.querySelector('.table-container');
        
        if (tableContainer) {
            console.log(`[DEBUG] Adding scroll handler for ${pageId}`);
            tableContainer.addEventListener('scroll', function(e) {
                // 只有当页面是激活状态时才处理滚动
                if (pageElement.classList.contains('active')) {
                    const scrollTop = e.target.scrollTop;
                    console.log(`[DEBUG] Scroll event on ${pageId}, position:`, scrollTop);
                    renderVisibleRows(pageId, scrollTop);
                }
            });
        } else {
            console.warn(`[WARN] Table container not found for ${pageId}`);
        }
    });
}

// 修改 updateActivePageDisplay 函数
function updateActivePageDisplay() {
    const activePage = document.querySelector('.page.active');
    if (!activePage) {
        console.warn('[WARN] No active page found');
        return;
    }

    const pageId = activePage.id.replace('-page', '');
    const container = tableContainers[pageId];
    
    if (!container || !dataCache[pageId]) {
        console.warn(`[WARN] No container or data for page ${pageId}`);
        return;
    }
    
    const tableContainer = activePage.querySelector('.table-container');
    if (!tableContainer) {
        console.warn('[WARN] No table container found');
        return;
    }

    console.log(`[DEBUG] Updating display for ${pageId}`);
    renderVisibleRows(pageId, tableContainer.scrollTop);
}

// 修改渲染可见行函数
function renderVisibleRows(pageId, scrollTop, highlightIndex = -1, shouldScroll = true) {
    const container = tableContainers[pageId];
    const data = dataCache[pageId];
    
    if (!container || !data || data.length === 0) {
        console.log(`[DEBUG] Skip rendering for ${pageId}, no data available`);
        return;
    }

    console.log(`[DEBUG] Rendering ${pageId} rows, scroll position: ${scrollTop}`);
    
    const tableContainer = container.content.closest('.table-container');
    const rowHeight = 35;
    const visibleHeight = tableContainer.clientHeight;
    const bufferSize = Math.ceil(visibleHeight / rowHeight) * 2;
    
    const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - bufferSize);
    const endIndex = Math.min(data.length, Math.ceil((scrollTop + visibleHeight) / rowHeight) + bufferSize);
    
    console.log(`[DEBUG] Rendering rows from ${startIndex} to ${endIndex} for ${pageId}`);
    
    container.content.innerHTML = '';
    
    if (startIndex > 0) {
        const spacer = document.createElement('tr');
        spacer.style.height = `${startIndex * rowHeight}px`;
        container.content.appendChild(spacer);
    }
    
    for (let i = startIndex; i < endIndex; i++) {
        if (data[i]) {
            const row = createTableRow(data[i].parts, i);
            if (i === highlightIndex) {
                highlightSyncedRow(row, shouldScroll);
            }
            container.content.appendChild(row);
        }
    }
    
    if (endIndex < data.length) {
        const spacer = document.createElement('tr');
        spacer.style.height = `${(data.length - endIndex) * rowHeight}px`;
        container.content.appendChild(spacer);
    }
}

// 在 DOMContentLoaded 时初始化滚动处理
document.addEventListener('DOMContentLoaded', () => {
    console.log('[DEBUG] Initializing scroll handlers');
    validateTableStructure();
    initializeScrollHandlers();
    // 初始化完成后更新当前页面显示
    updateActivePageDisplay();
});

// 添加书签快捷键处理函数
function handleBookmarkHotkey(e) {
    if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        const activePage = document.querySelector('.page.active');
        const pageId = activePage.id.replace('-page', '');
        
        if (pageId === 'bookmarks') {
            // 从书签中移除选中的行
            removeSelectedBookmarks();
        } else {
            // 添加选中的行到书签
            addSelectedToBookmarks();
        }
    }
}

// 添加书签处理函数
function addSelectedToBookmarks() {
    if (bookmarkState.selectedRows.size === 0) return;
    
    let added = false;
    bookmarkState.selectedRows.forEach(row => {
        if (!bookmarkState.bookmarks.has(row.index)) {
            const sourceData = dataCache[row.pageId];
            if (sourceData && sourceData[row.index]) {
                dataCache.bookmarks.push({
                    parts: sourceData[row.index].parts,
                    index: row.index,
                    sourcePageId: row.pageId
                });
                bookmarkState.bookmarks.set(row.index, {
                    sourcePageId: row.pageId,
                    index: row.index
                });
                added = true;
            }
        }
    });
    
    if (added) {
        saveBookmarks();
        updateActivePageDisplay();
    }
    
    bookmarkState.selectedRows.clear();
}

// 移除书签处理函数
function removeSelectedBookmarks() {
    if (bookmarkState.selectedRows.size === 0) return;
    
    let removed = false;
    bookmarkState.selectedRows.forEach(row => {
        const index = dataCache.bookmarks.findIndex(b => b.index === row.index);
        if (index !== -1) {
            dataCache.bookmarks.splice(index, 1);
            bookmarkState.bookmarks.delete(row.index);
            removed = true;
        }
    });
    
    if (removed) {
        saveBookmarks();
        updateActivePageDisplay();
    }
    
    bookmarkState.selectedRows.clear();
}

// 保存书签到文件
function saveBookmarks() {
    if (!bookmarkState.currentLogFile) {
        console.warn('[WARN] No log file loaded, cannot save bookmarks');
        return;
    }
    
    const markFilePath = bookmarkState.currentLogFile.replace(/\.[^.]+$/, '.mark');
    try {
        // 只保存索引信息
        const bookmarkData = Array.from(bookmarkState.bookmarks.values()).map(bookmark => ({
            sourcePageId: bookmark.sourcePageId,
            index: bookmark.index
        }));
        
        fs.writeFileSync(markFilePath, JSON.stringify(bookmarkData, null, 2), 'utf-8');
        console.log('[DEBUG] Saved bookmarks to:', markFilePath);
    } catch (error) {
        console.error('[ERROR] Failed to save bookmarks:', error);
    }
}

// 修改加载书签函数
function loadBookmarks() {
    if (!bookmarkState.currentLogFile) {
        console.warn('[WARN] No log file loaded, cannot load bookmarks');
        return;
    }

    const markFilePath = bookmarkState.currentLogFile.replace(/\.[^.]+$/, '.mark');
    try {
        if (fs.existsSync(markFilePath)) {
            console.log('[DEBUG] Loading bookmarks from:', markFilePath);
            const markContent = fs.readFileSync(markFilePath, 'utf-8');
            const bookmarkIndexes = JSON.parse(markContent);
            
            // 清除现有书签
            bookmarkState.bookmarks.clear();
            dataCache.bookmarks = [];
            
            // 根据索引从各个页面加载数据
            bookmarkIndexes.forEach(bookmark => {
                const sourceData = dataCache[bookmark.sourcePageId];
                if (sourceData && sourceData[bookmark.index]) {
                    const logData = sourceData[bookmark.index];
                    dataCache.bookmarks.push({
                        parts: logData.parts,
                        index: bookmark.index,
                        sourcePageId: bookmark.sourcePageId
                    });
                    bookmarkState.bookmarks.set(bookmark.index, {
                        sourcePageId: bookmark.sourcePageId,
                        index: bookmark.index
                    });
                }
            });
            
            console.log(`[DEBUG] Loaded ${dataCache.bookmarks.length} bookmarks`);
            
            // 更新书签页面显示
            if (document.querySelector('.page.active').id === 'bookmarks-page') {
                updateActivePageDisplay();
            }
        }
    } catch (error) {
        console.warn('[WARN] Failed to load bookmark file:', error);
    }
}

// 添加键盘事件监听
document.addEventListener('keydown', handleBookmarkHotkey);

// 添加位置同步状态管理
const syncState = {
    lastClickedIndex: -1,
    lastClickedTime: 0,
    sourcePageId: null,
    currentHighlightedRow: null,
    currentObserver: null,
    targetHighlight: null  // 保存目标高亮信息
};

// 修改同步到最近行的函数
function syncToNearestRow(targetIndex) {
    const activePage = document.querySelector('.page.active');
    const pageId = activePage.id.replace('-page', '');
    const data = dataCache[pageId];
    
    if (!data || data.length === 0) {
        console.log(`[DEBUG] No data available for page ${pageId}`);
        return;
    }
    
    console.log(`[DEBUG] Finding nearest row to index ${targetIndex} in ${pageId}`);
    
    // 查找最接近目标索引的行
    let nearestItem = null;
    let minDiff = Number.MAX_VALUE;
    
    data.forEach((item, arrayIndex) => {
        // 确保 item.parts 存在且有第一个元素
        if (!item || !item.parts || !item.parts[0]) {
            return;
        }

        const itemIndex = parseInt(item.parts[0]);
        if (isNaN(itemIndex)) {
            return;
        }

        const diff = Math.abs(itemIndex - targetIndex);
        if (nearestItem === null || 
            diff < minDiff || 
            (diff === minDiff && itemIndex < parseInt(nearestItem.data.parts[0]))) {
            minDiff = diff;
            nearestItem = {
                data: item,
                arrayIndex: arrayIndex,
                realIndex: itemIndex
            };
        }
    });
    
    if (nearestItem) {
        console.log(`[DEBUG] Found nearest row: array index ${nearestItem.arrayIndex}, real index ${nearestItem.realIndex}`);
        // 切换页面时一定要滚动到中间并高亮
        scrollToAndHighlight(nearestItem.arrayIndex, pageId, true);
    }
}

// 修改滚动和高亮函数
function scrollToAndHighlight(arrayIndex, pageId, shouldScroll = true) {
    const container = tableContainers[pageId];
    const tableContainer = container.content.closest('.table-container');
    const rowHeight = 35;
    
    if (shouldScroll) {
        // 计算滚动位置使目标行出现在视图中间
        const viewportHeight = tableContainer.clientHeight;
        const scrollPosition = (arrayIndex * rowHeight) - (viewportHeight / 2) + (rowHeight / 2);
        tableContainer.scrollTop = scrollPosition;
    }
    
    // 等待渲染完成后高亮行
    setTimeout(() => {
        renderVisibleRows(pageId, tableContainer.scrollTop, arrayIndex, shouldScroll);
    }, 5000);
}

// 修改高亮同步行的函数，添加是否需要滚动的参数
function highlightSyncedRow(row, shouldScroll = true) {
    // 移除所有现有高亮
    document.querySelectorAll('.synced-row').forEach(r => {
        r.classList.remove('synced-row');
    });
    
    // 添加新的高亮
    row.classList.add('synced-row');
    
    // 根据参数决定是否滚动
    if (shouldScroll) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
    console.log(`[DEBUG] Highlighted row with index ${row.dataset.index}, scroll: ${shouldScroll}`);
    
    // 10秒后自动清除高亮
    setTimeout(() => {
        row.classList.remove('synced-row');
    }, 10000);
}

// 修改 DOMContentLoaded 事件处理函数
document.addEventListener('DOMContentLoaded', () => {
    console.log('[DEBUG] DOM loaded, validating table structure...');
    validateTableStructure();
    initializeScrollHandlers();
    
    // 初始化所有表格的表头
    Object.entries(tableContainers).forEach(([key, container]) => {
        if (container.headerRow && TABLE_HEADERS[key]) {
            setupTableHeader(container.headerRow, TABLE_HEADERS[key]);
            console.log(`[DEBUG] Initialized headers for ${key} table`);
        }
    });

    // 更新当前页面显示
    updateActivePageDisplay();
});

// 添加搜索结果区域拖动和大小调整功能
document.addEventListener('DOMContentLoaded', () => {
    const searchResults = document.getElementById('searchResults');
    const searchResultsHeader = searchResults.querySelector('.search-results-header');
    const closeSearchResults = document.getElementById('closeSearchResults');
    
    let isDragging = false;
    let currentY;
    let initialY;
    let yOffset = 0;

    // 拖动搜索结果窗口
    searchResultsHeader.addEventListener('mousedown', (e) => {
        isDragging = true;
        currentY = e.clientY - yOffset;
        initialY = e.clientY;
        
        searchResultsHeader.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            e.preventDefault();
            const currentY = e.clientY - initialY;
            searchResults.style.transform = `translateY(${currentY}px)`;
        }
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
        searchResultsHeader.style.cursor = 'grab';
        // 保存新位置
        yOffset = currentY;
    });

    // 关闭搜索结果
    closeSearchResults.addEventListener('click', () => {
        hideSearchResults();
    });

    // 修改原有的搜索相关处理...
});

// 修改搜索结果显示/隐藏函数
function showSearchResults() {
    const searchResults = document.getElementById('searchResults');
    searchResults.style.display = 'block';
}

function hideSearchResults() {
    const searchResults = document.getElementById('searchResults');
    searchResults.style.display = 'none';
    // 清除所有固定高亮
    document.querySelectorAll('.search-highlight-fixed').forEach(el => {
        el.classList.remove('search-highlight-fixed');
    });
}

// 修改搜索结果处理函数
function performSearch() {
    const searchTerm = searchInput.value.toLowerCase();
    const searchModule = moduleCheckbox.checked;
    const searchContext = contextCheckbox.checked;
    
    if (!searchTerm) {
        clearHighlights();
        return;
    }
    
    const matches = [];
    clearHighlights();
    
    // 获取当前活动页面的表格
    const activePage = document.querySelector('.page.active');
    const tableContent = activePage.querySelector('tbody');
    const rows = tableContent.querySelectorAll('tr:not([style*="height"])');
    
    rows.forEach(row => {
        let found = false;
        const cells = row.querySelectorAll('td');
        
        if (cells.length > 0) {
            if (searchModule && cells[3]) { // Module列
                if (cells[3].textContent.toLowerCase().includes(searchTerm)) {
                    found = true;
                }
            }
            if (searchContext && cells[6]) { // Context列
                if (cells[6].textContent.toLowerCase().includes(searchTerm)) {
                    found = true;
                }
            }
            
            if (found) {
                row.classList.add('search-highlight');
                // 创建一个新行用于搜索结果显示
                const resultRow = createSearchResultRow(cells, activePage.id.replace('-page', ''), row.dataset.index);
                matches.push(resultRow);
            }
        }
    });
    
    // 更新搜索结果
    searchResultsContent.innerHTML = '';
    matches.forEach(row => {
        row.addEventListener('dblclick', async function(e) {
            e.preventDefault();
            const index = this.getAttribute('data-index');
            const pageId = this.getAttribute('data-page');
            
            // 移除其他行的固定高亮
            document.querySelectorAll('.search-highlight-fixed').forEach(el => {
                el.classList.remove('search-highlight-fixed');
            });
            
            // 切换到对应页面
            const tab = document.querySelector(`.tab[data-page="${pageId}"]`);
            if (tab) {
                tab.click();
                
                // 等待页面切换完成并渲染
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // 查找并高亮目标行
                const targetRow = findRowByIndex(index);
                if (targetRow) {
                    targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    targetRow.classList.add('search-highlight-fixed');
                    
                    // 确保高亮状态保持
                    const observer = new MutationObserver((mutations, obs) => {
                        if (!targetRow.classList.contains('search-highlight-fixed')) {
                            targetRow.classList.add('search-highlight-fixed');
                        }
                    });
                    
                    observer.observe(targetRow, {
                        attributes: true,
                        attributeFilter: ['class']
                    });
                    
                    // 30秒后停止观察
                    setTimeout(() => observer.disconnect(), 30000);
                }
            }
        });
        searchResultsContent.appendChild(row);
    });
    
    showSearchResults();
    searchStatus.textContent = `找到 ${matches.length} 个匹配项`;
}

// 添加通过索引查找行的辅助函数
function findRowByIndex(index) {
    const activePage = document.querySelector('.page.active');
    const rows = activePage.querySelectorAll('tr[data-index]');
    return Array.from(rows).find(row => row.getAttribute('data-index') === index);
}

// 修改搜索结果窗口的拖拽和缩放功能
document.addEventListener('DOMContentLoaded', () => {
    const searchResults = document.getElementById('searchResults');
    const searchResultsHeader = searchResults.querySelector('.search-results-header');
    const resizeHandles = searchResults.querySelectorAll('.resize-handle');
    
    // 窗口拖动
    let isDragging = false;
    let currentX = 0;
    let currentY = 0;
    let initialX = 0;
    let initialY = 0;

    searchResultsHeader.addEventListener('mousedown', initDrag);
    
    function initDrag(e) {
        if (e.target.closest('.close-button')) return;
        
        isDragging = true;
        const rect = searchResults.getBoundingClientRect();
        initialX = e.clientX - rect.left;
        initialY = e.clientY - rect.top;
        
        searchResultsHeader.style.cursor = 'grabbing';
    }
    
    // 窗口缩放
    let isResizing = false;
    let currentHandle = null;
    
    resizeHandles.forEach(handle => {
        handle.addEventListener('mousedown', initResize);
    });
    
    function initResize(e) {
        isResizing = true;
        currentHandle = e.target;
        e.stopPropagation();
    }
    
    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            e.preventDefault();
            const x = e.clientX - initialX;
            const y = e.clientY - initialY;
            
            // 确保窗口不会被拖出视口
            const maxX = window.innerWidth - searchResults.offsetWidth;
            const maxY = window.innerHeight - searchResults.offsetHeight;
            
            searchResults.style.left = `${Math.min(Math.max(0, x), maxX)}px`;
            searchResults.style.top = `${Math.min(Math.max(0, y), maxY)}px`;
        }
        
        if (isResizing && currentHandle) {
            e.preventDefault();
            const rect = searchResults.getBoundingClientRect();
            
            if (currentHandle.classList.contains('bottom-right')) {
                const width = e.clientX - rect.left;
                const height = e.clientY - rect.top;
                if (width >= 400) searchResults.style.width = `${width}px`;
                if (height >= 200) searchResults.style.height = `${height}px`;
            }
            // 添加其他角的缩放处理...
        }
    });
    
    document.addEventListener('mouseup', () => {
        isDragging = false;
        isResizing = false;
        currentHandle = null;
        searchResultsHeader.style.cursor = 'grab';
    });
});

// 修改搜索结果行的创建和高亮处理
function createSearchResultRow(cells, pageId, index) {
    const row = document.createElement('tr');
    row.setAttribute('data-page', pageId);
    row.setAttribute('data-index', index);
    
    cells.forEach(cell => {
        const td = document.createElement('td');
        td.textContent = cell.textContent;
        row.appendChild(td);
    });
    
    // 添加双击事件处理
    row.addEventListener('dblclick', async function(e) {
        e.preventDefault();
        const index = this.getAttribute('data-index');
        const pageId = this.getAttribute('data-page');
        
        // 移除其他行的固定高亮
        document.querySelectorAll('.search-highlight-fixed').forEach(el => {
            el.classList.remove('search-highlight-fixed');
        });
        
        // 切换到对应页面
        const tab = document.querySelector(`.tab[data-page="${pageId}"]`);
        if (tab) {
            // 切换页面前记录目标行信息
            const targetIndex = parseInt(index);
            
            // 切换页面
            tab.click();
            
            // 等待页面切换和渲染完成
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // 直接找到目标索引所在的数据
            const data = dataCache[pageId];
            if (data) {
                // 查找真实的数组索引
                const arrayIndex = data.findIndex(item => 
                    parseInt(item.parts[0]) === targetIndex
                );
                
                if (arrayIndex !== -1) {
                    // 计算滚动位置
                    const rowHeight = 35;
                    const tableContainer = tableContainers[pageId].content.closest('.table-container');
                    const viewportHeight = tableContainer.clientHeight;
                    const scrollPosition = (arrayIndex * rowHeight) - (viewportHeight / 2) + (rowHeight / 2);
                    
                    // 设置滚动位置
                    tableContainer.scrollTop = scrollPosition;
                    
                    // 强制立即渲染目标行及其周围的行
                    renderVisibleRows(pageId, scrollPosition);
                    
                    // 找到新渲染的目标行
                    const targetRow = findRowByIndex(index);
                    if (targetRow) {
                        // 添加高亮
                        targetRow.classList.add('search-highlight-fixed');
                        
                        // 确保高亮状态持续存在
                        const observer = new MutationObserver(() => {
                            if (!targetRow.classList.contains('search-highlight-fixed')) {
                                targetRow.classList.add('search-highlight-fixed');
                            }
                        });
                        
                        observer.observe(targetRow, {
                            attributes: true,
                            attributeFilter: ['class']
                        });
                        
                        // 存储当前状态
                        syncState.currentHighlightedRow = targetRow;
                        syncState.currentObserver = observer;
                        
                        // 30秒后自动清理
                        setTimeout(() => {
                            observer.disconnect();
                            if (syncState.currentHighlightedRow === targetRow) {
                                syncState.currentHighlightedRow = null;
                                syncState.currentObserver = null;
                            }
                        }, 30000);
                    }
                }
            }
        }
    });
    
    return row;
}

// 添加字体设置处理
ipcRenderer.on('font-settings-changed', (event, settings) => {
    // 应用字体设置到所有表格
    const tables = document.querySelectorAll('.font-adjustable');
    console.log('[DEBUG] Applying font settings to', tables.length, 'tables:', settings);
    
    tables.forEach(table => {
        table.style.fontFamily = settings.fontFamily;
        table.style.fontSize = `${settings.fontSize}px`;
    });
    
    // 保存设置到本地存储
    localStorage.setItem('fontSettings', JSON.stringify(settings));
});

// 修改 DOMContentLoaded 事件处理，添加字体设置加载
document.addEventListener('DOMContentLoaded', () => {
    // ...existing DOMContentLoaded code...
    
    // 加载保存的字体设置
    const savedSettings = localStorage.getItem('fontSettings');
    if (savedSettings) {
        try {
            const settings = JSON.parse(savedSettings);
            console.log('[DEBUG] Loading saved font settings:', settings);
            
            const tables = document.querySelectorAll('.font-adjustable');
            tables.forEach(table => {
                table.style.fontFamily = settings.fontFamily;
                table.style.fontSize = `${settings.fontSize}px`;
            });
        } catch (error) {
            console.error('[ERROR] Failed to load font settings:', error);
        }
    }
    
    // ...rest of existing DOMContentLoaded code...
});

// 添加通过索引查找行的辅助函数
function findRowByIndex(index) {
    const activePage = document.querySelector('.page.active');
    const rows = activePage.querySelectorAll('tr[data-index]');
    return Array.from(rows).find(row => row.getAttribute('data-index') === index);
}

// 修改搜索结果窗口的拖拽和缩放功能
document.addEventListener('DOMContentLoaded', () => {
    const searchResults = document.getElementById('searchResults');
    const searchResultsHeader = searchResults.querySelector('.search-results-header');
    const resizeHandles = searchResults.querySelectorAll('.resize-handle');
    
    // 窗口拖动
    let isDragging = false;
    let currentX = 0;
    let currentY = 0;
    let initialX = 0;
    let initialY = 0;

    searchResultsHeader.addEventListener('mousedown', initDrag);
    
    function initDrag(e) {
        if (e.target.closest('.close-button')) return;
        
        isDragging = true;
        const rect = searchResults.getBoundingClientRect();
        initialX = e.clientX - rect.left;
        initialY = e.clientY - rect.top;
        
        searchResultsHeader.style.cursor = 'grabbing';
    }
    
    // 窗口缩放
    let isResizing = false;
    let currentHandle = null;
    
    resizeHandles.forEach(handle => {
        handle.addEventListener('mousedown', initResize);
    });
    
    function initResize(e) {
        isResizing = true;
        currentHandle = e.target;
        e.stopPropagation();
    }
    
    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            e.preventDefault();
            const x = e.clientX - initialX;
            const y = e.clientY - initialY;
            
            // 确保窗口不会被拖出视口
            const maxX = window.innerWidth - searchResults.offsetWidth;
            const maxY = window.innerHeight - searchResults.offsetHeight;
            
            searchResults.style.left = `${Math.min(Math.max(0, x), maxX)}px`;
            searchResults.style.top = `${Math.min(Math.max(0, y), maxY)}px`;
        }
        
        if (isResizing && currentHandle) {
            e.preventDefault();
            const rect = searchResults.getBoundingClientRect();
            
            if (currentHandle.classList.contains('bottom-right')) {
                const width = e.clientX - rect.left;
                const height = e.clientY - rect.top;
                if (width >= 400) searchResults.style.width = `${width}px`;
                if (height >= 200) searchResults.style.height = `${height}px`;
            }
            // 添加其他角的缩放处理...
        }
    });
    
    document.addEventListener('mouseup', () => {
        isDragging = false;
        isResizing = false;
        currentHandle = null;
        searchResultsHeader.style.cursor = 'grab';
    });
});

// 修改搜索结果行的创建和高亮处理
function createSearchResultRow(cells, pageId, index) {
    const row = document.createElement('tr');
    row.setAttribute('data-page', pageId);
    row.setAttribute('data-index', index);
    
    cells.forEach(cell => {
        const td = document.createElement('td');
        td.textContent = cell.textContent;
        row.appendChild(td);
    });
    
    // 添加双击事件处理
    row.addEventListener('dblclick', async function(e) {
        e.preventDefault();
        const index = this.getAttribute('data-index');
        const pageId = this.getAttribute('data-page');
        
        // 移除其他行的固定高亮
        document.querySelectorAll('.search-highlight-fixed').forEach(el => {
            el.classList.remove('search-highlight-fixed');
        });
        
        // 切换到对应页面
        const tab = document.querySelector(`.tab[data-page="${pageId}"]`);
        if (tab) {
            // 切换页面前记录目标行信息
            const targetIndex = parseInt(index);
            
            // 切换页面
            tab.click();
            
            // 等待页面切换和渲染完成
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // 直接找到目标索引所在的数据
            const data = dataCache[pageId];
            if (data) {
                // 查找真实的数组索引
                const arrayIndex = data.findIndex(item => 
                    parseInt(item.parts[0]) === targetIndex
                );
                
                if (arrayIndex !== -1) {
                    // 计算滚动位置
                    const rowHeight = 35;
                    const tableContainer = tableContainers[pageId].content.closest('.table-container');
                    const viewportHeight = tableContainer.clientHeight;
                    const scrollPosition = (arrayIndex * rowHeight) - (viewportHeight / 2) + (rowHeight / 2);
                    
                    // 设置滚动位置
                    tableContainer.scrollTop = scrollPosition;
                    
                    // 强制立即渲染目标行及其周围的行
                    renderVisibleRows(pageId, scrollPosition);
                    
                    // 找到新渲染的目标行
                    const targetRow = findRowByIndex(index);
                    if (targetRow) {
                        // 添加高亮
                        targetRow.classList.add('search-highlight-fixed');
                        
                        // 确保高亮状态持续存在
                        const observer = new MutationObserver(() => {
                            if (!targetRow.classList.contains('search-highlight-fixed')) {
                                targetRow.classList.add('search-highlight-fixed');
                            }
                        });
                        
                        observer.observe(targetRow, {
                            attributes: true,
                            attributeFilter: ['class']
                        });
                        
                        // 存储当前状态
                        syncState.currentHighlightedRow = targetRow;
                        syncState.currentObserver = observer;
                        
                        // 30秒后自动清理
                        setTimeout(() => {
                            observer.disconnect();
                            if (syncState.currentHighlightedRow === targetRow) {
                                syncState.currentHighlightedRow = null;
                                syncState.currentObserver = null;
                            }
                        }, 30000);
                    }
                }
            }
        }
    });
    
    return row;
}