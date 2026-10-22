const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Store, normalize, equal } = require('../sync-store.js');
const copy = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));

// Firebase contract double: transactions serialize and notify independent clients.
// Emulator integration is separate; these tests do not contact the school database.
class Database {
    constructor(data = {}) { this.data = copy(data); this.listeners = {}; this.queue = Promise.resolve(); this.denied = false; }
    ref(path) {
        return {
            on: (_, listener) => {
                (this.listeners[path] ||= new Set()).add(listener);
                queueMicrotask(() => listener({ val: () => path === '.info/connected' ? true : copy(this.data[path] ?? null) }));
            },
            off: (_, listener) => this.listeners[path]?.delete(listener),
            transaction: update => {
                const job = this.queue.catch(() => {}).then(async () => {
                    await tick();
                    if (this.denied) throw new Error('PERMISSION_DENIED');
                    const value = update(copy(this.data[path] ?? null));
                    if (value === undefined) return { committed: false };
                    this.data[path] = copy(value);
                    this.emit(path);
                    return { committed: true, snapshot: { val: () => copy(value) } };
                });
                this.queue = job;
                return job;
            }
        };
    }
    emit(path) { this.listeners[path]?.forEach(listener => listener({ val: () => copy(this.data[path] ?? null) })); }
}
async function client(db, names = ['teachers']) {
    const views = {};
    const states = [];
    const store = new Store(db, names, (name, data) => { views[name] = data; }, state => states.push(state));
    store.start();
    await tick();
    return { store, views, states };
}

