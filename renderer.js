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
                console.log('[DEBUG] 处理表头:', parts);
                const headers = parts; // 使用所有列，而不是只取前7个
                
                // 确保所有表头元素都存在
                Object.entries(tableContainers).forEach(([key, container]) => {
                    if (!container.headerRow) {
                        console.error(`[ERROR] 找不到表头元素: ${key}-table thead tr`);
                        return;
                    }
                    
                    try {
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
function renderVisibleRows(pageId, scrollTop) {
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
            const row = createTableRow(data[i].parts);
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
                const row = createTableRow(processedData[i], headers);
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

function createTableRow(columns) {
    const row = document.createElement('tr');
    
    // 添加行点击事件
    row.addEventListener('click', function() {
        // 获取当前活动页面的表格内容区域
        const activePage = document.querySelector('.page.active');
        const tableContent = activePage.querySelector('tbody');
        tableContent.querySelectorAll('tr').forEach(tr => {
            tr.classList.remove('selected-row');
        });
        row.classList.add('selected-row');
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
            if (searchModule && cells[4]) { // Module列
                if (cells[4].textContent.toLowerCase().includes(searchTerm)) {
                    found = true;
                }
            }
            if (searchContext && cells[7]) { // Context列
                if (cells[7].textContent.toLowerCase().includes(searchTerm)) {
                    found = true;
                }
            }
            
            if (found) {
                row.classList.add('search-highlight');
                // 创建一个新行用于搜索结果显示
                const resultRow = document.createElement('tr');
                cells.forEach(cell => {
                    const td = document.createElement('td');
                    td.textContent = cell.textContent;
                    resultRow.appendChild(td);
                });
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

function clearHighlights() {
    const highlightedRows = document.querySelectorAll('.search-highlight');
    highlightedRows.forEach(row => row.classList.remove('search-highlight'));
    searchResultsContent.innerHTML = '';
    searchStatus.textContent = '';
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
    
    // 更新当前页面显示
    const activePage = document.querySelector('.page.active');
    if (!activePage) {
        console.warn('[WARN] No active page found');
        return;
    }

    updateActivePageDisplay();
    
    // 自动调整列宽
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
function renderVisibleRows(pageId, scrollTop) {
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
            const row = createTableRow(data[i].parts);
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
