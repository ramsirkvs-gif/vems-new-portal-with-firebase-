/* Firebase Authentication, live UI updates, and migration from the older local-only app. */
'use strict';
const sharedNames = ['students', 'sectionConfigs', 'teachers', 'classTeacherAssignments', 'archivedExams',
    'examOptionsList', 'qpSubmissionsTracker', 'qpPrintingTracker', 'qpSubmissionDeadlines', 'qpOfficeOrders', 'qpOfficeOrderSettings'];
const principalCollections = ['students', 'sectionConfigs', 'teachers', 'classTeacherAssignments', 'examOptionsList'];
// Login identifiers only. Firebase stores and verifies each role's passcode.
// Dedicated portal accounts are independent of the administrator’s personal account.
const roleAccounts = Object.freeze({
    principal: 'principal@vems-portal.example',
    'sec-ic': 'secondary@vems-portal.example',
    'pri-ic': 'primary@vems-portal.example'
});
let studentRecords = {};
let sharedStore = null;
let authorizedRole = null;
let roleSubscription = null;
let pendingLoginRole = null;
let renderTimer = null;
let authGeneration = 0;
let sharedError = '';
let loadingStaffData = false;
let lastConfirmedSave = '';
let sectionFormDirty = false;
let assignmentRenderBaseline = {};
const editorBaselines = { teacher: null, student: null, section: null, assignments: null, exam: null };