test('loads authoritative cloud records into two independent clients', async () => {
    const db = new Database({ teachers: [{ id: 1, name: 'A', allotments: [] }] });
    const a = await client(db), b = await client(db);
    assert.equal(a.store.ready, true);
    assert.deepEqual(a.views, b.views);
    assert.equal(a.views.teachers['1'].name, 'A');
});
test('a confirmed teacher creation appears on the other device and after restart', async () => {
    const db = new Database();
    const a = await client(db), b = await client(db);
    await a.store.save('teachers', [{ id: 10, name: 'Teacher', allotments: [] }]);
    assert.equal(b.views.teachers['10'].name, 'Teacher');
    const reopened = await client(db);
    assert.deepEqual(reopened.views, b.views);
});
test('concurrent additions from stale clients preserve both records', async () => {
    const db = new Database();
    const a = await client(db), b = await client(db);
    await Promise.all([
        a.store.save('teachers', [{ id: 1, name: 'A', allotments: [] }]),
        b.store.save('teachers', [{ id: 2, name: 'B', allotments: [] }])
    ]);
    assert.deepEqual(Object.keys(db.data.teachers).sort(), ['1', '2']);
    assert.deepEqual(a.views, b.views);
});
test('concurrent edits to different fields merge', async () => {
    const db = new Database({ teachers: [{ id: 1, name: 'Old', desig: 'Old', allotments: [] }] });
    const a = await client(db), b = await client(db);
    await Promise.all([
        a.store.save('teachers', [{ id: 1, name: 'New', desig: 'Old', allotments: [] }]),
        b.store.save('teachers', [{ id: 1, name: 'Old', desig: 'New designation', allotments: [] }])
    ]);
    assert.equal(db.data.teachers['1'].name, 'New');
    assert.equal(db.data.teachers['1'].desig, 'New designation');
});
test('concurrent same-field edits reject the stale save and keep the first confirmed value', async () => {
    const db = new Database({ teachers: [{ id: 1, name: 'Old', allotments: [] }] });
    const a = await client(db), b = await client(db);
    const results = await Promise.allSettled([
        a.store.save('teachers', [{ id: 1, name: 'First', allotments: [] }]),
        b.store.save('teachers', [{ id: 1, name: 'Second', allotments: [] }])
    ]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    assert.match(results[1].reason.message, /Another device/);
    assert.equal(b.views.teachers['1'].name, 'First');
    assert.equal(b.store.pendingCount, 0);
});
test('a stale open form cannot overwrite a later remote change', async () => {
    const db = new Database({ teachers: [{ id: 1, name: 'Old', allotments: [] }] });
    const a = await client(db), b = await client(db);
    const old = copy(b.views.teachers['1']);
    await a.store.save('teachers', [{ id: 1, name: 'Remote', allotments: [] }]);
    await assert.rejects(b.store.save('teachers', [{ id: 1, name: 'Stale form', allotments: [] }], [{ path: ['1'], value: old }]), /Another device/);
    assert.equal(db.data.teachers['1'].name, 'Remote');
});
test('an unchanged stale form field does not undo a remote edit to that field', async () => {
    const db = new Database({ teachers: [{ id: 1, name: 'Old', desig: 'Old role', allotments: [] }] });
    const a = await client(db), b = await client(db);
    const old = copy(b.views.teachers['1']);
    await a.store.save('teachers', [{ id: 1, name: 'Remote name', desig: 'Old role', allotments: [] }]);
    await b.store.save('teachers', [{ id: 1, name: 'Old', desig: 'New role', allotments: [] }], [{ path: ['1'], value: old }]);
    assert.equal(db.data.teachers['1'].name, 'Remote name');
    assert.equal(db.data.teachers['1'].desig, 'New role');
});
test('deleting the last record clears both devices and survives a fresh connection', async () => {
    const db = new Database({ teachers: [{ id: 1, name: 'Old', allotments: [] }] });
    const a = await client(db), b = await client(db);
    await a.store.save('teachers', []);
    assert.deepEqual(b.views.teachers, {});
    assert.deepEqual((await client(db)).views.teachers, {});
});
test('an edited record deleted by another device is not recreated', async () => {
    const db = new Database({ teachers: [{ id: 1, name: 'Old', allotments: [] }] });
    const a = await client(db), b = await client(db);
    const old = copy(b.views.teachers['1']);
    await a.store.save('teachers', []);
    await assert.rejects(b.store.save('teachers', [{ id: 1, name: 'Old', extra: 'New', allotments: [] }], [{ path: ['1'], value: old }]), /Another device/);
    assert.deepEqual(db.data.teachers, {});
});
test('offline and unloaded clients cannot submit writes', async () => {
    const db = new Database();
    const store = new Store(db, ['teachers'], () => {}, () => {});
    assert.throws(() => store.save('teachers', []), /not loaded/);
    const a = await client(db);
    a.store.connected = false;
    assert.throws(() => a.store.save('teachers', []), /offline/);
});
test('permission-denied writes reject, restore the server view, and clear pending state', async () => {
    const db = new Database();
    const a = await client(db);
    db.denied = true;
    await assert.rejects(a.store.save('teachers', [{ id: 1, name: 'Not saved' }]), /PERMISSION_DENIED/);
    assert.deepEqual(a.views.teachers, {});
    assert.equal(a.store.pendingCount, 0);
});
test('save stays pending until the transaction is acknowledged', async () => {
    const db = new Database();
    const a = await client(db);
    const pending = a.store.save('teachers', [{ id: 1, name: 'Pending' }]);
    assert.equal(a.store.pendingCount, 1);
    await pending;
    assert.equal(a.store.pendingCount, 0);
});
test('legacy array exam IDs become stable keys while preserving every exam', async () => {
    const db = new Database({ archivedExams: [null, { id: 100, title: 'A' }, { id: 200, title: 'B' }] });
    const a = await client(db, ['archivedExams']);
    const desired = copy(a.views.archivedExams);
    desired['100'].title = 'Updated';
    await a.store.save('archivedExams', desired);
    assert.deepEqual(Object.keys(db.data.archivedExams), ['100', '200']);
    assert.equal(db.data.archivedExams['200'].title, 'B');
});
test('legacy import is repeatable and keeps cloud values', async () => {
    const db = new Database({ teachers: [{ id: 1, name: 'Cloud', allotments: [] }] });
    const a = await client(db);
    const legacy = [{ id: 1, name: 'Old local', allotments: [] }, { id: 2, name: 'Local only', allotments: [] }];
    await a.store.importMissing('teachers', legacy);
    const first = copy(db.data.teachers);
    await a.store.importMissing('teachers', legacy);
    assert.deepEqual(db.data.teachers, first);
    assert.equal(db.data.teachers['1'].name, 'Cloud');
    assert.equal(db.data.teachers['2'].name, 'Local only');
});
test('all shared collections propagate independently', async () => {
    const names = ['students', 'sectionConfigs', 'classTeacherAssignments', 'qpSubmissionsTracker', 'qpPrintingTracker', 'qpSubmissionDeadlines'];
    const db = new Database();
    const a = await client(db, names), b = await client(db, names);
    const data = {
        students: { 10: { A: { student1: { id: 'student1', name: 'Sample', subjects: ['SCIENCE'] } } } },
        sectionConfigs: { '10-A': ['SCIENCE'] }, classTeacherAssignments: { '10-A': { ct: 'Sample' } },
        qpSubmissionsTracker: { '100|10|SCIENCE': { qpReceived: true } },
        qpPrintingTracker: { '100|10|SCIENCE': 'Completed' }, qpSubmissionDeadlines: { 100: '2026-11-01' }
    };
    await Promise.all(names.map(name => a.store.save(name, data[name])));
    assert.deepEqual(a.views, b.views);
    for (const name of names) assert.deepEqual(b.views[name], data[name]);
});
test('normalizes Firebase omissions of empty lists and rejects invalid keys', () => {
    assert.deepEqual(normalize('archivedExams', [{ id: 1 }])['1'].datesheetSnapshot, []);
    assert.equal(equal({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
    assert.throws(() => normalize('teachers', [{ id: 'bad/id' }]), /invalid ID/);
});
test('Firebase numeric-key arrays normalize to maps before applying student edits', async () => {
    const students = [];
    students[6] = { A: { first: { id: 'first', name: 'First' } } };
    const db = new Database({ students });
    const a = await client(db, ['students']);
    assert.equal(Array.isArray(a.views.students), false);
    const desired = copy(a.views.students);
    desired['6'].A.second = { id: 'second', name: 'Second' };
    await a.store.save('students', desired);
    assert.equal(db.data.students['6'].A.first.name, 'First');
    assert.equal(db.data.students['6'].A.second.name, 'Second');
});
test('an edit cannot recreate a student section deleted on another device', async () => {
    const db = new Database({ students: { 10: { A: { one: { id: 'one', name: 'Original' } } } } });
    const a = await client(db, ['students']);
    const old = copy(a.views.students['10'].A.one);
    db.data.students = { 10: {} };
    db.emit('students');
    await assert.rejects(a.store.save('students', { 10: { A: { one: { ...old, newField: 'Value' } } } },
        [{ path: ['10', 'A', 'one'], value: old }]), /Another device/);
    assert.deepEqual(db.data.students, { 10: {} });
});
