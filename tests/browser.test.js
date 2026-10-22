/* Browser integration against a shared, isolated Firebase contract double.
 * Run: node tests/browser.test.js (requires Playwright and system Chromium).
 * This deliberately does not claim Firebase server/rules integration coverage.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const initialExam = { id: 100, title: 'Existing Exam', fromDate: '2026-11-01', toDate: '2026-11-01', totalDays: 1,
    headerSnapshot: { name: 'PT-1', fromDate: '2026-11-01', toDate: '2026-11-01', customName: '' },
    datesheetSnapshot: [{ id: 1, dateStr: '2026-11-01', isCollapsed: false, paperSlots: [
        { slotId: 123, cls: '10', subject: 'SCIENCE', selectedSections: ['A'], duration: '3 Hours', maxMarks: 80,
            repTime: '08:00', readTime: '08:15', startTime: '08:30', overTime: '11:30' }
    ] }] };
let data = { roles: { principal1: 'principal', principal2: 'principal', secondary: 'sec-ic', primary: 'pri-ic' },
    sectionConfigs: { '10-A': ['SCIENCE'] }, teachers: {}, archivedExams: [initialExam] };
const accounts = {
    'principal1@example.test': 'principal1', 'principal2@example.test': 'principal2',
    'secondary@example.test': 'secondary', 'primary@example.test': 'primary', 'unassigned@example.test': 'unassigned'
};
const rolePasscodes = { principal: 'test-principal-passcode', 'sec-ic': 'test-secondary-passcode', 'pri-ic': 'test-primary-passcode' };
const subscriptions = [];
const revisions = {};
let denyWrites = false;
let slowWrites = false;
const failures = [];
function allowed(uid, name) {
    const role = data.roles[uid];
    return role === 'principal' || (['sec-ic', 'pri-ic'].includes(role) && ['archivedExams', 'qpSubmissionsTracker', 'qpPrintingTracker', 'qpSubmissionDeadlines', 'qpOfficeOrders'].includes(name));
}
async function notify(name) {
    await Promise.all(subscriptions.filter(s => s.path === name && !s.page.isClosed()).map(s =>
        s.page.evaluate(({ id, value }) => window.testDeliver(id, value), { id: s.id, value: clone(data[name] ?? null) })));
}
async function main() {
    const server = http.createServer((request, response) => {
        const filename = request.url.split('?')[0] === '/' ? 'index.html' : request.url.split('?')[0].slice(1);
        if (!['index.html', 'sync-store.js', 'app-sync.js'].includes(filename)) { response.writeHead(404).end(); return; }
        response.setHeader('Content-Type', filename.endsWith('.js') ? 'application/javascript' : 'text/html');
        response.end(fs.readFileSync(path.join(root, filename)));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const pages = [];
    try {
        async function pageFor(options = {}) {
            const context = await browser.newContext(options.mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {});
            const page = await context.newPage();
            pages.push(page);
            page.on('pageerror', error => failures.push(error.message));
            page.on('dialog', dialog => { if (dialog.message() === 'XSS') failures.push('Stored script executed'); return dialog.accept(); });
            await page.exposeFunction('testSignIn', async (email, password) => accounts[email] && password === rolePasscodes[data.roles[accounts[email]]] ? { uid: accounts[email], email } : null);
            await page.exposeFunction('testSubscribe', async (name, id, uid) => {
                subscriptions.push({ path: name, id, page });
                const value = name === '.info/connected' ? true : name.startsWith('roles/') ? data.roles[name.slice(6)] ?? null : data[name] ?? null;
                await page.evaluate(({ id, value }) => window.testDeliver(id, value), { id, value: clone(value) });
            });
            await page.exposeFunction('testRead', name => ({ value: clone(data[name] ?? null), revision: revisions[name] || 0 }));
            await page.exposeFunction('testCommit', async (name, value, revision, uid) => {
                if (denyWrites || !allowed(uid, name)) return { error: 'PERMISSION_DENIED' };
                if (slowWrites) await new Promise(resolve => setTimeout(resolve, 200));
                if (revision !== (revisions[name] || 0)) return { committed: false };
                data[name] = clone(value);
                revisions[name] = revision + 1;
                await notify(name);
                return { committed: true };
            });
            await page.route('https://www.gstatic.com/**', route => route.fulfill({ contentType: 'application/javascript', body: route.request().url().includes('firebase-app-compat')
                ? fs.readFileSync(path.join(__dirname, 'firebase-browser-double.js'), 'utf8') : '' }));
            await page.route('https://cdn.tailwindcss.com/**', route => route.fulfill({ contentType: 'application/javascript', body: `const style=document.createElement('style');style.textContent='.hidden{display:none!important}';document.head.appendChild(style);` }));
            if (options.legacy) await page.addInitScript(() => {
                localStorage.setItem('vems_teachers', JSON.stringify([{ id: 9, name: 'Legacy Teacher', desig: 'PGT', allotments: [] }]));
                localStorage.setItem('vems_qp_printing_tracker', JSON.stringify({ '10-SCIENCE': 'In-Printing' }));
            });
            if (options.forgedRole) await page.addInitScript(() => localStorage.setItem('vems_active_role', 'principal'));
            await page.goto(base);
            return page;
        }
        async function login(page, email, role = 'principal') {
            await page.evaluate(role => switchPortalArea(role), role);
            const account = await page.evaluate(role => roleAccounts[role], role);
            accounts[account] = role === 'principal' ? 'principal1' : role === 'sec-ic' ? 'secondary' : 'primary';
            assert.equal(await page.locator('#login-modal input[type="email"]').count(), 0);
            await page.fill('#login-password', rolePasscodes[role]);
            await page.locator('#login-modal button[type="submit"]').click();
            await page.waitForFunction(() => sharedStore?.ready && sharedStore.connected);
            await page.locator('#login-password').evaluate(element => element.blur());
        }
        const a = await pageFor({ legacy: true });
        const b = await pageFor({ mobile: true, forgedRole: true });
        assert.equal(await b.locator('#area-principal').isVisible(), false, 'a local role flag cannot grant access');
        await login(a, 'principal1@example.test');
        await login(b, 'principal2@example.test');
        await a.evaluate(() => openLoginModal('principal'));
        await a.fill('#login-password', rolePasscodes.principal);
        await a.locator('#login-modal button[type="submit"]').click();
        await a.waitForFunction(() => document.getElementById('login-modal').classList.contains('hidden'));
        assert.equal(await a.locator('#login-password').inputValue(), '');
        console.log('PASS: passcode-only role entry, same-account reauthentication, independent PC and mobile sessions');

        await a.evaluate(() => switchTab('teachers'));
        await a.fill('#tch-name-input', 'New Shared Teacher');
        await a.fill('#tch-desig-input', 'PGT SCIENCE');
        await a.evaluate(() => saveTeacherDirect({ preventDefault() {} }));
        await b.waitForFunction(() => teachers.some(t => t.name === 'New Shared Teacher'));
        assert.equal(Object.values(data.teachers).length, 1);
        await a.evaluate(async () => {
            teachers[0].allotments = [{ cls: '10', sec: 'A', subject: 'SCIENCE', qpSetter: 'Self', evaluator: 'Self' }];
            await saveData(['teachers']);
        });
        console.log('PASS: faculty save is confirmed and appears on the other device');

        await a.selectOption('#ct-10-A', 'New Shared Teacher');
        await a.evaluate(() => saveClassTeacherAssignments());
        await b.waitForFunction(() => classTeacherAssignments['10-A']?.ct === 'New Shared Teacher');
        console.log('PASS: class-teacher duty assignments synchronize');

        await b.evaluate(() => switchTab('teachers'));
        await b.focus('#ct-10-A');
        await a.evaluate(async () => { classTeacherAssignments['10-A'].ct = ''; await saveData(['classTeacherAssignments']); });
        await b.waitForFunction(() => classTeacherAssignments['10-A'].ct === '');
        await b.evaluate(() => {
            const field = document.getElementById('coct-10-A');
            field.value = 'New Shared Teacher';
            field.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await b.evaluate(() => saveClassTeacherAssignments());
        assert.equal(data.classTeacherAssignments['10-A'].ct, '', 'stale visible assignment fields must not restore a changed cloud value');
        assert.equal(data.classTeacherAssignments['10-A'].coCt, 'New Shared Teacher');
        await b.evaluate(() => document.activeElement.blur());
        console.log('PASS: a stale assignment table merges edits against the snapshot actually displayed');

        await a.evaluate(() => { switchTab('config'); document.getElementById('cfg-class').value = '10'; updateCfgSections(); addNewSubjectField(); });
        await a.locator('.cfg-sub-input').last().fill('MATHS');
        await a.evaluate(() => saveSectionConfig({ preventDefault() {} }));
        await b.waitForFunction(() => sectionConfigs['10-A']?.includes('MATHS'));
        console.log('PASS: subject mappings synchronize');

        await b.reload();
        await login(b, 'principal2@example.test');
        await b.waitForFunction(() => teachers.some(t => t.name === 'New Shared Teacher'));
        console.log('PASS: shared records survive reload without local browser copies');

        const teacherId = Object.values(data.teachers)[0].id;
        await a.evaluate(id => { switchTab('teachers'); editTeacher(id); }, teacherId);
        await a.fill('#tch-name-input', 'Stale Form Name');
        await b.evaluate(async id => {
            teachers.find(t => t.id === id).name = 'Other Device Name';
            await saveData(['teachers']);
        }, teacherId);
        await a.evaluate(() => saveTeacherDirect({ preventDefault() {} }));
        assert.equal(data.teachers[String(teacherId)].name, 'Other Device Name');
        assert.match(await a.locator('#sync-error').textContent(), /Another device/);
        console.log('PASS: a stale open form cannot overwrite another device');

        await a.evaluate(() => { resetTeacherForm(); switchTab('students'); openStudentModal(); });
        await a.fill('#stu-name', 'Test Student');
        await a.fill('#stu-roll', '101');
        await a.evaluate(() => saveStudent({ preventDefault() {} }));
        await b.waitForFunction(() => students.some(s => s.name === 'Test Student'));
        const studentId = Object.keys(data.students['10'].A)[0];
        await a.evaluate(id => deleteStudent(id), studentId);
        await b.waitForFunction(() => students.length === 0);
        console.log('PASS: student creation and deletion propagate, including an empty list');

        await a.evaluate(() => { switchTab('exam-creator-prin'); openPreExamFullPageWorkspace(100); });
        const trackerKey = await a.evaluate(() => qpRecordKey(100, '10', 'SCIENCE'));
        await a.evaluate(key => toggleQpSubmissionTick(key, 'qpReceived'), trackerKey);
        await b.waitForFunction(key => qpSubmissionsTracker[key]?.qpReceived === true, trackerKey);
        await a.evaluate(() => saveSubmissionDeadline('2026-11-05'));
        await b.waitForFunction(() => qpSubmissionDeadlines['100'] === '2026-11-05');
        await a.evaluate(key => updateQpPrintingStatus(key, 'Completed'), trackerKey);
        await b.waitForFunction(key => qpPrintingTracker[key] === 'Completed', trackerKey);
        assert.notEqual(await a.evaluate(() => qpRecordKey(100, '10', 'SCIENCE')), await a.evaluate(() => qpRecordKey(200, '10', 'SCIENCE')));
        console.log('PASS: exam-scoped QP submission, printing, and deadlines synchronize');

        await a.fill('#qp-order-number', 'KV1/EXAM/2026/01');
        await a.fill('#qp-order-deadline', '2026-11-04');
        await a.fill('#qp-order-time', '15:30');
        assert.match(await a.locator('text=Auto-linked from Faculty Manager').first().textContent(), /Auto-linked/);
        await a.evaluate(() => saveQpOfficeOrder('ISSUED'));
        await b.waitForFunction(() => qpOfficeOrders['100']?.status === 'ISSUED');
        assert.equal(data.qpOfficeOrders['100'].setters[trackerKey].name, 'Other Device Name');
        assert.equal(data.qpSubmissionDeadlines['100'], '2026-11-04');
        await a.evaluate(() => generateQpSetterOfficeOrderPrint());
        await a.locator('#qp-office-order-preview iframe').waitFor();
        const previewText = await a.locator('#qp-office-order-preview iframe').contentFrame().locator('body').textContent();
        assert.match(previewText, /PM SHRI KENDRIYA VIDYALAYA NO. 1, ITANAGAR/);
        assert.match(previewText, /Other Device Name/);
        await a.evaluate(() => closeQpOfficeOrderPreview());
        console.log('PASS: issued QP office order auto-links setters, syncs, and opens an in-app A4 preview');

        const count = Object.values(data.archivedExams).length;
        await a.evaluate(() => startNewExamSetup());
        await b.waitForFunction(count => archivedExams.length === count + 1, count);
        const created = Object.values(data.archivedExams).find(exam => exam.id !== 100);
        await b.evaluate(id => loadArchivedExamToEdit(id), created.id);
        assert.equal(await b.evaluate(() => datesheetDays.length), 1);
        await a.evaluate(id => deleteArchivedExam(id), created.id);
        await b.waitForFunction(id => !archivedExams.some(exam => exam.id === id) && !isExamConfigOpen, created.id);
        console.log('PASS: drafts are shared, reopen on another device, and remote deletion closes the editor');

        await a.evaluate(() => switchTab('teachers'));
        await a.fill('#tch-name-input', 'Denied Teacher');
        await a.fill('#tch-desig-input', 'PGT');
        denyWrites = true;
        await a.evaluate(() => saveTeacherDirect({ preventDefault() {} }));
        assert.equal(Object.values(data.teachers).some(t => t.name === 'Denied Teacher'), false);
        assert.match(await a.locator('#sync-error').textContent(), /Not saved.*PERMISSION_DENIED/);
        denyWrites = false;
        await a.evaluate(() => window.testSetConnected(false));
        await a.evaluate(() => saveTeacherDirect({ preventDefault() {} }));
        assert.match(await a.locator('#sync-error').textContent(), /offline/i);
        assert.equal(Object.values(data.teachers).some(t => t.name === 'Denied Teacher'), false);
        await a.evaluate(() => window.testSetConnected(true));
        console.log('PASS: offline/denied saves show errors and never report success');

        await a.evaluate(() => switchTab('settings'));
        await a.selectOption('#legacy-exam-target', '100');
        await a.evaluate(() => importLegacyBrowserData());
        assert.equal(data.teachers['9'].name, 'Legacy Teacher');
        assert.equal(data.qpPrintingTracker[trackerKey], 'Completed', 'import must preserve cloud tracker state');
        const imported = clone(data);
        await a.evaluate(() => importLegacyBrowserData());
        assert.deepEqual(data, imported);
        assert.equal(await a.evaluate(() => JSON.parse(localStorage.getItem('vems_teachers'))[0].name), 'Legacy Teacher');
        console.log('PASS: old-browser import preserves cloud data and is repeatable');

        const payload = '<img src=x onerror="window.__vemsXss=true">';
        const unsafeExam = clone(initialExam);
        unsafeExam.id = 900;
        unsafeExam.title = payload;
        unsafeExam.fromDate = '\"><img src=x onerror="window.__vemsXss=true">';
        unsafeExam.datesheetSnapshot[0].id = "1);alert('XSS');void(0";
        unsafeExam.datesheetSnapshot[0].paperSlots[0].slotId = "1);alert('XSS');void(0";
        data.archivedExams['900'] = unsafeExam;
        data.archivedExams['901'] = { ...clone(initialExam), id: "0);alert('XSS');void(0", title: payload };
        revisions.archivedExams = (revisions.archivedExams || 0) + 1;
        await notify('archivedExams');
        await a.evaluate(() => { switchTab('exam-creator-prin'); loadArchivedExamToEdit(900); });
        assert.equal(await a.locator('#exam-creator-mount-prin img').count(), 0);
        assert.equal(await a.evaluate(() => window.__vemsXss === true), false);
        const unsafeHandlers = await a.locator('#exam-creator-mount-prin [onclick], #exam-creator-mount-prin [onchange]').evaluateAll(elements =>
            elements.map(element => element.getAttribute('onclick') || element.getAttribute('onchange')).filter(code => code.includes("alert('XSS')")));
        assert.deepEqual(unsafeHandlers, [], 'database values must never become executable inline-handler arguments');
        const unsafeSectionKey = `10-A" onfocus="alert('XSS')`;
        data.sectionConfigs[unsafeSectionKey] = ['SCIENCE'];
        await notify('sectionConfigs');
        await a.evaluate(() => switchTab('teachers'));
        assert.equal(await a.locator('#sec-teachers [onfocus]').count(), 0, 'section keys must not become attributes on assignment dropdowns');
        delete data.sectionConfigs[unsafeSectionKey];
        await notify('sectionConfigs');
        delete data.archivedExams['900'];
        delete data.archivedExams['901'];
        revisions.archivedExams++;
        await notify('archivedExams');
        console.log('PASS: database-controlled HTML and nested ID payloads render safely');

        const secondary = await pageFor();
        await login(secondary, 'secondary@example.test', 'sec-ic');
        assert.equal(await secondary.locator('#area-principal').isVisible(), false);
        assert.equal(await secondary.evaluate(() => saveTeacherDirect({ preventDefault() {} })), false);
        await secondary.evaluate(() => openPreExamFullPageWorkspace(100));
        assert.equal(await secondary.locator('#exam-creator-mount-prin').innerHTML(), '');
        await secondary.evaluate(() => saveSubmissionDeadline('2026-11-06'));
        await b.waitForFunction(() => qpSubmissionDeadlines['100'] === '2026-11-06');
        console.log('PASS: secondary role can update exams but cannot edit principal master data');
        const primary = await pageFor();
        const primaryAccount = await primary.evaluate(() => roleAccounts['pri-ic']);
        accounts[primaryAccount] = 'primary';
        await primary.evaluate(() => openLoginModal('pri-ic'));
        await primary.fill('#login-password', rolePasscodes.principal);
        await primary.locator('#login-modal button[type="submit"]').click();
        await primary.waitForFunction(() => !document.getElementById('login-error-msg').classList.contains('hidden'));
        assert.equal(await primary.evaluate(() => authorizedRole), null);
        await login(primary, null, 'pri-ic');
        assert.equal(await primary.locator('#area-pri-ic').isVisible(), true);
        assert.equal(await primary.locator('#exam-creator-mount-pri').getByRole('button', { name: '➕ Create New Exam' }).count(), 1);
        await primary.evaluate(() => startNewExamSetup());
        await primary.evaluate(() => addPaperSlotToDay(1));
        const primaryId = await primary.evaluate(() => activeExamId);
        await b.waitForFunction(id => archivedExams.some(exam => exam.id === id && exam.datesheetSnapshot[0].paperSlots[0]?.cls === '1'), primaryId);
        await primary.evaluate(id => deleteArchivedExam(id), primaryId);
        assert.equal(await primary.evaluate(() => canEditSharedData('principal')), false);
        console.log('PASS: primary staff use passcode-only entry and create/save primary exam schedules');


        slowWrites = true;
        const saving = secondary.evaluate(() => saveSubmissionDeadline('2026-11-07'));
        await secondary.waitForFunction(() => sharedStore.pendingCount > 0);
        assert.match(await secondary.locator('#sync-status').textContent(), /Saving/);
        await saving;
        slowWrites = false;
        assert.match(await secondary.locator('#sync-status').textContent(), /Last save confirmed/);
        console.log('PASS: status distinguishes pending work from a server-confirmed save');

        data.roles.secondary = null;
        await Promise.all(subscriptions.filter(s => s.page === secondary && s.path === 'roles/secondary').map(s =>
            secondary.evaluate(id => window.testDeliver(id, null), s.id)));
        await secondary.waitForFunction(() => authorizedRole === null && teachers.length === 0 && archivedExams.length === 0);
        assert.equal(await secondary.locator('#area-sec-ic').isVisible(), false);
        console.log('PASS: role revocation clears staff data and closes the workspace');
        assert.deepEqual(failures, [], `Unexpected browser errors: ${failures.join('; ')}`);
        console.log('Browser integration: 18 scenarios passed (Firebase contract double; no live writes).');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
