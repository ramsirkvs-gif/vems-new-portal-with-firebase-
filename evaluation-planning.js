/* Evaluation assignments are private until an explicit publication creates a snapshot. */
'use strict';
const EvaluationPlanning = (() => {
    const key = parts => parts.map(value => encodeURIComponent(String(value)).replace(/\./g, '%2E')).join('|');
    const nameKey = value => String(value || '').toUpperCase().replace(/\b(DR|MR|MRS|MS|MISS)\b/g, '').replace(/[^A-Z0-9]/g, '');
    function faculty(records, timetable = []) {
        const result = records.map(t => ({ id: String(t.id), name: t.name, desig: t.desig || '', primary: /PRT|PRIMARY|HEADMASTER|HEADMISTRESS|^HM\b/i.test(t.desig || '') || (t.allotments || []).some(a => Number(a.cls) >= 1 && Number(a.cls) <= 5) }));
        for (const t of timetable) {
            if (!/PRT|PRIMARY|HEADMASTER|HEADMISTRESS|^HM\b/i.test(t.designation || '')) continue;
            const existing = result.find(item => nameKey(item.name) === nameKey(t.name));
            if (existing) existing.primary = true;
            else result.push({ id: `timetable:${t.id}`, name: t.name, desig: t.designation, primary: true, source: 'Primary timetable' });
        }
        return result.filter(t => t.name && !/VACANT/i.test(t.name)).sort((a, b) => a.name.localeCompare(b.name));
    }
    function rows(exam, scheduled, getSections, getEvaluator) {
        const result = new Map();
        for (const paper of scheduled) {
            if (!paper.cls || !paper.subject || !paper.dateStr) continue;
            const sections = paper.selectedSections?.length ? paper.selectedSections : getSections(String(paper.cls));
            for (const section of sections) {
                const row = { date: paper.dateStr, subject: paper.subject, cls: String(paper.cls), section: String(section) };
                row.key = key([row.date, row.cls, row.section, row.subject]);
                row.evaluator = getEvaluator(row);
                row.assignment = exam.evaluationPlan?.assignments?.[row.key] || {};
                result.set(row.key, row);
            }
        }
        return [...result.values()].sort((a, b) => a.date.localeCompare(b.date) || a.subject.localeCompare(b.subject) || a.cls.localeCompare(b.cls, undefined, { numeric: true }) || a.section.localeCompare(b.section));
    }
    const signature = rows => JSON.stringify(rows.map(row => [row.key, row.evaluator, row.checkerId || '', row.checker || '', row.matcherId || '', row.matcher || '']));
    return { key, faculty, rows, signature };
})();
if (typeof module !== 'undefined') module.exports = EvaluationPlanning;

