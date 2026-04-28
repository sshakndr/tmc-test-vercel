let left = {
    name: 'all_items',
    filter: '',
    cursor: 0,
    nextCursor: 0,
    items: [],
    total: 0, 
    loading: false,
    hasMore: true
};

let right = {
    name: 'selected',
    filter: '',
    cursor: 0,
    nextCursor: 0,
    items: [],
    total: 0, 
    loading: false,
    hasMore: true
};

const leftContainer = document.getElementById('leftListContainer');
const rightContainer = document.getElementById('rightListContainer');
const leftSearch = document.getElementById('leftSearch');
const rightSearch = document.getElementById('rightSearch');
const addBtn = document.getElementById('addIdBtn');
const newIdInput = document.getElementById('newIdInput');

function createOpId() {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function createBatchClient({ endpoint, flushIntervalMs }) {
    let pendingOps = [];
    let flushTimer = null;
    let inFlight = false;

    const byOpId = new Map();
    const byDedupeKey = new Map();

    function scheduleFlush() {
        if (flushTimer) return;
        flushTimer = setTimeout(() => {
            flushTimer = null;
            flush();
        }, flushIntervalMs);
    }

    async function flush() {
        if (inFlight) {
            scheduleFlush();
            return;
        }
        if (pendingOps.length === 0) return;

        inFlight = true;
        const opsToSend = pendingOps;
        pendingOps = [];

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ops: opsToSend }),
            });
            const body = await res.json();
            const results = Array.isArray(body?.results) ? body.results : [];

            for (const r of results) {
                const record = byOpId.get(r.opId);
                if (!record) continue;

                byOpId.delete(r.opId);
                if (record.dedupeKey) byDedupeKey.delete(record.dedupeKey);

                if (!r.ok) {
                    record.reject(new Error(r.error || 'Batch op failed'));
                } else {
                    record.resolve(r.data);
                }
            }

            for (const op of opsToSend) {
                if (!byOpId.has(op.opId)) continue;
                const record = byOpId.get(op.opId);
                byOpId.delete(op.opId);
                if (record?.dedupeKey) byDedupeKey.delete(record.dedupeKey);
                record?.reject(new Error('Missing result for op'));
            }
        } catch (e) {
            for (const op of opsToSend) {
                const record = byOpId.get(op.opId);
                if (!record) continue;
                byOpId.delete(op.opId);
                if (record.dedupeKey) byDedupeKey.delete(record.dedupeKey);
                record.reject(e);
            }
        } finally {
            inFlight = false;
            if (pendingOps.length > 0) scheduleFlush();
        }
    }

    function request(type, payload, { dedupeKey } = {}) {
        if (typeof dedupeKey === 'string' && dedupeKey) {
            const existing = byDedupeKey.get(dedupeKey);
            if (existing) return existing.promise;
        }

        const opId = createOpId();
        const op = { opId, type, payload, dedupeKey };

        let resolve;
        let reject;
        const promise = new Promise((res, rej) => {
            resolve = res;
            reject = rej;
        });

        byOpId.set(opId, { resolve, reject, promise, dedupeKey });
        if (typeof dedupeKey === 'string' && dedupeKey) {
            byDedupeKey.set(dedupeKey, { promise, opId });
        }

        pendingOps.push(op);
        scheduleFlush();
        return promise;
    }

    return { request, flush };
}

const apiBatch = createBatchClient({ endpoint: '/api/batch', flushIntervalMs: 1000 });
const apiAddBatch = createBatchClient({ endpoint: '/api/batch', flushIntervalMs: 10000 });

const pendingRightRemovals = new Set();

function mergeUnique(existing, toAdd) {
    const seen = new Set(existing);
    const out = existing.slice();
    for (const v of toAdd) {
        if (seen.has(v)) continue;
        seen.add(v);
        out.push(v);
    }
    return out;
}

function matchesFilter(id, filter) {
    if (!filter) return true;
    return String(id).includes(String(filter));
}

function checkAndLoadMore(loadFunc, state, targetCount = 10) {
    if (state.loading || !state.hasMore) return;
    if (state.items.length < targetCount) {
        loadFunc(true);
    }
}

