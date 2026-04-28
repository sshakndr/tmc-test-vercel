import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './functions.js';

process.stdout.write('Generating items...');
db.generateItems();
process.stdout.write('done\n');

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/batch', (req, res) => {
    try {
        const { ops } = req.body ?? {};
        if (!Array.isArray(ops)) {
            return res.status(400).json({ error: 'ops must be an array' });
        }

        const seen = new Set();
        const results = ops.map((op) => {
            const opId = op?.opId;
            const type = op?.type;
            const payload = op?.payload ?? {};

            if (typeof opId !== 'string' || !opId) {
                return { opId: opId ?? null, ok: false, error: 'opId required' };
            }
            if (typeof type !== 'string' || !type) {
                return { opId, ok: false, error: 'type required' };
            }

            const dedupeKey = typeof op?.dedupeKey === 'string' && op.dedupeKey
                ? op.dedupeKey
                : `${type}:${JSON.stringify(payload)}`;
            if (seen.has(dedupeKey)) {
                return { opId, ok: true, deduped: true };
            }
            seen.add(dedupeKey);

            try {
                if (type === 'getItems') {
                    const filter = payload.filter ?? '';
                    const cursorNum = Number.parseInt(payload.cursor, 10);
                    if (Number.isNaN(cursorNum) || cursorNum < 0) {
                        return { opId, ok: false, error: 'cursor must be a positive integer' };
                    }
                    return { opId, ok: true, data: db.getItems(filter, cursorNum) };
                }

                if (type === 'getSelection') {
                    const filter = payload.filter ?? '';
                    const cursorNum = Number.parseInt(payload.cursor, 10);
                    if (Number.isNaN(cursorNum) || cursorNum < 0) {
                        return { opId, ok: false, error: 'cursor must be a positive integer' };
                    }
                    return { opId, ok: true, data: db.getSelection(filter, cursorNum) };
                }

                if (type === 'select') {
                    const id = payload.id;
                    const selectionFilter = payload.selectionFilter ?? '';
                    const selectionNextCursor = payload.selectionNextCursor;
                    const itemsFilter = payload.itemsFilter ?? '';

                    if (!id) return { opId, ok: false, error: 'No id provided' };
                    if (!db.items.includes(id)) return { opId, ok: false, error: 'ID does not exist' };

                    const cursorNum = Number.parseInt(selectionNextCursor, 10);
                    if (Number.isNaN(cursorNum)) {
                        return { opId, ok: false, error: 'Selection next cursor must be integer' };
                    }

                    const selected = db.selectItem(id);
                    if (!selected) return { opId, ok: false, error: 'Already selected' };

                    const position = db.getSelectedPosition(id, selectionFilter, cursorNum);
                    return {
                        opId,
                        ok: true,
                        data: {
                            totalItems: db.countItems(itemsFilter),
                            totalSelected: db.countSelection(selectionFilter),
                            position,
                        },
                    };
                }

                if (type === 'deselect') {
                    const id = payload.id;
                    const itemsFilter = payload.itemsFilter ?? '';
                    const itemsNextCursor = payload.itemsNextCursor;
                    const selectionFilter = payload.selectionFilter ?? '';

                    if (!id) return { opId, ok: false, error: 'No id provided' };
                    if (!db.items.includes(id)) return { opId, ok: false, error: 'ID does not exist' };

                    const cursorNum = Number.parseInt(itemsNextCursor, 10);
                    if (Number.isNaN(cursorNum)) {
                        return { opId, ok: false, error: 'Items next cursor must be integer' };
                    }

                    const deselected = db.deselectItem(id);
                    if (!deselected) {
                        return {
                            opId,
                            ok: true,
                            data: {
                                totalSelected: db.countSelection(selectionFilter),
                                totalItems: db.countItems(itemsFilter),
                                position: -1,
                            },
                        };
                    }

                    const position = db.getItemsPosition(id, itemsFilter, cursorNum);
                    return {
                        opId,
                        ok: true,
                        data: {
                            totalSelected: db.countSelection(selectionFilter),
                            totalItems: db.countItems(itemsFilter),
                            position,
                        },
                    };
                }

                if (type === 'move') {
                    const sourceId = payload.sourceId;
                    const targetId = payload.targetId;
                    if (!sourceId || !targetId) {
                        return { opId, ok: false, error: 'sourceId and targetId required' };
                    }
                    const moved = db.moveItem(sourceId, targetId);
                    if (!moved) {
                        return { opId, ok: false, error: 'Move failed (invalid ids or not selected)' };
                    }
                    return { opId, ok: true, data: { success: true } };
                }

                if (type === 'add') {
                    const id = payload.id;
                    if (!id || typeof id !== 'string') {
                        return { opId, ok: false, error: 'Invalid id' };
                    }
                    const added = db.addItem(id);
                    if (!added) {
                        return { opId, ok: false, error: 'ID already exists' };
                    }
                    return { opId, ok: true, data: { success: true } };
                }

                return { opId, ok: false, error: `Unknown op type: ${type}` };
            } catch (e) {
                return { opId, ok: false, error: e?.message ? e.message : String(e) };
            }
        });

        return res.json({ results });
    } catch (e) {
        return res.status(500).json({ error: e?.message ? e.message : String(e) });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});