let evaluationPlanningExamId = '';
let evaluationPlanningBusy = false;
const evaluationPlanningDrafts = new Map();
function evaluationPlanningDraftKey(exam) { return `${selectedAcademicSession}:${exam.id}`; }
function evaluationPlanningFaculty() {
    return EvaluationPlanning.faculty(teachers, typeof VEMSTeacherTimetable === 'undefined' ? [] : VEMSTeacherTimetable.teachers);
}
function evaluationPlanningExam() {
    return archivedExams.find(exam => String(exam.id) === evaluationPlanningExamId);
}
function evaluationPlanningRows(exam, useDraft = true) {
    const faculty = evaluationPlanningFaculty(), draft = useDraft ? evaluationPlanningDrafts.get(evaluationPlanningDraftKey(exam)) : null;
    return EvaluationPlanning.rows(exam, examDatesheetRows(exam), getAllSectionsForClass, mappedEvaluatorForExamRow).map(row => {
        const assignment = draft?.[row.key] || row.assignment;
        const checker = faculty.find(t => t.id === assignment.checkerId), matcher = faculty.find(t => t.id === assignment.matcherId);
        return { ...row, checkerId: assignment.checkerId || '', matcherId: assignment.matcherId || '', checker: checker?.name || '', matcher: matcher?.name || '' };
    });
}
function evaluationPlanningCanEdit() {
    return authorizedRole === 'principal' && !isSelectedSessionFrozen() && !evaluationPlanningBusy;
}
function selectEvaluationPlanningExam(value) { evaluationPlanningExamId = value; renderEvaluationPlanning(); }
function updateEvaluationPlanningAssignment(key, field, value) {
    if (!evaluationPlanningCanEdit() || !['checkerId', 'matcherId'].includes(field)) return;
    const exam = evaluationPlanningExam(), rows = evaluationPlanningRows(exam);
    const draft = Object.fromEntries(rows.map(row => [row.key, { checkerId: row.checkerId, matcherId: row.matcherId }]));
    if (!draft[key]) return;
    draft[key][field] = value;
    evaluationPlanningDrafts.set(evaluationPlanningDraftKey(exam), draft);
    renderEvaluationPlanning();
}
function evaluationPlanningReviewed(exam, rows) {
    return !!exam.evaluationPlan?.reviewedAt && exam.evaluationPlan.reviewedSignature === EvaluationPlanning.signature(rows);
}
function evaluationPlanningTable(rows, editable = false, reviewed = false) {
    const headers = ['SN.', 'Subject', 'Class / Section', 'Date of exam', 'Evaluator', 'Re-totalling / Cross-checker', 'Samagam mark-slip matching / Core team member', 'Review by Principal'];
    const faculty = editable ? evaluationPlanningFaculty() : [];
    const dropdown = (row, field, label) => `<select aria-label="${escapeHtml(`${label}: ${row.subject}, Class ${row.cls}-${row.section}, ${row.date}`)}" data-planning-key="${escapeHtml(row.key)}" data-planning-field="${field}" onchange="updateEvaluationPlanningAssignment(this.dataset.planningKey,this.dataset.planningField,this.value)" class="w-full min-w-[180px] rounded border p-2" ${evaluationPlanningCanEdit() ? '' : 'disabled'}><option value="">Select teacher…</option>${row[field] && !faculty.some(t => t.id === row[field]) ? `<option value="${escapeHtml(row[field])}" selected>Unavailable teacher — reassign</option>` : ''}${faculty.map(t => `<option value="${escapeHtml(t.id)}" ${row[field] === t.id ? 'selected' : ''}>${escapeHtml(t.name)} · ${escapeHtml(t.desig)}${t.primary ? ' · Primary' : ''}</option>`).join('')}</select>`;
    return `<div class="overflow-x-auto rounded border"><table class="w-full min-w-[1250px] text-xs"><thead class="bg-indigo-950 text-white"><tr>${headers.map(h => `<th class="p-3 text-left">${h}</th>`).join('')}</tr></thead><tbody>${rows.map((row, index) => `<tr class="border-b"><td class="p-3">${index + 1}</td><td class="p-3 font-bold">${escapeHtml(row.subject)}</td><td class="p-3">Class ${escapeHtml(formatClass(row.cls))}-${escapeHtml(row.section)}</td><td class="p-3">${escapeHtml(formatOrderDate(row.date))}</td><td class="p-3">${escapeHtml(row.evaluator)}</td><td class="p-3">${editable ? dropdown(row, 'checkerId', 'Cross-checker') : escapeHtml(row.checker || 'Not assigned')}</td><td class="p-3">${editable ? dropdown(row, 'matcherId', 'Samagam matching') : escapeHtml(row.matcher || 'Not assigned')}</td><td class="p-3">${reviewed ? 'Reviewed by Principal' : 'Pending Principal review'}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderEvaluationPlanning() {
    const mount = document.getElementById('sec-evaluation-planning');
    if (!mount) return;
    if (!evaluationPlanningExam()) evaluationPlanningExamId = String(archivedExams[0]?.id || '');
    const exam = evaluationPlanningExam(), rows = exam ? evaluationPlanningRows(exam) : [], faculty = evaluationPlanningFaculty();
    const draft = exam && evaluationPlanningDrafts.has(evaluationPlanningDraftKey(exam));
    const reviewed = exam && !draft && evaluationPlanningReviewed(exam, rows);
    const published = exam && String(publicPortalBoards.evaluationPlanning?.examId) === String(exam.id);
    const disabled = evaluationPlanningCanEdit() ? '' : 'disabled';
    mount.innerHTML = `<h2 class="text-xl font-bold text-indigo-950">6. Evaluation &amp; Checking Plan</h2><p class="text-sm text-slate-600">Subject, class / section, exam date and evaluator come from the saved Date Sheet and Faculty Manager. Assign the two checking duties, save, then publish the plan to Public View.</p><label class="block text-sm font-bold">Examination<select id="evaluation-planning-exam" onchange="selectEvaluationPlanningExam(this.value)" class="ml-2 rounded border p-2">${archivedExams.map(item => `<option value="${escapeHtml(String(item.id))}" ${String(item.id) === evaluationPlanningExamId ? 'selected' : ''}>${escapeHtml(item.title)}</option>`).join('')}</select></label><p class="rounded bg-sky-50 p-3 text-xs">${faculty.filter(t => t.primary).length ? `${faculty.filter(t => t.primary).length} Primary faculty available, including entries from the portal’s Primary timetable where not yet in Faculty Manager.` : 'Primary teacher list is not available in this portal. Add Primary faculty in Faculty Manager to include them here.'}</p><p id="evaluation-planning-status" role="status" class="text-sm font-bold">${evaluationPlanningBusy ? 'Saving…' : draft ? 'Unsaved assignments — Save Plan to confirm.' : reviewed ? 'Reviewed by Principal.' : 'Pending Principal review.'}${published ? ' A published snapshot is visible in Public View; Publish / Update replaces it with the saved plan.' : ''}</p>${rows.length ? evaluationPlanningTable(rows, true, reviewed) : '<p class="rounded border border-dashed p-6 text-center">No saved date sheet is available for this examination. Save it in Create Exam &amp; Lifecycle Hub first.</p>'}<div class="flex flex-wrap gap-2"><button onclick="saveEvaluationPlanning()" class="rounded bg-indigo-700 px-4 py-2 font-bold text-white" ${disabled} ${rows.length ? '' : 'disabled'}>Save Plan</button><button onclick="reviewEvaluationPlanning()" class="rounded bg-violet-700 px-4 py-2 font-bold text-white" ${disabled} ${draft || !rows.length ? 'disabled' : ''}>Mark Reviewed by Principal</button><button onclick="publishEvaluationPlanning()" class="rounded bg-emerald-700 px-4 py-2 font-bold text-white" ${disabled} ${draft || !rows.length ? 'disabled' : ''}>${published ? 'Publish / Update Plan' : 'Publish Plan'}</button>${published ? `<button onclick="stopEvaluationPlanningPublication()" class="rounded bg-red-700 px-4 py-2 font-bold text-white" ${disabled}>Stop Publishing</button>` : ''}</div>`;
    applyExamIcMasterReadOnlyUi();
}
async function saveEvaluationPlanning(markReviewed = false) {
    if (!evaluationPlanningCanEdit()) return false;
    const exam = evaluationPlanningExam(); if (!exam) return false;
    const rows = evaluationPlanningRows(exam), before = cloneData(exam.evaluationPlan || null);
    const assignments = { ...(exam.evaluationPlan?.assignments || {}) };
    rows.forEach(row => { assignments[row.key] = { checkerId: row.checkerId, matcherId: row.matcherId }; });
    const sameReview = evaluationPlanningReviewed(exam, rows);
    exam.evaluationPlan = { assignments, savedAt: new Date().toISOString(), reviewedAt: markReviewed ? new Date().toISOString() : sameReview ? exam.evaluationPlan.reviewedAt : '', reviewedSignature: markReviewed ? EvaluationPlanning.signature(rows) : sameReview ? exam.evaluationPlan.reviewedSignature : '' };
    evaluationPlanningBusy = true; renderEvaluationPlanning();
    let ok = false;
    try { ok = await saveData(['archivedExams']); } finally {
        evaluationPlanningBusy = false;
        if (ok) evaluationPlanningDrafts.delete(evaluationPlanningDraftKey(exam));
        else { const current = archivedExams.find(item => String(item.id) === String(exam.id)); if (current) { if (before) current.evaluationPlan = before; else delete current.evaluationPlan; } }
        renderEvaluationPlanning();
    }
    if (!ok) alert('Plan was not saved. Your assignments remain available to retry.');
    return ok;
}
async function reviewEvaluationPlanning() {
    if (!evaluationPlanningCanEdit()) return;
    const exam = evaluationPlanningExam(); if (!exam || evaluationPlanningDrafts.has(evaluationPlanningDraftKey(exam))) return;
    const rows = evaluationPlanningRows(exam, false);
    if (!rows.length || rows.some(row => !row.checker || !row.matcher || row.evaluator === 'Not mapped')) { alert('Assign both checking duties and map every evaluator before Principal review.'); return; }
    await saveEvaluationPlanning(true);
}
async function publishEvaluationPlanning() {
    if (!evaluationPlanningCanEdit()) return;
    const exam = evaluationPlanningExam(); if (!exam || evaluationPlanningDrafts.has(evaluationPlanningDraftKey(exam))) return;
    const rows = evaluationPlanningRows(exam, false);
    if (!rows.length || rows.some(row => !row.checker || !row.matcher || row.evaluator === 'Not mapped')) { alert('Assign both checking duties and map every evaluator before publishing.'); return; }
    const board = { examId: exam.id, examTitle: exam.title, rows: rows.map(({ key, date, subject, cls, section, evaluator, checkerId, matcherId, checker, matcher }) => ({ key, date, subject, cls, section, evaluator, checkerId, matcherId, checker, matcher })), reviewed: evaluationPlanningReviewed(exam, rows), publishedAt: new Date().toISOString() };
    await persistEvaluationPlanningPublication(board);
}
async function stopEvaluationPlanningPublication() {
    if (!evaluationPlanningCanEdit()) return;
    await persistEvaluationPlanningPublication(null);
}
async function persistEvaluationPlanningPublication(board) {
    const before = publicPortalBoards.evaluationPlanning;
    if (board) publicPortalBoards = { ...publicPortalBoards, evaluationPlanning: board };
    else { publicPortalBoards = { ...publicPortalBoards }; delete publicPortalBoards.evaluationPlanning; }
    evaluationPlanningBusy = true; renderEvaluationPlanning();
    let ok = false;
    try { ok = await saveData(['publicPortalBoards']); } finally {
        evaluationPlanningBusy = false;
        if (!ok) { if (before) publicPortalBoards.evaluationPlanning = before; else delete publicPortalBoards.evaluationPlanning; }
        renderEvaluationPlanning(); renderPublicPortalBoards();
    }
    if (!ok) alert('Publication change was not saved. Check the connection and retry.');
}
function renderPublicEvaluationPlanning(boards) {
    const host = document.querySelector('#area-public-display > div'); if (!host) return;
    let mount = document.getElementById('public-evaluation-planning-section');
    if (!mount) { mount = document.createElement('section'); mount.id = 'public-evaluation-planning-section'; mount.className = 'hidden rounded-xl border bg-white p-4 space-y-3'; host.appendChild(mount); }
    const board = boards.evaluationPlanning, rows = publicRecordRows(board?.rows);
    mount.classList.toggle('hidden', !rows.length);
    mount.innerHTML = rows.length ? `<h3 class="font-bold text-indigo-950">Evaluation &amp; Checking Plan</h3><p class="text-sm">${escapeHtml(board.examTitle)} · Published ${escapeHtml(new Date(board.publishedAt).toLocaleString('en-IN'))}</p>${evaluationPlanningTable(rows, false, board.reviewed === true)}` : '';
}