async function loadLeft(append = false) {
    if (left.loading) return;
    if (!append && left.cursor !== 0) return;
    if (!left.hasMore && append) return;

    left.loading = true;
    if (!append) {
        leftContainer.innerHTML = '<div class="loading"><div class="loader"></div>Loading...</div>';
        left.items = [];
        left.cursor = 0;
        left.nextCursor = 0;
        left.total = 0;
        left.hasMore = true;
    } else {
        const loader = document.createElement('div');
        loader.className = 'loading-trigger';
        loader.innerHTML = '<div class="loader" style="width:20px;height:20px;"></div>';
        leftContainer.appendChild(loader);
    }

    try {
        const data = await apiBatch.request(
            'getItems',
            { filter: left.filter, cursor: left.cursor },
            { dedupeKey: `getItems:${left.filter}:${left.cursor}` }
        );

        const { pack, nextCursor, total } = data;

        if (append) {
            left.items = [...left.items, ...pack];
        } else {
            left.items = pack;
        }

        left.total = total;
        left.nextCursor = nextCursor;
        left.hasMore = left.items.length < left.total;
        if (nextCursor >= 0) left.cursor = nextCursor;

        renderLeft();
    } catch (err) {
        console.error(err);
        leftContainer.innerHTML = '<div class="empty-state">Error loading items</div>';
    } finally {
        left.loading = false;
    }
}

function renderLeft() {
    if (left.items.length === 0 && !left.loading) {
        leftContainer.innerHTML = '<div class="empty-state">No items found</div>';
        return;
    }

    const itemsHtml = left.items.map(item => `
        <div class="list-item" data-id="${item}">
            <span class="item-id">#${item}</span>
            <div class="item-actions">
                <button class="icon-btn" onclick="selectItem('${item}')" title="Select">⭐</button>
            </div>
        </div>
    `).join('');

    let triggerHtml = '';
    if (left.hasMore && !left.loading) {
        triggerHtml = '<div class="scroll-trigger" style="text-align:center;padding:20px;">Scroll for more</div>';
    } else if (!left.hasMore && left.items.length > 0) {
        triggerHtml = '<div class="scroll-trigger" style="text-align:center;padding:20px;">End of list</div>';
    }

    leftContainer.innerHTML = `
        <div class="list">
            ${itemsHtml}
        </div>
        ${triggerHtml}
    `;

    setTimeout(() => {
        checkAndLoadMore(() => loadLeft(true), left);
    }, 50);
}

async function loadRight(append = false) {
    if (right.loading) return;
    if (!append && right.cursor !== 0) return;
    if (!right.hasMore && append) return;

    right.loading = true;
    if (!append) {
        rightContainer.innerHTML = '<div class="loading"><div class="loader"></div>Loading...</div>';
        right.items = [];
        right.cursor = 0;
        right.nextCursor = 0;
        right.total = 0;
        right.hasMore = true;
    } else {
        const loader = document.createElement('div');
        loader.className = 'loading-trigger';
        loader.innerHTML = '<div class="loader" style="width:20px;height:20px;"></div>';
        rightContainer.appendChild(loader);
    }

    try {
        const data = await apiBatch.request(
            'getSelection',
            { filter: right.filter, cursor: right.cursor },
            { dedupeKey: `getSelection:${right.filter}:${right.cursor}` }
        );

        const { pack, nextCursor, total } = data;
        const prevCursor = right.cursor;

        const filteredPack = Array.isArray(pack)
            ? pack.filter((id) => !pendingRightRemovals.has(id))
            : pack;

        if (append) {
            right.items = mergeUnique(right.items, filteredPack);
        } else {
            right.items = Array.isArray(filteredPack) ? filteredPack : pack;
        }

        right.total = total;
        right.nextCursor = nextCursor;
        
        if (append && Array.isArray(pack) && pack.length === 0 && (nextCursor === -1 || nextCursor === prevCursor)) {
            right.hasMore = false;
        } else {
            right.hasMore = right.items.length < right.total;
        }
        
        if (nextCursor >= 0) right.cursor = nextCursor;

        renderRight();
    } catch (err) {
        console.error(err);
        rightContainer.innerHTML = '<div class="empty-state">Error loading selection</div>';
    } finally {
        right.loading = false;
    }
}

