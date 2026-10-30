/* Shared Firebase state. Also exported for the emulator and concurrency tests. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.VemsSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const copy = value => JSON.parse(JSON.stringify(value));
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const equal = (a, b) => {
        if (a === b) return true;
        if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
        if (object(a) && object(b)) {
            const keys = Object.keys(a);
            return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && equal(a[k], b[k]));
        }
        return false;
    };
    const validKey = key => !/[.#$\[\]/]/.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key);
    function recordMap(value) {
        const result = {};
        Object.values(value || {}).filter(Boolean).forEach(record => {
            if (record.id === undefined || !validKey(String(record.id))) throw new Error('A record has an invalid ID.');
            result[String(record.id)] = copy(record);
        });
        return result;
    }
    function normalize(name, value) {
        if (value !== null && value !== undefined && typeof value !== 'object') throw new Error(`Invalid shared data at ${name}. Keep a backup and review this collection.`);
        const data = ['teachers', 'archivedExams', 'examOptionsList'].includes(name) ? recordMap(value)
            : Object.fromEntries(Object.entries(copy(value || {})).filter(([, entry]) => entry !== null));
        if (name === 'teachers') Object.values(data).forEach(t => { t.allotments = t.allotments || []; });
        if (name === 'archivedExams') Object.values(data).forEach(exam => {
            exam.datesheetSnapshot = exam.datesheetSnapshot || [];
            exam.datesheetSnapshot.forEach(day => {
                day.paperSlots = day.paperSlots || [];
                day.paperSlots.forEach(slot => { slot.selectedSections = slot.selectedSections || []; });
            });
        });
        return data;
    }
    function diff(before, after, path = []) {
        if (equal(before, after)) return [];
        if (object(before) && object(after)) {
            return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key => {
                if (!validKey(key)) throw new Error('A record contains an invalid Firebase key.');
                return diff(before[key], after[key], path.concat(key));
            });
        }
        return [{ path, before: before === undefined ? null : copy(before), after: after === undefined ? null : copy(after) }];
    }
    function get(data, path) {
        let value = data;
        for (const key of path) value = value == null ? undefined : value[key];
        return value === undefined ? null : value;
    }
    function apply(data, patch, checkConflicts = false) {
        const result = copy(data);
        for (const change of patch) {
            const current = get(result, change.path);
            if (checkConflicts && !equal(current, change.before) && !equal(current, change.after)) return null;
            let parent = result;
            for (const key of change.path.slice(0, -1)) {
                if (!object(parent[key])) parent[key] = {};
                parent = parent[key];
            }
            const key = change.path[change.path.length - 1];
            if (change.after === null) delete parent[key];
            else parent[key] = copy(change.after);
        }
        return result;
    }
    function missingOnly(current, legacy) {
        const result = copy(current);
        Object.entries(legacy).forEach(([key, value]) => {
            if (!validKey(key)) throw new Error('The backup contains an invalid Firebase key.');
            if (!Object.hasOwn(result, key)) result[key] = copy(value);
            else if (object(result[key]) && object(value)) result[key] = missingOnly(result[key], value);
        });
        return result;
    }
    class Store {
        constructor(db, names, onValue, onStatus, paths = {}) {
            this.db = db;
            this.names = names;
            this.onValue = onValue;
            this.onStatus = onStatus;
            this.remote = {};
            this.pending = {};
            this.queues = {};
            this.loaded = new Set();
            this.connected = false;
            this.error = '';
            this.imports = 0;
            this.active = true;
            this.unsubscribers = [];
            this.paths = paths;
        }
        path(name) { return this.paths[name] || name; }
        get ready() { return this.active && this.loaded.size === this.names.length && !this.error; }
        get pendingCount() { return this.imports + Object.values(this.pending).reduce((n, list) => n + list.length, 0); }
        status() { this.onStatus({ ready: this.ready, connected: this.connected, pending: this.pendingCount, error: this.error }); }
        view(name) {
            return (this.pending[name] || []).reduce((data, operation) => apply(data, operation.patch), copy(this.remote[name] || {}));
        }
        emit(name) {
            if (!this.active || !this.loaded.has(name)) return;
            try { this.onValue(name, this.view(name)); }
            catch (error) {
                // A legacy/malformed record can break one UI renderer. It must never be
                // reported as a Firebase permission failure or make every collection
                // read-only. Later collection events can still complete the screen.
                this.lastRenderError = { name, message: error?.message || String(error) };
                if (typeof console !== 'undefined') console.error(`Shared ${name} display skipped:`, error);
            }
        }
        replaceRemote(name, value) {
            if (!this.active || !this.names.includes(name)) return;
            this.remote[name] = normalize(name, value);
            this.loaded.add(name);
            this.emit(name);
            this.status();
        }
        start() {
            const listen = (path, next, fail) => {
                const ref = this.db.ref(path);
                ref.on('value', next, fail);
                this.unsubscribers.push(() => ref.off('value', next));
            };
            listen('.info/connected', snapshot => { this.connected = snapshot.val() === true; this.status(); });
            this.names.forEach(name => listen(this.path(name), snapshot => {
                if (!this.active) return;
                try {
                    this.remote[name] = normalize(name, snapshot.val());
                    this.loaded.add(name);
                    this.emit(name);
                    this.status();
                } catch (error) { this.fail(error); }
            }, error => this.fail(error)));
        }
        fail(error) { this.error = error.message || String(error); this.status(); }
        stop() {
            this.active = false;
            this.unsubscribers.forEach(off => off());
            this.connected = false;
        }
        assertWritable() {
            if (!this.ready) throw new Error('Shared data is not loaded. Check your sign-in and Firebase permissions.');
            if (!this.connected) throw new Error('You are offline. Reconnect before saving; this change has not been saved.');
        }
        save(name, desired, expectedRecords = []) {
            this.assertWritable();
            const before = apply(this.view(name), expectedRecords.map(record => ({ path: record.path, after: record.value })));
            const patch = diff(before, normalize(name, desired));
            if (!patch.length) return Promise.resolve();
            const operation = { patch };
            (this.pending[name] ||= []).push(operation);
            this.status();
            const job = (this.queues[name] || Promise.resolve()).catch(() => {}).then(async () => {
                if (!this.active) throw new Error('The session changed before the save finished. Sign in and check the record.');
                let conflict = false;
                const result = await this.db.ref(this.path(name)).transaction(current => {
                    if (!this.active) return;
                    // Saves start only after this root's listener has populated the SDK cache.
                    const normalized = normalize(name, current);
                    if (patch.some(change => change.path.some((_, index) => index > 0
                        && get(before, change.path.slice(0, index)) !== null && get(normalized, change.path.slice(0, index)) === null))) {
                        conflict = true;
                        return;
                    }
                    const updated = apply(normalized, patch, true);
                    conflict = updated === null;
                    return updated === null ? undefined : updated;
                }, undefined, false);
                if (!result.committed) throw new Error(conflict
                    ? 'Another device changed the same field. Its saved value was kept. Review the latest record and try again.'
                    : 'The save was cancelled because your session changed.');
                this.remote[name] = normalize(name, result.snapshot.val());
            });
            this.queues[name] = job;
            return job.finally(() => {
                this.pending[name] = this.pending[name].filter(item => item !== operation);
                this.emit(name);
                this.status();
            });
        }
        async importMissing(name, legacy) {
            this.assertWritable();
            const incoming = normalize(name, legacy);
            this.imports++;
            this.status();
            try {
                const result = await this.db.ref(this.path(name)).transaction(current => {
                    if (!this.active) return;
                    return missingOnly(normalize(name, current), incoming);
                }, undefined, false);
                if (!result.committed) throw new Error('Import cancelled because the session changed.');
                this.remote[name] = normalize(name, result.snapshot.val());
                this.emit(name);
            } finally { this.imports--; this.status(); }
        }
    }
    return { Store, normalize, diff, apply, missingOnly, equal };
});
