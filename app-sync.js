/* Firebase Authentication, live UI updates, and migration from the older local-only app. */
'use strict';
const sharedNames = ['students', 'sectionConfigs', 'teachers', 'classTeacherAssignments', 'archivedExams',
    'examOptionsList', 'qpSubmissionsTracker', 'qpPrintingTracker', 'qpSubmissionDeadlines', 'qpOfficeOrders', 'qpOfficeOrderSettings',
    'dateSheetInstructions', 'dateSheetSettings', 'publishedSubjectDirectories'];
sharedNames.push('seatingRooms', 'seatingPlans');
const principalCollections = ['students', 'sectionConfigs', 'teachers', 'classTeacherAssignments', 'examOptionsList', 'publishedSubjectDirectories'];
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
const DEFAULT_ACADEMIC_SESSION = '2026-27';
let academicSessions = { [DEFAULT_ACADEMIC_SESSION]: { id: DEFAULT_ACADEMIC_SESSION, status: 'active', createdAt: '2026-04-01' } };
let systemSettings = { activeSession: DEFAULT_ACADEMIC_SESSION };
let selectedAcademicSession = localStorage.getItem('vems_selected_session') || DEFAULT_ACADEMIC_SESSION;
let sessionMetadataSubscriptions = [];
let publicDirectorySubscription = null;
const editorBaselines = { teacher: null, student: null, section: null, assignments: null, exam: null };