function renderRight() {
    if (right.items.length === 0 && !right.loading) {
        rightContainer.innerHTML = '<div class="empty-state">No selected items</div>';
        return;
    }

    const itemsHtml = right.items.map(item => `
        <div class="list-item" draggable="true" data-id="${item}">
            <span class="item-id">#${item}</span>
            <div class="item-actions">
                <button class="icon-btn" onclick="deselectItem('${item}')" title="Remove">❌</button>
            </div>
        </div>
    `).join('');

    let triggerHtml = '';
    if (right.hasMore && !right.loading) {
        triggerHtml = '<div class="scroll-trigger" style="text-align:center;padding:20px;">Scroll for more</div>';
    } else if (!right.hasMore && right.items.length > 0) {
        triggerHtml = '<div class="scroll-trigger" style="text-align:center;padding:20px;">End of list</div>';
    }

    rightContainer.innerHTML = `
        <div class="list" id="rightList">
            ${itemsHtml}
        </div>
        ${triggerHtml}
    `;

    setupDragAndDrop();

    setTimeout(() => {
        checkAndLoadMore(() => loadRight(true), right);
    }, 50);
}

function attachScroll(container, loadMoreCallback) {
    let ticking = false;
    const onScroll = () => {
        if (ticking) return;
        requestAnimationFrame(() => {
            const { scrollTop, scrollHeight, clientHeight } = container;
            if (scrollTop + clientHeight >= scrollHeight - 150) {
                loadMoreCallback();
            }
            ticking = false;
        });
        ticking = true;
    };
    container.addEventListener('scroll', onScroll);
    return () => container.removeEventListener('scroll', onScroll);
}

let leftScrollCleanup = null;
let rightScrollCleanup = null;

function initScrolling() {
    if (leftScrollCleanup) leftScrollCleanup();
    if (rightScrollCleanup) rightScrollCleanup();

    leftScrollCleanup = attachScroll(leftContainer, () => {
        if (!left.loading && left.hasMore) {
            loadLeft(true);
        }
    });

    rightScrollCleanup = attachScroll(rightContainer, () => {
        if (!right.loading && right.hasMore) {
            loadRight(true);
        }
    });
}

window.selectItem = async (id) => {
    const selectionNextCursor = right.hasMore ? right.cursor : -1;

    const leftIndex = left.items.findIndex(item => item === id);
    const optimistic = {
        leftIndex,
        rightIndex: null,
        rightInserted: false,
    };

    if (leftIndex !== -1) {
        left.items.splice(leftIndex, 1);
        renderLeft();
    }

    if (matchesFilter(id, right.filter)) {
        optimistic.rightIndex = right.items.length;
        right.items.push(id);
        optimistic.rightInserted = true;
        renderRight();
    }

    pendingRightRemovals.delete(id);

    try {
        const data = await apiBatch.request(
            'select',
            {
                id,
                selectionFilter: right.filter,
                selectionNextCursor,
                itemsFilter: left.filter,
            },
            { dedupeKey: `select:${id}` }
        );

        if (data?.totalItems !== undefined) left.total = data.totalItems;
        if (data?.totalSelected !== undefined) right.total = data.totalSelected;

        left.hasMore = left.items.length < left.total;
        right.hasMore = right.items.length < right.total;

        const position = data?.position;
        if (optimistic.rightInserted && typeof position === 'number' && position >= 0) {
            const currentIdx = right.items.indexOf(id);
            if (currentIdx !== -1) {
                right.items.splice(currentIdx, 1);
                const safePos = Math.min(position, right.items.length);
                right.items.splice(safePos, 0, id);
                renderRight();
            }
        }
    } catch (e) {
        if (optimistic.rightInserted) {
            const idxRight = right.items.indexOf(id);
            if (idxRight !== -1) right.items.splice(idxRight, 1);
        }
        if (optimistic.leftIndex !== -1) left.items.splice(optimistic.leftIndex, 0, id);
        renderLeft();
        renderRight();
        alert(e?.message ? e.message : String(e));
    }
};