function newRecordId() {
    // Numeric IDs preserve compatibility with the existing inline handlers.
    return Date.now() * 1000 + crypto.getRandomValues(new Uint32Array(1))[0] % 1000;
}
function cloneData(value) { return JSON.parse(JSON.stringify(value)); }
function readLegacy(key, fallback = null) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
}
function showSyncError(message) {
    sharedError = message;
    const element = document.getElementById('sync-error');
    element.textContent = message;
    element.classList.toggle('hidden', !message);
}
function showSyncStatus(state) {
    const element = document.getElementById('sync-status');
    let text = 'Choose your staff role and enter its passcode to load shared data.';
    let good = false;
    if (loadingStaffData) text = 'Signing in and loading shared records…';
    if (authorizedRole && state) {
        if (state.error) text = 'Firebase access failed. Check your account role and database rules.';
        else if (!state.connected) text = state.pending
            ? 'Connection lost — a save is awaiting confirmation. Keep this page open and reconnect.'
            : 'Offline — displayed records may be out of date. Reconnect before editing.';
        else if (!state.ready) text = 'Connected — loading shared records…';
        else if (state.pending) text = `Saving to Firebase… (${state.pending} pending)`;
        else { text = `Live sync connected${lastConfirmedSave ? ' · Last save confirmed at ' + lastConfirmedSave : ''}`; good = true; }
    }
    element.textContent = text;
    element.className = `no-print px-6 py-3 text-sm ${good ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`;
    if (state?.error) showSyncError(state.error);
}
function canEditSharedData(required = 'exam') {
    const allowed = authorizedRole === 'principal' || (required === 'exam' && ['sec-ic', 'pri-ic'].includes(authorizedRole));
    if (!allowed) { showSyncError('Your staff role cannot make this change. Sign in with the appropriate account.'); return false; }
    try { sharedStore.assertWritable(); return true; }
    catch (error) { showSyncError(error.message); return false; }
}
function sharedValue(name) {
    return ({ students: studentRecords, sectionConfigs, teachers, classTeacherAssignments, archivedExams,
        examOptionsList, qpSubmissionsTracker, qpPrintingTracker, qpSubmissionDeadlines, qpOfficeOrders, qpOfficeOrderSettings })[name];
}
function acceptSharedValue(name, value) {
    switch (name) {
        case 'students':
            studentRecords = value;
            students = Object.values(value).flatMap(sections => Object.values(sections || {})
                .flatMap(records => Object.values(records || {}))).filter(Boolean);
            break;
        case 'sectionConfigs': sectionConfigs = value; break;
        case 'teachers': teachers = Object.values(value); break;
        case 'classTeacherAssignments': classTeacherAssignments = value; break;
        case 'archivedExams':
            archivedExams = Object.values(value);
            if (activeExamId !== null) {
                const exam = archivedExams.find(record => record.id === activeExamId);
                if (exam) {
                    mainHeaderConfig = cloneData(exam.headerSnapshot || { name: exam.title, fromDate: exam.fromDate, toDate: exam.toDate });
                    datesheetDays = cloneData(exam.datesheetSnapshot || []);
                } else if (!sharedStore?.pendingCount) {
                    activeExamId = null;
                    isExamConfigOpen = false;
                    datesheetDays = [];
                }
            }
            break;
        case 'examOptionsList': examOptionsList = Object.keys(value).length ? Object.values(value) : defaultExamOptionsList; break;
        case 'qpSubmissionsTracker': qpSubmissionsTracker = value; break;
        case 'qpPrintingTracker': qpPrintingTracker = value; break;
        case 'qpSubmissionDeadlines': qpSubmissionDeadlines = value; break;
        case 'qpOfficeOrders': qpOfficeOrders = value; break;
        case 'qpOfficeOrderSettings': qpOfficeOrderSettings = value; break;
    }
    scheduleSharedRender();
}
async function saveData(names, expected = {}) {
    if (!Array.isArray(names) || !names.length) throw new Error('Choose the records to save.');
    const required = names.some(name => principalCollections.includes(name)) ? 'principal' : 'exam';
    if (!canEditSharedData(required)) { restoreSharedValues(names); return false; }
    const store = sharedStore;
    try {
        // Capture each desired value before listener callbacks refresh the UI.
        const desired = names.map(name => [name, cloneData(sharedValue(name))]);
        if (names.includes('archivedExams') && editorBaselines.exam) {
            expected.archivedExams = [editorBaselines.exam];
        }
        await Promise.all(desired.map(([name, value]) => store.save(name, value, expected[name] || [])));
        if (store !== sharedStore || !store.active) return false;
        lastConfirmedSave = new Date().toLocaleTimeString();
        showSyncError('');
        store.status();
        if (names.includes('archivedExams')) editorBaselines.exam = null;
        return true;
    } catch (error) {
        if (store === sharedStore) {
            restoreSharedValues(names);
            showSyncError(`Not saved: ${error.message}`);
        }
        return false;
    }
}
function restoreSharedValues(names) {
    if (sharedStore) names.forEach(name => {
        if (sharedStore.loaded.has(name)) acceptSharedValue(name, sharedStore.view(name));
    });
}
function scheduleSharedRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(refreshSharedViews, 50);
}
function refreshSharedViews() {
    // Do not replace an input while somebody is typing. Refresh after they leave it.
    if (document.activeElement?.matches('input, select, textarea')) return;
    renderMasterSubjectDirectory();
    if (currentActiveTab === 'config' && !sectionFormDirty) initCfgSections();
    updateStudentTableHeaders();
    filterStudents();
    renderTeachers();
    if (!editorBaselines.assignments) renderClassTeacherCoordinationTable();
    if (!qpOfficeOrderFormDirty) renderExamCreatorModule();
    populateLegacyExamOptions();
}
document.addEventListener('focusout', scheduleSharedRender);
document.addEventListener('input', event => {
    if (event.target.matches('.cfg-sub-input')) sectionFormDirty = true;
    if (event.target.closest('#qp-instructions-list') || event.target.id?.startsWith('qp-order-')) captureQpOfficeOrderDraft();
});
document.addEventListener('focusin', event => {
    if (activeExamId !== null && event.target.closest('#exam-creator-mount-prin, #exam-creator-mount-sec, #exam-creator-mount-pri')
        && event.target.matches('input,select,textarea') && !editorBaselines.exam) {
        const record = sharedStore?.view('archivedExams')[String(activeExamId)];
        if (record) editorBaselines.exam = { path: [String(activeExamId)], value: cloneData(record) };
    }
});
document.addEventListener('change', event => {
    if (event.target.closest('#qp-instructions-list') || event.target.id?.startsWith('qp-order-')) captureQpOfficeOrderDraft();
    if (event.target.id?.match(/^(ct|coct|onduty)-/) && !editorBaselines.assignments) {
        editorBaselines.assignments = cloneData(assignmentRenderBaseline);
    }
}, true);
function rememberActiveExam() {
    sessionStorage.setItem('vems_open_exam', String(activeExamId));
}
function qpRecordKey(examId, cls, subject) {
    return [examId, cls, subject].map(value => encodeURIComponent(String(value)).replace(/[.']/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase())).join('|');
}
async function saveSubmissionDeadline(value) {
    if (!selectedPreExamVaultId) return;
    qpSubmissionDeadlines[String(selectedPreExamVaultId)] = value;
    if (await saveData(['qpSubmissionDeadlines'])) renderExamCreatorModule();
}

function switchPortalArea(area) {
    if (area === 'public' || authorizedRole === 'principal' || authorizedRole === area) {
        currentActiveRole = area;
        activateArea(area);
    } else openLoginModal(area);
}
function openLoginModal(role) {
    if (!Object.hasOwn(roleAccounts, role)) return;
    pendingLoginRole = role;
    document.getElementById('login-target-role').value = role;
    document.getElementById('login-modal-title').textContent = `${role === 'principal' ? 'Principal' : role === 'sec-ic' ? 'Secondary IC' : 'Primary IC'} Login`;
    document.getElementById('login-account-name').value = roleAccounts[role];
    document.getElementById('login-password').value = '';
    document.getElementById('login-error-msg').classList.add('hidden');
    document.getElementById('login-modal').classList.remove('hidden');
}
function closeLoginModal() { document.getElementById('login-modal').classList.add('hidden'); }
async function handleLogin(event) {
    event.preventDefault();
    const errorElement = document.getElementById('login-error-msg');
    const submit = event.target.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
        if (!db) throw new Error('Firebase scripts could not load. Check your connection.');
        if (sharedStore?.pendingCount) throw new Error('Wait for pending saves before changing accounts.');
        const role = document.getElementById('login-target-role').value;
        if (!Object.hasOwn(roleAccounts, role)) throw new Error('Choose a staff role before entering its passcode.');
        loadingStaffData = true;
        showSyncStatus();
        await firebase.auth().signInWithEmailAndPassword(roleAccounts[role], document.getElementById('login-password').value);
        document.getElementById('login-password').value = '';
        // Reauthenticating the same account need not trigger onAuthStateChanged again.
        if (authorizedRole && sharedStore && (authorizedRole === role || authorizedRole === 'principal')) {
            loadingStaffData = false;
            pendingLoginRole = null;
            currentActiveRole = role;
            closeLoginModal();
            activateArea(role);
            sharedStore.status();
        }
        // On an account change, the role listener verifies permissions before opening the workspace.
    } catch (error) {
        loadingStaffData = false;
        errorElement.textContent = error.code?.startsWith('auth/')
            ? (error.code === 'auth/network-request-failed' ? 'Unable to reach the sign-in service. Check your internet connection and try again.' : 'Passcode not accepted. Check the selected role and try again.')
            : error.message;
        errorElement.classList.remove('hidden');
        showSyncStatus();
    } finally { submit.disabled = false; }
}
async function logoutSession() {
    if (sharedStore?.pendingCount) { showSyncError('Wait for pending saves before signing out.'); return; }
    if (db) await firebase.auth().signOut();
}
function clearStaffState() {
    clearTimeout(renderTimer);
    sharedStore?.stop();
    sharedStore = null;
    if (roleSubscription) { roleSubscription.ref.off('value', roleSubscription.listener); roleSubscription = null; }
    authorizedRole = null;
    currentActiveRole = 'public';
    sharedNames.forEach(name => acceptSharedValue(name, {}));
    Object.keys(editorBaselines).forEach(key => { editorBaselines[key] = null; });
    activeExamId = null;
    selectedPreExamVaultId = null;
    isExamConfigOpen = false;
    isPreExamFullPageOpen = false;
    datesheetDays = [];
    sectionFormDirty = false;
    lastConfirmedSave = '';
    document.getElementById('student-form').reset();
    document.getElementById('student-modal').classList.add('hidden');
    resetTeacherForm();
    activateArea('public');
    showSyncStatus();
}

const legacyBindings = {
    sectionConfigs: 'vems_section_configs', teachers: 'vems_teachers',
    classTeacherAssignments: 'vems_ct_assignments', archivedExams: 'vems_archived_exams',
    examOptionsList: 'vems_exam_options', qpSubmissionsTracker: 'vems_qp_submissions_tracker',
    qpPrintingTracker: 'vems_qp_printing_tracker'
};
function legacyBackup() {
    const data = {};
    Object.entries(legacyBindings).forEach(([name, key]) => { const value = readLegacy(key); if (value) data[name] = value; });
    data.unsavedHeader = readLegacy('vems_header_config');
    data.unsavedDatesheet = readLegacy('vems_datesheet_draft');
    return data;
}
function downloadLegacyBackup() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(legacyBackup(), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `vems-old-browser-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function populateLegacyExamOptions() {
    const select = document.getElementById('legacy-exam-target');
    if (!select) return;
    const selected = select.value;
    select.replaceChildren(new Option('Select an exam before importing trackers', ''));
    archivedExams.forEach(exam => select.add(new Option(`${exam.title} (${exam.fromDate})`, String(exam.id))));
    select.value = selected;
}
async function importLegacyBrowserData() {
    if (!canEditSharedData('principal')) return;
    if (!confirm('Have you downloaded the old browser backup? Import will add missing cloud records and keep cloud values where records already exist.')) return;
    const legacy = legacyBackup();
    const target = document.getElementById('legacy-exam-target').value;
    const trackers = ['qpSubmissionsTracker', 'qpPrintingTracker'];
    if (trackers.some(name => Object.keys(legacy[name] || {}).length) && !target) {
        showSyncError('Select the exam that the old question-paper trackers belong to before importing.'); return;
    }
    const store = sharedStore;
    const status = document.getElementById('legacy-import-status');
    status.textContent = 'Importing missing records…';
    try {
        for (const name of Object.keys(legacyBindings)) {
            if (!legacy[name]) continue;
            let data = legacy[name];
            if (trackers.includes(name)) {
                data = Object.fromEntries(Object.entries(data).map(([key, value]) => {
                    const separator = key.indexOf('-');
                    if (separator < 0) throw new Error('An old tracker key is invalid. Keep the backup and review it before importing.');
                    return [qpRecordKey(target, key.slice(0, separator), key.slice(separator + 1)), value];
                }));
            }
            await store.importMissing(name, data);
        }
        // A draft that was never archived is retained as an explicit shared draft, once.
        if (legacy.unsavedDatesheet?.length && legacy.unsavedHeader) {
            const exists = Object.values(store.view('archivedExams')).some(exam => VemsSync.equal(exam.datesheetSnapshot, legacy.unsavedDatesheet)
                && VemsSync.equal(exam.headerSnapshot, legacy.unsavedHeader));
            if (!exists) {
                let id = localStorage.getItem('vems_legacy_draft_import_id');
                if (!id) { id = String(newRecordId()); localStorage.setItem('vems_legacy_draft_import_id', id); }
                const header = legacy.unsavedHeader;
                await store.importMissing('archivedExams', [{ id: Number(id), title: header.customName || header.name || 'Imported draft',
                    fromDate: header.fromDate || '', toDate: header.toDate || '', totalDays: legacy.unsavedDatesheet.length,
                    isDraft: true, status: 'DRAFT / IMPORTED', headerSnapshot: header, datesheetSnapshot: legacy.unsavedDatesheet }]);
            }
        }
        status.textContent = 'Import confirmed by Firebase. Existing cloud values were kept. The original browser data is still available.';
        showSyncError('');
    } catch (error) { status.textContent = `Import stopped: ${error.message}. Earlier successful collections remain saved; retrying is safe.`; }
}

function initializeSharedApp() {
    activateArea('public');
    if (!db) { showSyncError('Firebase could not load. Check access to www.gstatic.com and reload the page.'); showSyncStatus(); return; }
    firebase.auth().onAuthStateChanged(user => {
        const generation = ++authGeneration;
        clearStaffState();
        showSyncError('');
        if (!user) { loadingStaffData = false; showSyncStatus(); return; }
        loadingStaffData = true;
        showSyncStatus();
        const ref = db.ref(`roles/${user.uid}`);
        const listener = snapshot => {
            if (generation !== authGeneration) return;
            const role = snapshot.val();
            if (!['principal', 'sec-ic', 'pri-ic'].includes(role)) {
                sharedStore?.stop();
                sharedStore = null;
                authorizedRole = null;
                currentActiveRole = 'public';
                sharedNames.forEach(name => acceptSharedValue(name, {}));
                loadingStaffData = false;
                activateArea('public');
                showSyncStatus();
                showSyncError('This account has no staff role. Ask the administrator to add its UID under roles in Firebase.');
                return;
            }
            if (authorizedRole === role && sharedStore) return;
            sharedStore?.stop();
            authorizedRole = role;
            currentActiveRole = pendingLoginRole && (role === 'principal' || role === pendingLoginRole) ? pendingLoginRole : role;
            pendingLoginRole = null;
            loadingStaffData = false;
            showSyncError('');
            closeLoginModal();
            sharedStore = new VemsSync.Store(db, sharedNames, acceptSharedValue, showSyncStatus);
            sharedStore.start();
            activateArea(currentActiveRole);
        };
        roleSubscription = { ref, listener };
        ref.on('value', listener, error => {
            if (generation !== authGeneration) return;
            clearStaffState();
            loadingStaffData = false;
            showSyncError(`Could not read your staff role: ${error.message}. Check the Firebase rules.`);
        });
    }, error => showSyncError(`Sign-in initialization failed: ${error.message}`));
}
window.addEventListener('beforeunload', event => {
    if (sharedStore?.pendingCount) { event.preventDefault(); event.returnValue = ''; }
});
// Guard before any original handler mutates local state. Firebase rules enforce the same roles on the server.
const principalActions = ['saveSectionConfig', 'saveTeacherDirect', 'deleteTeacher', 'saveClassTeacherAssignments',
    'saveStudent', 'deleteStudent', 'uploadCSV'];
const examActions = ['startNewExamSetup', 'saveMainHeaderConfig', 'saveOrUpdateDayConfig', 'editDayConfig',
    'loadArchivedExamToEdit', 'deleteArchivedExam', 'bindupAndSaveExamRecord', 'updateExamDates', 'handleExamNameSelect',
    'addNextDatesheetDay', 'addPaperSlotToDay', 'removePaperSlotFromDay', 'handleSlotClassChange', 'handleSlotSubjectChange',
    'toggleSlotSection', 'updateSlotField', 'toggleQpSubmissionTick', 'updateQpPrintingStatus', 'saveSubmissionDeadline'];
[...principalActions, ...examActions].forEach(name => {
    const handler = window[name];
    window[name] = function (...args) {
        if (!canEditSharedData(principalActions.includes(name) ? 'principal' : 'exam')) {
            args[0]?.preventDefault?.();
            return false;
        }
        try {
            const result = handler.apply(this, args);
            if (result?.catch) return result.catch(error => { showSyncError(`Not saved: ${error.message}`); return false; });
            return result;
        } catch (error) { showSyncError(`Not saved: ${error.message}`); return false; }
    };
});
initializeSharedApp();
