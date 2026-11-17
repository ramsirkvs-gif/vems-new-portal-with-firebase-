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
    function pdfStreams(board) {
        const ascii = value => String(value ?? '').normalize('NFKD').replace(/[^\x20-\x7E]/g, '-');
        const escaped = value => ascii(value).replace(/([\\()])/g, '\\$1');
        const text = (value, x, y, size = 7) => `BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escaped(value)}) Tj ET\n`;
        const widths = [26, 85, 65, 66, 130, 130, 160, 116];
        const wrap = (value, width) => {
            const limit = Math.max(4, Math.floor((width - 10) / 4)), lines = [];
            let remaining = ascii(value).trim() || '-';
            while (remaining.length > limit) {
                const space = remaining.lastIndexOf(' ', limit), end = space > 0 ? space : limit;
                lines.push(remaining.slice(0, end)); remaining = remaining.slice(end).trim();
            }
            lines.push(remaining); return lines;
        };
        const headers = ['SN.', 'Subject', 'Class / Section', 'Date of exam', 'Evaluator', 'Re-totalling / Cross-checker', 'Samagam mark-slip matching / Core team member', 'Review by Principal'];
        const pages = []; let stream = '', y = 0;
        function cells(values, top, height) {
            let result = '', x = 28;
            values.forEach((lines, i) => {
                result += `0.7 0.7 0.7 RG 0.4 w ${x} ${top - height} ${widths[i]} ${height} re S\n`;
                lines.forEach((line, j) => { result += text(line, x + 4, top - 12 - j * 10); });
                x += widths[i];
            });
            return result;
        }
        function newPage() {
            if (stream) pages.push(stream);
            stream = text('PM SHRI KENDRIYA VIDYALAYA NO. 1, ITANAGAR', 28, 567, 12)
                + text('PRE-SAMAGAM EVALUATION & CHECKING PLAN', 28, 547, 11);
            const titleLines = wrap(board.examTitle || 'Examination', 770);
            titleLines.forEach((line, i) => { stream += text(line, 28, 529 - i * 10, 8); });
            stream += text(`Published: ${board.publishedAt || '-'} | Page ${pages.length + 1}`, 28, 514 - (titleLines.length - 1) * 10, 7);
            y = 500 - (titleLines.length - 1) * 10;
            const head = headers.map((value, i) => wrap(value, widths[i])), height = Math.max(...head.map(lines => lines.length)) * 10 + 10;
            stream += cells(head, y, height); y -= height;
        }
        newPage();
        (board.rows || []).forEach((row, index) => {
            const values = [index + 1, row.subject, `Class ${row.cls}-${row.section}`, row.date, row.evaluator, row.checker, row.matcher, board.reviewed ? 'Reviewed by Principal' : 'Pending Principal review'];
            const lines = values.map((value, i) => wrap(value, widths[i]));
            let offset = 0, total = Math.max(...lines.map(value => value.length));
            while (offset < total) {
                if (y < 60) newPage();
                const count = Math.min(total - offset, Math.floor((y - 35) / 10) - 1), height = count * 10 + 10;
                stream += cells(lines.map(value => value.slice(offset, offset + count)), y, height);
                y -= height; offset += count;
                if (offset < total) newPage();
            }
        });
        pages.push(stream); return pages;
    }
    function coreFaculty(faculty, team) {
        const ids = new Set(Object.values(team || {}).filter(member => member?.teacherId).map(member => String(member.teacherId)));
        return faculty.filter(teacher => ids.has(teacher.id));
    }
    return { key, faculty, coreFaculty, rows, signature, pdfStreams };
})();
if (typeof module !== 'undefined') module.exports = EvaluationPlanning;