function sessionCollectionPath(name, sessionId = selectedAcademicSession) {
    return sessionId === DEFAULT_ACADEMIC_SESSION ? name : `sessionData/${sessionId}/${name}`;
}
function selectedSessionRecord() { return academicSessions[selectedAcademicSession] || { id: selectedAcademicSession, status: 'open' }; }
function isSelectedSessionFrozen() { return selectedSessionRecord().status === 'frozen'; }
function updateSessionChrome() {
    const badge = document.getElementById('header-session-badge');
    if (badge) badge.textContent = `Session: ${selectedAcademicSession}${isSelectedSessionFrozen() ? ' · FROZEN' : ''}`;
    const printLabel = document.getElementById('print-session-label');
    if (printLabel) printLabel.textContent = `Session: ${selectedAcademicSession} | Student Subject & Roll Verification Roster`;
    const banner = document.getElementById('frozen-session-banner');
    if (banner) { banner.textContent = `Viewing frozen historical session ${selectedAcademicSession} — records are read-only.`; banner.classList.toggle('hidden', !isSelectedSessionFrozen()); }
    const roleLabel = document.getElementById('password-role-label');
    if (roleLabel) roleLabel.textContent = authorizedRole === 'principal' ? 'Principal' : authorizedRole === 'sec-ic' ? 'Secondary IC' : authorizedRole === 'pri-ic' ? 'Primary IC' : 'Current role';
    renderSessionSettings();
}
function renderSessionSettings() {
    const select = document.getElementById('settings-session-select');
    const rows = Object.values(academicSessions).sort((a,b) => String(b.id).localeCompare(String(a.id)));
    if (select) { select.innerHTML = rows.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.id)}${item.id===systemSettings.activeSession?' — ACTIVE':''}${item.status==='frozen'?' — FROZEN':''}</option>`).join(''); select.value=selectedAcademicSession; }
    const status=document.getElementById('settings-session-status'), active=document.getElementById('settings-active-session'), list=document.getElementById('academic-session-list');
    if(status) status.textContent=String(selectedSessionRecord().status||'open').toUpperCase();
    if(active) active.textContent=systemSettings.activeSession||DEFAULT_ACADEMIC_SESSION;
    if(list) list.innerHTML=rows.map(item=>`<tr class="border-b"><td class="p-3 font-bold">${escapeHtml(item.id)}</td><td class="p-3">${escapeHtml(String(item.status||'open').toUpperCase())}</td><td class="p-3">${escapeHtml(item.createdAt?formatOrderDate(item.createdAt.slice(0,10)):'—')}</td><td class="p-3">${escapeHtml(item.frozenAt?`Frozen ${formatOrderDate(item.frozenAt.slice(0,10))}`:item.reopenedAt?`Reopened ${formatOrderDate(item.reopenedAt.slice(0,10))}`:'—')}</td></tr>`).join('');
    const empty=document.getElementById('session-empty-note');
    if(empty) empty.classList.toggle('hidden', !!(Object.keys(sectionConfigs||{}).length||students.length||teachers.length||archivedExams.length));
}

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
        else { text = `Live sync connected · Session ${selectedAcademicSession}${lastConfirmedSave ? ' · Last save confirmed at ' + lastConfirmedSave : ''}`; good = true; }
    }
    element.textContent = text;
    element.className = `no-print px-6 py-3 text-sm ${good ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`;
    if (state?.error) showSyncError(state.error);
}
function canEditSharedData(required = 'exam') {
    const allowed = authorizedRole === 'principal' || (required === 'exam' && ['sec-ic', 'pri-ic'].includes(authorizedRole));
    if (!allowed) { showSyncError('Your staff role cannot make this change. Sign in with the appropriate account.'); return false; }
    if (isSelectedSessionFrozen()) { showSyncError(`Session ${selectedAcademicSession} is frozen and read-only. Select an open session or ask the Principal to unfreeze it.`); return false; }
    try { sharedStore.assertWritable(); return true; }
    catch (error) { showSyncError(error.message); return false; }
}
function sharedValue(name) {
    return ({ students: studentRecords, sectionConfigs, teachers, classTeacherAssignments, archivedExams,
        examOptionsList, qpSubmissionsTracker, qpPrintingTracker, qpSubmissionDeadlines, qpOfficeOrders, qpOfficeOrderSettings,
        dateSheetInstructions, dateSheetSettings, seatingRooms, seatingPlans, publishedSubjectDirectories })[name];
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
        case 'dateSheetInstructions': dateSheetInstructions = value; break;
        case 'dateSheetSettings': dateSheetSettings = value; break;
        case 'publishedSubjectDirectories': publishedSubjectDirectories = value; renderPublicSubjectDirectory(); break;
        case 'seatingRooms': seatingRooms = value; break;
        case 'seatingPlans': seatingPlans = value; break;
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
    if (!qpOfficeOrderFormDirty && !dateSheetFormDirty && !qpReceivingFormDirty) renderExamCreatorModule();
    populateLegacyExamOptions();
    updateSessionChrome();
}
document.addEventListener('focusout', scheduleSharedRender);
document.addEventListener('input', event => {
    if (event.target.matches('.cfg-sub-input')) sectionFormDirty = true;
    if (event.target.closest('#qp-instructions-list') || event.target.id?.startsWith('qp-order-')) captureQpOfficeOrderDraft();
    if (event.target.closest('#datesheet-instructions-list')) captureDateSheetInstructionDraft();
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
    if (event.target.closest('#datesheet-instructions-list')) captureDateSheetInstructionDraft();
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
    sharedNames.filter(name => name !== 'publishedSubjectDirectories').forEach(name => acceptSharedValue(name, {}));
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

function sessionStorePaths(sessionId) { return Object.fromEntries(sharedNames.map(name => [name, sessionCollectionPath(name, sessionId)])); }
function resetSessionViews() {
    sharedNames.filter(name => name !== 'publishedSubjectDirectories').forEach(name => acceptSharedValue(name, {}));
    activeExamId=null; selectedPreExamVaultId=null; isExamConfigOpen=false; isPreExamFullPageOpen=false; datesheetDays=[];
    Object.keys(editorBaselines).forEach(key => { editorBaselines[key]=null; });
}
function startSelectedSessionStore() {
    if (!authorizedRole) return;
    sharedStore?.stop();
    resetSessionViews();
    loadingStaffData=true;
    sharedStore=new VemsSync.Store(db,sharedNames,acceptSharedValue,state=>{loadingStaffData=!state.ready;showSyncStatus(state);},sessionStorePaths(selectedAcademicSession));
    sharedStore.start();
    bindPublicDirectory();
    updateSessionChrome();
}
async function selectAcademicSession(sessionId) {
    if (!academicSessions[sessionId] || sessionId===selectedAcademicSession) return;
    if (sharedStore?.pendingCount) { showSyncError('Wait for pending saves before changing the academic session.'); return; }
    selectedAcademicSession=sessionId;
    localStorage.setItem('vems_selected_session',sessionId);
    startSelectedSessionStore();
}
function bindPublicDirectory() {
    if (!db) return;
    if (publicDirectorySubscription) publicDirectorySubscription.ref.off('value',publicDirectorySubscription.listener);
    const activeSession=systemSettings.activeSession||DEFAULT_ACADEMIC_SESSION;
    const ref=db.ref(sessionCollectionPath('publishedSubjectDirectories',activeSession));
    const listener=snapshot=>{publicPublishedSubjectDirectories=snapshot.val()||{};renderPublicSubjectDirectory();};
    publicDirectorySubscription={ref,listener}; ref.on('value',listener,()=>{publicPublishedSubjectDirectories={};renderPublicSubjectDirectory();});
}
function bindSessionMetadata() {
    sessionMetadataSubscriptions.forEach(item=>item.ref.off('value',item.listener)); sessionMetadataSubscriptions=[];
    const bind=(path,handler)=>{const ref=db.ref(path),listener=snapshot=>handler(snapshot.val()||{});ref.on('value',listener);sessionMetadataSubscriptions.push({ref,listener});};
    bind('academicSessions',value=>{academicSessions=Object.keys(value).length?value:{[DEFAULT_ACADEMIC_SESSION]:{id:DEFAULT_ACADEMIC_SESSION,status:'active',createdAt:'2026-04-01'}};if(!academicSessions[selectedAcademicSession])selectedAcademicSession=systemSettings.activeSession||DEFAULT_ACADEMIC_SESSION;updateSessionChrome();});
    bind('systemSettings',value=>{const previous=systemSettings.activeSession;systemSettings={activeSession:DEFAULT_ACADEMIC_SESSION,...value};if(previous!==systemSettings.activeSession)bindPublicDirectory();updateSessionChrome();});
}
async function saveSessionMetadata(nextSessions=academicSessions,nextSettings=systemSettings) {
    if(authorizedRole!=='principal'){showSyncError('Only the Principal can manage academic sessions.');return false;}
    try{await db.ref('academicSessions').transaction(()=>cloneData(nextSessions));await db.ref('systemSettings').transaction(()=>cloneData(nextSettings));academicSessions=nextSessions;systemSettings=nextSettings;updateSessionChrome();return true;}catch(error){showSyncError(`Session settings not saved: ${error.message}`);return false;}
}
async function createAcademicSession() {
    const input=document.getElementById('new-session-id'),id=(input?.value||'').trim();
    const match=id.match(/^(\d{4})-(\d{2})$/),valid=match&&Number(match[2])===(Number(match[1])+1)%100;
    if(!valid){alert('Enter a session in the format 2027-28. The ending year must follow the starting year.');return;}
    if(academicSessions[id]){alert('This academic session already exists.');return;}
    const next={...academicSessions,[id]:{id,status:'open',createdAt:new Date().toISOString(),createdBy:authorizedRole}};
    if(await saveSessionMetadata(next,systemSettings)){input.value='';await selectAcademicSession(id);}
}
async function makeSelectedSessionActive() {
    if(!confirm(`Set ${selectedAcademicSession} as the official active session for the portal?`))return;
    const next=cloneData(academicSessions);Object.values(next).forEach(item=>{if(item.status==='active')item.status='open';});next[selectedAcademicSession].status='active';
    if(await saveSessionMetadata(next,{...systemSettings,activeSession:selectedAcademicSession,updatedAt:new Date().toISOString()}))bindPublicDirectory();
}
async function freezeSelectedSession() {
    if(isSelectedSessionFrozen())return;
    if(!confirm(`Freeze session ${selectedAcademicSession}? All its records will become read-only.`))return;
    const next=cloneData(academicSessions);next[selectedAcademicSession]={...next[selectedAcademicSession],status:'frozen',frozenAt:new Date().toISOString(),frozenBy:authorizedRole};await saveSessionMetadata(next,systemSettings);
}
async function unfreezeSelectedSession() {
    if(!isSelectedSessionFrozen())return;
    const reason=(prompt('Enter the reason for reopening this frozen session:')||'').trim();if(!reason)return;
    const next=cloneData(academicSessions);next[selectedAcademicSession]={...next[selectedAcademicSession],status:selectedAcademicSession===systemSettings.activeSession?'active':'open',reopenedAt:new Date().toISOString(),reopenedBy:authorizedRole,reopenReason:reason};await saveSessionMetadata(next,systemSettings);
}
async function changeCurrentRolePassword(event) {
    event.preventDefault();const status=document.getElementById('password-change-status'),current=document.getElementById('current-role-password').value,next=document.getElementById('new-role-password').value,confirmValue=document.getElementById('confirm-role-password').value;
    if(next!==confirmValue){status.textContent='New passcodes do not match.';status.className='text-xs text-red-700 font-bold';return;}if(next.length<8){status.textContent='Use at least 8 characters.';status.className='text-xs text-red-700 font-bold';return;}
    try{const user=firebase.auth().currentUser,credential=firebase.auth.EmailAuthProvider.credential(roleAccounts[authorizedRole],current);await user.reauthenticateWithCredential(credential);await user.updatePassword(next);event.target.reset();status.textContent='Passcode updated successfully for this role.';status.className='text-xs text-emerald-700 font-bold';}catch(error){status.textContent=error.code?.startsWith('auth/')?'Current passcode was not accepted.':'Passcode update failed. Check the connection and try again.';status.className='text-xs text-red-700 font-bold';}
}

function initializeSharedApp() {
    activateArea('public');
    if (!db) { showSyncError('Firebase could not load. Check access to www.gstatic.com and reload the page.'); showSyncStatus(); return; }
    bindSessionMetadata();
    bindPublicDirectory();
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
            startSelectedSessionStore();
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
