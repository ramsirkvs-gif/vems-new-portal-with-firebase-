const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../evaluation-planning.js');
const timetable = require('../assets/teacher-timetable-2026-11-08.js');

test('planning expands actual scheduled sections, deduplicates slots and preserves per-section evaluators and assignments', () => {
    const slot = { dateStr: '2026-11-12', cls: '10', subject: 'ENGLISH', selectedSections: ['A', 'B'] };
    const savedKey = P.key(['2026-11-12', '10', 'B', 'ENGLISH']);
    const exam = { evaluationPlan: { assignments: { [savedKey]: { checkerId: 'primary' } } } };
    const rows = P.rows(exam, [slot, slot, { ...slot, dateStr: '2026-11-13', selectedSections: ['A'] }], () => { throw Error('must use scheduled sections'); }, row => `Evaluator ${row.section}`);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.slice(0, 2).map(row => row.evaluator), ['Evaluator A', 'Evaluator B']);
    assert.equal(rows[1].assignment.checkerId, 'primary');
    assert.notEqual(rows[0].key, rows[2].key);
});
test('planning uses configured sections when a paper covers the entire class', () => {
    assert.deepEqual(P.rows({}, [{ dateStr: '2026-11-12', cls: '11', subject: 'CS' }], () => ['A', 'E'], () => 'Not mapped').map(row => row.section), ['A', 'E']);
});
test('all live faculty and six bundled Primary teachers are offered without duplicate names or vacancies', () => {
    const faculty = P.faculty([{ id: 'live', name: 'Anil Kumar', desig: 'PRT' }, { id: 's', name: 'Secondary', desig: 'TGT' }, { id: 'v', name: 'PRT VACANT', desig: 'PRT' }], timetable.teachers);
    assert.equal(faculty.filter(t => t.primary).length, 6);
    assert.equal(faculty.filter(t => /ANIL KUMAR/i.test(t.name)).length, 1);
    assert.ok(faculty.some(t => t.id === 's'));
    assert.ok(!faculty.some(t => t.id === 'v'));
});
test('Samagam options follow saved core team membership and exclude metadata and unavailable teachers', () => {
    const faculty = P.faculty([{ id: 1, name: 'One', desig: 'TGT' }, { id: 2, name: 'Two', desig: 'PRT' }, { id: 3, name: 'Three', desig: 'PGT' }]);
    const team = { 1: { teacherId: '1' }, 2: { teacherId: 2 }, missing: { teacherId: 'missing' }, __roles: ['One'] };
    assert.deepEqual(P.coreFaculty(faculty, team).map(t => t.id).sort(), ['1', '2']);
    assert.deepEqual(P.coreFaculty(faculty, {}), []);
});
test('review invalidates when a date, evaluator or checking assignment changes', () => {
    const rows = [{ key: 'date|class|section|subject', evaluator: 'One', checkerId: 'p1', checker: 'Primary One', matcherId: 's1', matcher: 'Secondary One' }];
    for (const [field, value] of [['key', 'new-date'], ['evaluator', 'Two'], ['checkerId', 'p2'], ['matcher', 'New name']]) assert.notEqual(P.signature(rows), P.signature([{ ...rows[0], [field]: value }]));
    assert.doesNotMatch(P.key(['CS/IP.#$[]', 'A']), /[.#$\[\]/]/);
});
test('PDF repeats column headers across pages and preserves every scheduled row and long faculty name', () => {
    const rows = Array.from({ length: 90 }, (_, i) => ({ subject: `SUBJECT_${i}`, cls: '12', section: 'A', date: '2026-11-12', evaluator: 'Evaluator Name', checker: 'Primary Teacher with a long name that needs wrapping', matcher: `Matcher_${i}` }));
    const streams = P.pdfStreams({ examTitle: 'Preboard-1', rows, reviewed: false });
    assert.ok(streams.length > 1);
    for (const stream of streams) { assert.match(stream, /PRE-SAMAGAM/); assert.match(stream, /Evaluator/); assert.match(stream, /Cross-checker/); }
    const combined = streams.join('');
    for (let i = 0; i < 90; i++) { assert.ok(combined.includes(`SUBJECT_${i})`)); assert.ok(combined.includes(`Matcher_${i})`)); }
    assert.match(combined, /Primary Teacher/);
    assert.match(combined, /wrapping/);
});