window.deselectItem = async (id) => {
    const itemsNextCursor = left.hasMore ? left.cursor : -1;

    const rightIndex = right.items.findIndex(item => item === id);
    const optimistic = {
        rightIndex,
        leftIndex: null,
        leftInserted: false,
    };

    if (rightIndex !== -1) {
        right.items.splice(rightIndex, 1);
        renderRight();
    }

    pendingRightRemovals.add(id);

    if (rightIndex !== -1 && right.cursor > 0) {
        right.cursor = Math.max(0, right.cursor - 1);
    }

    if (matchesFilter(id, left.filter)) {
        optimistic.leftIndex = left.items.length;
        left.items.push(id);
        optimistic.leftInserted = true;
        renderLeft();
    }

    try {
        const data = await apiBatch.request(
            'deselect',
            {
                id,
                itemsFilter: left.filter,
                itemsNextCursor,
                selectionFilter: right.filter,
            },
            { dedupeKey: `deselect:${id}` }
        );

        if (data?.totalItems !== undefined) left.total = data.totalItems;
        if (data?.totalSelected !== undefined) right.total = data.totalSelected;

        left.hasMore = left.items.length < left.total;
        right.hasMore = right.items.length < right.total;

        const position = data?.position;
        if (optimistic.leftInserted && typeof position === 'number' && position >= 0) {
            const currentIdx = left.items.indexOf(id);
            if (currentIdx !== -1) {
                left.items.splice(currentIdx, 1);
                const safePos = Math.min(position, left.items.length);
                left.items.splice(safePos, 0, id);
                renderLeft();
            }
        }
    } catch (e) {
        if ((e?.message || '').includes('Not yet selected')) {
            // Treat as idempotent success under network delays / stale client state
            return;
        }
        if (optimistic.leftInserted) {
            const idxLeft = left.items.indexOf(id);
            if (idxLeft !== -1) left.items.splice(idxLeft, 1);
        }
        if (optimistic.rightIndex !== -1) right.items.splice(optimistic.rightIndex, 0, id);
        renderLeft();
        renderRight();
        alert(e?.message ? e.message : String(e));
    }
};

function setupDragAndDrop() {
    const draggables = document.querySelectorAll('#rightList .list-item');
    const container = document.getElementById('rightList');
    if (!container) return;

    let draggedItemId = null;

    draggables.forEach(drag => {
        drag.setAttribute('draggable', 'true');
        drag.addEventListener('dragstart', (e) => {
            draggedItemId = drag.dataset.id;
            e.dataTransfer.setData('text/plain', draggedItemId);
            drag.classList.add('dragging');
        });
        drag.addEventListener('dragend', (e) => {
            drag.classList.remove('dragging');
            draggedItemId = null;
        });
    });

    container.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    container.addEventListener('drop', async (e) => {
        e.preventDefault();
        const target = e.target.closest('.list-item');
        if (!target || !draggedItemId) return;
        const targetId = target.dataset.id;
        if (draggedItemId === targetId) return;

        const prev = right.items.slice();
        const srcIdx = right.items.indexOf(draggedItemId);
        const tgtIdx = right.items.indexOf(targetId);
        if (srcIdx !== -1 && tgtIdx !== -1) {
            right.items.splice(srcIdx, 1);
            const newTgtIdx = right.items.indexOf(targetId);
            right.items.splice(newTgtIdx, 0, draggedItemId);
            renderRight();
        }

        try {
            await apiBatch.request(
                'move',
                { sourceId: draggedItemId, targetId },
                { dedupeKey: `move:${draggedItemId}:${targetId}` }
            );
        } catch (err) {
            right.items = prev;
            renderRight();
            alert(err?.message ? err.message : String(err));
        }
    });
}

addBtn.addEventListener('click', async () => {
    const newId = newIdInput.value.trim();
    if (!newId) {
        alert('Enter ID');
        return;
    }

    try {
        await apiAddBatch.request(
            'add',
            { id: newId },
            { dedupeKey: `add:${newId}` }
        );
        newIdInput.value = '';
        left.cursor = 0;
        left.hasMore = true;
        await loadLeft(false);
        initScrolling();
    } catch (e) {
        alert(e?.message ? e.message : String(e));
    }
});

let leftDebounce, rightDebounce;
leftSearch.addEventListener('input', (e) => {
    clearTimeout(leftDebounce);
    leftDebounce = setTimeout(async () => {
        left.filter = e.target.value;
        left.cursor = 0;
        left.hasMore = true;
        await loadLeft(false);
        initScrolling();
    }, 300);
});

rightSearch.addEventListener('input', (e) => {
    clearTimeout(rightDebounce);
    rightDebounce = setTimeout(async () => {
        right.filter = e.target.value;
        right.cursor = 0;
        right.hasMore = true;
        await loadRight(false);
        initScrolling();
    }, 300);
});

async function init() {
    await Promise.all([loadLeft(false), loadRight(false)]);
    initScrolling();
}

init();