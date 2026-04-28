class DB {
    constructor() {
        this.items = [];
        this.selection = [];
        this.itemsSearchCache = {
            filter: "",
            list: []
        };
        this.selectionSearchCache = {
            filter: "",
            list: []
        };
    }

    generateItems() {
        this.items = Array.from({ length: 1000000 }, (_, i) => String(i + 1));
    }

    getList(filter, list, cache) {
        if (!filter) return list;
        
        if (filter === cache.filter) {
            return cache.list;
        }

        cache.filter = filter;
        cache.list = list.filter(e => e.includes(filter));
        return cache.list;
    }

    countItems(filter) {
        return this.getList(filter, this.items, this.itemsSearchCache).length;
    }

    getItems(filter, cursor, limit = 20) {
        const list = this.getList(filter, this.items, this.itemsSearchCache);
        let index = cursor;

        const pack = [];
        while (true) {
            if (list[index] == undefined) {
                index = -2;
                break;
            }

            if (!this.selection.includes(list[index])) pack.push(list[index]);
            if (pack.length === limit) break;

            index++;
        }

        const nextCursor = list[index + 1] != undefined ? index + 1 : -1;

        return {pack, nextCursor, total: list.length};
    }

    addItem(id) {
        if (this.items.includes(id)) return false;
        this.items.push(id);
        this.itemsSearchCache.filter = "";
        return true;
    }

    countSelection(filter) {
        return this.getList(filter, this.selection, this.selectionSearchCache).length;
    }

    getSelection(filter, cursor, limit = 20) {
        const list = this.getList(filter, this.selection, this.selectionSearchCache);
        let index = cursor;

        const pack = [];
        while (true) {
            if (list[index] == undefined) {
                index = -2;
                break;
            }

            pack.push(list[index]);
            if (pack.length === limit) break;

            index++;
        }

        const nextCursor = list[index + 1] != undefined ? index + 1 : -1;

        return {pack, nextCursor, total: list.length};
    }

    selectItem(id) {
        if (this.selection.includes(id)) return false;

        this.selection.push(id);
        this.selectionSearchCache.filter = "";

        return true;
    }

    getSelectedPosition(id, filter, cursor) {
        let list = this.getList(filter, this.selection, this.selectionSearchCache);
        if (cursor > 0 && cursor < list.length) list = list.slice(0, cursor);
        return list.indexOf(id);
    }

    deselectItem(id) {
        if (!this.selection.includes(id)) return false;

        this.selection = this.selection.filter(i => i != id);
        this.selectionSearchCache.filter = "";

        return true;
    }

    getItemsPosition(id, filter, cursor) {
        let list = this.getList(filter, this.items, this.itemsSearchCache);
        if (cursor > 0 && cursor < list.length) list = list.slice(0, cursor);

        let pos = 0;
        for (let i = 0; i < list.length; i++) {
            if (!this.selection.includes(list[i])) {
                if (list[i] === id) return pos;
                pos++;
            }
        }
        return -1;
    }

    moveItem(sourceId, targetId) {
    const srcIndex = this.selection.indexOf(sourceId);
    const tgtIndex = this.selection.indexOf(targetId);
    if (srcIndex === -1 || tgtIndex === -1) return false;
    if (srcIndex === tgtIndex) return true;

    this.selection.splice(srcIndex, 1);
    const newTgtIndex = this.selection.indexOf(targetId);
    this.selection.splice(newTgtIndex, 0, sourceId);
    
    this.selectionSearchCache.filter = "";
    return true;
}
}

const db = new DB();
export default db;