let evaluationPlanningExamId = '';
let evaluationPlanningBusy = false;
const evaluationPlanningDrafts = new Map();
function resetEvaluationPlanningMount() {
    const panel = document.getElementById('sec-evaluation-planning');
    const master = document.getElementById('evaluation-planning-master-mount');
    if (panel && master && panel.parentElement !== master) master.appendChild(panel);
    for (const wing of ['sec', 'pri']) {
        document.getElementById(`evaluation-planning-ic-${wing}`)?.classList.add('hidden');
        document.getElementById(`exam-creator-mount-${wing}`)?.classList.remove('hidden');
    }
}
function openEvaluationPlanningIc() {
    if (!['sec-ic', 'pri-ic'].includes(authorizedRole)) return;
    switchPortalArea(authorizedRole);
    currentActiveTab = 'evaluation-planning';
    const wing = authorizedRole === 'pri-ic' ? 'pri' : 'sec';
    const host = document.getElementById(`evaluation-planning-ic-${wing}`);
    const panel = document.getElementById('sec-evaluation-planning');
    if (!host || !panel) return;
    host.appendChild(panel); host.classList.remove('hidden'); panel.classList.remove('hidden');
    document.getElementById(`exam-creator-mount-${wing}`)?.classList.add('hidden');
    renderEvaluationPlanning();
}
function closeEvaluationPlanningIc() {
    if (!['sec-ic', 'pri-ic'].includes(authorizedRole)) return;
    resetEvaluationPlanningMount();
    switchPortalArea(authorizedRole);
}
function evaluationPlanningDraftKey(exam) { return `${selectedAcademicSession}:${exam.id}`; }
function evaluationPlanningFaculty() {
    return EvaluationPlanning.faculty(teachers, typeof VEMSTeacherTimetable === 'undefined' ? [] : VEMSTeacherTimetable.teachers);
}
function evaluationPlanningCoreFaculty() {
    return EvaluationPlanning.coreFaculty(evaluationPlanningFaculty(), examCoreTeam);
}
function evaluationPlanningExam() {
    return archivedExams.find(exam => String(exam.id) === evaluationPlanningExamId);
}
function evaluationPlanningRows(exam, useDraft = true) {
    const faculty = evaluationPlanningFaculty(), draft = useDraft ? evaluationPlanningDrafts.get(evaluationPlanningDraftKey(exam)) : null;
    return EvaluationPlanning.rows(exam, examDatesheetRows(exam), getAllSectionsForClass, mappedEvaluatorForExamRow).map(row => {
        const assignment = draft?.[row.key] || row.assignment;
        const checker = faculty.find(t => t.id === assignment.checkerId), matcher = evaluationPlanningCoreFaculty().find(t => t.id === assignment.matcherId);
        return { ...row, checkerId: assignment.checkerId || '', matcherId: assignment.matcherId || '', checker: checker?.name || '', matcher: matcher?.name || '' };
    });
}
function evaluationPlanningCanEdit() {
    return ['principal', 'sec-ic', 'pri-ic'].includes(authorizedRole) && !isSelectedSessionFrozen() && !evaluationPlanningBusy;
}
function selectEvaluationPlanningExam(value) { evaluationPlanningExamId = value; renderEvaluationPlanning(); }
function updateEvaluationPlanningAssignment(key, field, value) {
    if (!evaluationPlanningCanEdit() || !['checkerId', 'matcherId'].includes(field)) return;
    if (value && field === 'matcherId' && !evaluationPlanningCoreFaculty().some(member => member.id === value)) return;
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
function evaluationPlanningTable(rows, editable = false, reviewed = false, compact = false) {
    const headers = ['SN.', 'Subject', 'Class / Section', 'Date of exam', 'Evaluator', 'Re-totalling / Cross-checker', 'Samagam mark-slip matching / Core team member', 'Review by Principal'];
    const faculty = editable ? evaluationPlanningFaculty() : [];
    const dropdown = (row, field, label) => {
        const matching = field === 'matcherId', options = matching ? evaluationPlanningCoreFaculty() : faculty;
        const option = t => `<option value="${escapeHtml(t.id)}" ${row[field] === t.id ? 'selected' : ''}>${escapeHtml(t.name)} · ${escapeHtml(t.desig)}${t.primary ? ' · Primary' : ''}</option>`;
        const choices = matching ? options.map(option).join('') : [false, true].map(primary => `<optgroup label="${primary ? 'Primary wing' : 'Portal faculty'}">${options.filter(t => t.primary === primary).map(option).join('')}</optgroup>`).join('');
        return `<select aria-label="${escapeHtml(`${label}: ${row.subject}, Class ${row.cls}-${row.section}, ${row.date}`)}" data-planning-key="${escapeHtml(row.key)}" data-planning-field="${field}" onchange="updateEvaluationPlanningAssignment(this.dataset.planningKey,this.dataset.planningField,this.value)" class="w-full min-w-[180px] rounded border p-2" ${evaluationPlanningCanEdit() && (!matching || options.length) ? '' : 'disabled'}><option value="">${matching ? options.length ? 'Select core team member…' : 'No core team members available' : 'Select teacher…'}</option>${row[field] && !options.some(t => t.id === row[field]) ? `<option value="${escapeHtml(row[field])}" selected disabled>${matching ? 'Not in core team — reassign' : 'Unavailable teacher — reassign'}</option>` : ''}${choices}</select>`;
    };
    return `<div ${compact ? 'id="public-evaluation-planning-scroll" role="region" aria-label="Published evaluation and checking plan" tabindex="0" style="max-height:256px;overflow:auto;overscroll-behavior:contain"' : ''} class="overflow-x-auto rounded border"><table class="w-full min-w-[1250px] text-xs"><thead ${compact ? 'style="position:sticky;top:0;z-index:1;background:#1e1b4b"' : ''} class="bg-indigo-950 text-white"><tr>${headers.map(h => `<th class="p-3 text-left">${h}</th>`).join('')}</tr></thead><tbody>${rows.map((row, index) => `<tr class="border-b"><td class="p-3">${index + 1}</td><td class="p-3 font-bold">${escapeHtml(row.subject)}</td><td class="p-3">Class ${escapeHtml(formatClass(row.cls))}-${escapeHtml(row.section)}</td><td class="p-3">${escapeHtml(formatOrderDate(row.date))}</td><td class="p-3">${escapeHtml(row.evaluator)}</td><td class="p-3">${editable ? dropdown(row, 'checkerId', 'Cross-checker') : escapeHtml(row.checker || 'Not assigned')}</td><td class="p-3">${editable ? dropdown(row, 'matcherId', 'Samagam matching') : escapeHtml(row.matcher || 'Not assigned')}</td><td class="p-3">${reviewed ? 'Reviewed by Principal' : 'Pending Principal review'}</td></tr>`).join('')}</tbody></table></div>`;
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
    mount.innerHTML = `<h2 class="text-xl font-bold text-indigo-950">6. Pre-Samagam Evaluation &amp; Checking Plan</h2><p class="text-sm text-slate-600">Subject, class / section, exam date and evaluator come from the saved Date Sheet and Faculty Manager. Assign the two checking duties, save, then publish the plan to Public View. Samagam mark-slip matching is restricted to the saved Core Examination Team.</p><label class="block text-sm font-bold">Examination<select id="evaluation-planning-exam" onchange="selectEvaluationPlanningExam(this.value)" class="ml-2 rounded border p-2">${archivedExams.map(item => `<option value="${escapeHtml(String(item.id))}" ${String(item.id) === evaluationPlanningExamId ? 'selected' : ''}>${escapeHtml(item.title)}</option>`).join('')}</select></label><p class="rounded bg-sky-50 p-3 text-xs">${faculty.filter(t => t.primary).length ? `${faculty.filter(t => t.primary).length} Primary faculty available, including entries from the portal’s Primary timetable where not yet in Faculty Manager.` : 'Primary teacher list is not available in this portal. Add Primary faculty in Faculty Manager to include them here.'}</p>${evaluationPlanningCoreFaculty().length ? '' : '<p class="rounded bg-amber-50 p-3 text-sm">No available core team members are saved. Add members under Faculty Manager → Core Examination Team to enable Samagam matching.</p>'}<p id="evaluation-planning-status" role="status" class="text-sm font-bold">${evaluationPlanningBusy ? 'Saving…' : draft ? 'Unsaved assignments — Save Plan to confirm.' : reviewed ? 'Reviewed by Principal.' : 'Pending Principal review.'}${published ? ' A published snapshot is visible in Public View; Publish / Update replaces it with the saved plan.' : ''}</p>${rows.length ? evaluationPlanningTable(rows, true, reviewed) : '<p class="rounded border border-dashed p-6 text-center">No saved date sheet is available for this examination. Save it in Create Exam &amp; Lifecycle Hub first.</p>'}<div class="flex flex-wrap gap-2"><button onclick="previewEvaluationPlanningPdf(true)" class="rounded bg-indigo-700 px-4 py-2 font-bold text-white" ${draft || !rows.length ? 'disabled' : ''}>PDF / Print Saved Plan</button><button onclick="shareEvaluationPlanningPdf(true)" class="rounded bg-emerald-700 px-4 py-2 font-bold text-white" ${draft || !rows.length ? 'disabled' : ''}>Share PDF to WhatsApp</button><button onclick="saveEvaluationPlanning()" class="rounded bg-indigo-700 px-4 py-2 font-bold text-white" ${disabled} ${rows.length ? '' : 'disabled'}>Save Plan</button><button onclick="reviewEvaluationPlanning()" class="rounded bg-violet-700 px-4 py-2 font-bold text-white" ${disabled} ${authorizedRole !== 'principal' || draft || !rows.length ? 'disabled' : ''}>Mark Reviewed by Principal</button><button onclick="publishEvaluationPlanning()" class="rounded bg-emerald-700 px-4 py-2 font-bold text-white" ${disabled} ${draft || !rows.length ? 'disabled' : ''}>${published ? 'Publish / Update Plan' : 'Publish Plan'}</button>${published ? `<button onclick="stopEvaluationPlanningPublication()" class="rounded bg-red-700 px-4 py-2 font-bold text-white" ${disabled}>Stop Publishing</button>` : ''}</div>`;
    applyExamIcMasterReadOnlyUi();
}
async function saveEvaluationPlanning(markReviewed = false) {
    if (!evaluationPlanningCanEdit() || (markReviewed && authorizedRole !== 'principal')) return false;
    const exam = evaluationPlanningExam(); if (!exam) return false;
    const rows = evaluationPlanningRows(exam), before = cloneData(exam.evaluationPlan || null);
    const assignments = { ...(exam.evaluationPlan?.assignments || {}) };
    rows.forEach(row => { assignments[row.key] = { checkerId: row.checkerId, matcherId: row.matcherId }; });
    const sameReview = evaluationPlanningReviewed(exam, rows);
    exam.evaluationPlan = { assignments, savedAt: new Date().toISOString(), reviewedAt: markReviewed ? new Date().toISOString() : sameReview ? exam.evaluationPlan.reviewedAt : '', reviewedSignature: markReviewed ? EvaluationPlanning.signature(rows) : sameReview ? exam.evaluationPlan.reviewedSignature : '' };
    evaluationPlanningBusy = true; renderEvaluationPlanning();
    let ok = false;
    try { ok = await saveData(['archivedExams'], {}, { evaluationPlanning: true }); } finally {
        evaluationPlanningBusy = false;
        if (ok) evaluationPlanningDrafts.delete(evaluationPlanningDraftKey(exam));
        else { const current = archivedExams.find(item => String(item.id) === String(exam.id)); if (current) { if (before) current.evaluationPlan = before; else delete current.evaluationPlan; } }
        renderEvaluationPlanning();
    }
    if (!ok) alert('Plan was not saved. Your assignments remain available to retry.');
    return ok;
}
async function reviewEvaluationPlanning() {
    if (authorizedRole !== 'principal' || !evaluationPlanningCanEdit()) return;
    const exam = evaluationPlanningExam(); if (!exam || evaluationPlanningDrafts.has(evaluationPlanningDraftKey(exam))) return;
    const rows = evaluationPlanningRows(exam, false);
    if (!rows.length || rows.some(row => !row.checker || !row.matcher || row.evaluator === 'Not mapped')) { alert('Assign a cross-checker and a current core team member for Samagam matching, and map every evaluator before Principal review.'); return; }
    await saveEvaluationPlanning(true);
}
async function publishEvaluationPlanning() {
    if (!evaluationPlanningCanEdit()) return;
    const exam = evaluationPlanningExam(); if (!exam || evaluationPlanningDrafts.has(evaluationPlanningDraftKey(exam))) return;
    const rows = evaluationPlanningRows(exam, false);
    if (!rows.length || rows.some(row => !row.checker || !row.matcher || row.evaluator === 'Not mapped')) { alert('Assign a cross-checker and a current core team member for Samagam matching, and map every evaluator before publishing.'); return; }
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
    try { ok = await saveData(['publicPortalBoards'], {}, { evaluationPlanning: true }); } finally {
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
    mount.innerHTML = rows.length ? `<h3 class="font-bold text-indigo-950">Pre-Samagam Evaluation &amp; Checking Plan</h3><div class="flex flex-wrap gap-2"><button onclick="previewEvaluationPlanningPdf()" class="public-export-button rounded bg-indigo-700 px-4 py-2 font-bold text-white">PDF / Print Plan</button><button onclick="shareEvaluationPlanningPdf()" class="public-export-button rounded bg-emerald-700 px-4 py-2 font-bold text-white">Share PDF to WhatsApp</button></div><p class="text-sm">${escapeHtml(board.examTitle)} · Published ${escapeHtml(new Date(board.publishedAt).toLocaleString('en-IN'))}</p>${evaluationPlanningTable(rows, false, board.reviewed === true, true)}` : '';
}
function evaluationPlanningPdfBlob(staff = false) {
    let board;
    if (staff) {
        if (!['principal', 'sec-ic', 'pri-ic'].includes(authorizedRole)) return null;
        const exam = evaluationPlanningExam();
        if (!exam || evaluationPlanningDrafts.has(evaluationPlanningDraftKey(exam))) return null;
        const rows = evaluationPlanningRows(exam, false);
        board = { examTitle: exam.title, publishedAt: exam.evaluationPlan?.savedAt || '', rows, reviewed: evaluationPlanningReviewed(exam, rows) };
    } else {
        const published = visiblePortalBoards().evaluationPlanning;
        if (published) board = { ...published, rows: publicRecordRows(published.rows) };
    }
    if (!board?.rows?.length) return null;
    return createPdfFromStreams(EvaluationPlanning.pdfStreams(board), '0 0 842 595');
}
function previewEvaluationPlanningPdf(staff = false) {
    const blob = evaluationPlanningPdfBlob(staff);
    if (!blob) { alert(staff ? 'Save the plan before exporting.' : 'No Pre-Samagam plan is published.'); return; }
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function shareEvaluationPlanningPdf(staff = false) {
    const blob = evaluationPlanningPdfBlob(staff);
    if (!blob) { alert(staff ? 'Save the plan before exporting.' : 'No Pre-Samagam plan is published.'); return; }
    await sharePdfFile(blob, 'Pre-Samagam-Evaluation-Checking-Plan.pdf', 'Pre-Samagam Evaluation & Checking Plan');
}
