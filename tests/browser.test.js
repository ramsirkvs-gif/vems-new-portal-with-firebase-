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
    sectionConfigs: { '10-A': ['SCIENCE'] }, teachers: {}, classTeacherAssignments: { __ctCoCt2026Seeded: { version: 3, seededAt: 'test' } }, circularSettings: { finalFacultyRoster2026Seeded: { version: 3, seededAt: 'test' } }, archivedExams: [initialExam] };
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
    return role === 'principal' || (['sec-ic', 'pri-ic'].includes(role) && ['archivedExams', 'qpSubmissionsTracker', 'qpPrintingTracker', 'qpSubmissionDeadlines', 'qpOfficeOrders', 'qpOfficeOrderSettings', 'dateSheetInstructions', 'dateSheetSettings', 'seatingRooms', 'seatingPlans', 'publicPortalBoards', 'examCoreTeam'].includes(name));
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
            await page.exposeFunction('testUpdatePassword', async (uid, password) => { rolePasscodes[data.roles[uid]]=password; });
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
            await page.addInitScript(() => { window.__vemsPublicUpdateDecision = 'update'; });
            if (options.legacy) await page.addInitScript(() => {
                localStorage.setItem('vems_teachers', JSON.stringify([{ id: 9, name: 'Legacy Teacher', desig: 'PGT', allotments: [] }]));
                localStorage.setItem('vems_qp_printing_tracker', JSON.stringify({ '10-SCIENCE': 'In-Printing' }));
            });
            if (options.forgedRole) await page.addInitScript(() => localStorage.setItem('vems_active_role', 'principal'));
            await page.goto(base);
            await page.waitForFunction(() => portalGateReady === true);
            await page.fill('#portal-curtain-password', 'kvs123');
            await page.locator('#portal-curtain button[type="submit"]').click();
            await page.waitForFunction(() => document.getElementById('portal-curtain').classList.contains('hidden'));
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
        assert.equal(await a.locator('#student-modal').isVisible(), false, 'student modal must stay closed on initial entry');
        assert.equal(await a.evaluate(()=>{const oldConfirm=window.confirm;let step=0;window.confirm=()=>++step===1;const result=confirmMajorDeletion('complete examination vault','PT-1');window.confirm=oldConfirm;return result;}),false);
        assert.equal(await a.evaluate(()=>{const oldConfirm=window.confirm;let step=0;window.confirm=()=>{step++;return true;};const result=confirmMajorDeletion('complete examination vault','PT-1');window.confirm=oldConfirm;return result&&step===2;}),true);
        assert.equal(await a.locator('#login-modal').isVisible(), false, 'login modal must stay closed until a role is selected');
        assert.equal(await b.getByRole('banner').getByText('PM SHRI Kendriya Vidyalaya No. 1, Itanagar', {exact:true}).count(),1,'school identity must remain present in the header');
        assert.equal(await b.getByRole('banner').getByText('VEMS · PM SHRI KV No. 1 Itanagar',{exact:true}).isVisible(),true,'the compact mobile brand must retain the KV name');
        assert.equal(await b.getByRole('banner').getByText('VEMS — Vidyalaya Examination Management System', {exact:true}).isVisible(),true,'the full VEMS title must remain visible in the compact mobile header');
        assert.equal(await b.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'mobile layout must not overflow the viewport');
        assert.equal(await b.locator('.role-switcher').evaluate(element => getComputedStyle(element).display),'none','desktop role buttons must be hidden on mobile');
        assert.equal(await b.locator('#mobile-portal-menu').isVisible(),true,'mobile must use one compact portal dropdown');
        assert.deepEqual(await b.locator('#mobile-portal-menu option').allTextContents(),['📢 Public View','🔒 Principal Login','🔒 Secondary IC Login','🔒 Primary IC Login']);
        assert.equal(await b.getByRole('banner').evaluate(element=>element.getBoundingClientRect().height<75),true,'mobile header must stay compact');
        assert.equal(await b.locator('#public-roll-class').locator('..').evaluate(tools=>{const buttons=[...tools.querySelectorAll('.public-export-button')],parent=tools.getBoundingClientRect(),rects=buttons.map(button=>button.getBoundingClientRect());return buttons.length===2&&Math.abs(rects[0].top-rects[1].top)<2&&parent.right-rects[1].right<2&&rects.every(rect=>rect.width<parent.width/2);}),true,'mobile PDF and Share actions must stay compact together at the right edge');
        assert.equal(await b.locator('#area-principal').isVisible(), false, 'a local role flag cannot grant access');
        await login(a, 'principal1@example.test');
        await login(b, 'principal2@example.test');
        await a.evaluate(() => openLoginModal('principal'));
        await a.fill('#login-password', rolePasscodes.principal);
        await a.locator('#login-modal button[type="submit"]').click();
        await a.waitForFunction(() => document.getElementById('login-modal').classList.contains('hidden'));
        assert.equal(await a.locator('#login-password').inputValue(), '');
        await a.evaluate(()=>{activateArea('public');window._noticeTestBoards=publicPortalBoards;publicPortalBoards={...publicPortalBoards,notices:[{heading:'Earlier Notice',text:'Older public message',priority:'Important',publishedAt:'2026-10-24T10:00:00.000Z'},{heading:'Examination Update',text:'Test public message',priority:'Urgent',publishedAt:'2026-10-25T10:00:00.000Z'}]};delete publicPortalBoards.notice;renderPublicPortalBoards();});
        assert.equal(await a.locator('#public-urgent-notice').getByText('Examination Update',{exact:true}).count(),1,'the published notice heading must appear only once');
        assert.deepEqual(await a.locator('#public-urgent-notice article .font-extrabold').allTextContents(),['Examination Update','Earlier Notice'],'new notices must appear before previous notices');
        assert.equal(await a.locator('#public-urgent-notice').getByText('LATEST',{exact:true}).count(),1);
        assert.doesNotMatch(await a.locator('#public-exam-notice-board').innerText(),/EXAMINATION NOTICE BOARD/);
        assert.equal(await a.locator('.notice-vertical-content').evaluate(element=>getComputedStyle(element).animationName),'notice-rise','published notice content must run from bottom to top');
        await a.locator('.notice-vertical-window').focus();
        assert.equal(await a.locator('.notice-vertical-content').evaluate(element=>getComputedStyle(element).animationPlayState),'paused','focusing the notice must pause its movement');
        await a.evaluate(()=>{publicPortalBoards=window._noticeTestBoards;delete window._noticeTestBoards;renderPublicPortalBoards();activateArea('principal');});
        assert.equal(await a.locator('header img[alt="KVS logo"]').count(),1);
        assert.equal(await a.locator('header img[alt="PM SHRI logo"]').count(),1);
        assert.equal(await a.locator('#area-public-display > section img').count(),0,'public view must use the single shared portal header');
        console.log('PASS: passcode-only role entry, same-account reauthentication, independent PC and mobile sessions');

        await a.evaluate(() => { switchTab('exam-creator-prin'); toggleNoticePanel(); });
        await a.fill('#exam-notice-heading', 'Test Notice');
        await a.fill('#exam-notice-text', 'Published notice body');
        await a.getByRole('button', { name: 'Publish New Notice' }).click();
        await a.waitForFunction(() => instantNotices().some(notice => notice.text === 'Published notice body'));
        assert.ok(await a.getByText('Published notice body', { exact: true }).count() >= 1, 'a saved notice must remain visible in the publisher list');
        assert.equal(data.publicPortalBoards.notices[0].text, 'Published notice body', 'notice text must be persisted');
        console.log('PASS: public notice publishes and remains visible in the management list');
        await a.fill('#exam-notice-heading', 'Title Only Notice');
        await a.fill('#exam-notice-text', '');
        await a.getByRole('button', { name: 'Publish New Notice' }).click();
        await a.waitForFunction(() => instantNotices()[0]?.heading === 'Title Only Notice');
        assert.equal(data.publicPortalBoards.notices[0].heading, 'Title Only Notice', 'a title-only notice must publish without body text');
        await a.evaluate(() => { activateArea('public'); renderPublicPortalBoards(); });
        assert.ok(await a.getByText('Title Only Notice', { exact: true }).count() >= 1, 'a title-only notice must be visible publicly');
        await a.evaluate(() => activateArea('principal'));
        console.log('PASS: title-only public notices publish and display');
        await a.evaluate(() => { if (!circularPanelOpen) toggleCircularPanel(); openCircularEditor(); });
        await a.fill('#circular-subject', 'Examination Committee Meeting');
        await a.fill('#circular-body', 'All members shall attend the meeting at the notified time.');
        await a.locator('[name="circular-target"]').first().check();
        await a.getByRole('button', { name: 'Save Draft' }).click();
        await a.waitForFunction(() => Object.values(examCirculars).some(item => item.subject === 'Examination Committee Meeting' && item.status === 'DRAFT'));
        assert.equal(Object.values(data.examCirculars || {}).length, 1);
        const circularHtml = await a.evaluate(() => circularPdfHtml(Object.values(examCirculars)[0]));
        assert.ok(circularHtml.indexOf('All members shall attend') < circularHtml.indexOf('ADDRESSEES / OFFICIALS CONCERNED'), 'circular text must appear before target groups and employee names');
        assert.match(circularHtml, /assets\/kvs-logo\.png/);
        assert.match(circularHtml, /assets\/pm-shri-logo\.png/);
        assert.ok(circularHtml.indexOf('EXAM IC') < circularHtml.indexOf('PRINCIPAL'), 'Exam IC must be left of the Principal');
        console.log('PASS: session-linked examination circular saves with reusable subject and recipient snapshot');

        await a.evaluate(() => switchTab('settings'));
        await a.fill('#signature-name-sec-ic', 'Test Secondary Exam IC');
        await a.locator('button[onclick="saveSignatureProfile(\'sec-ic\')"]').click();
        await a.waitForFunction(() => signatureProfiles['sec-ic']?.name === 'Test Secondary Exam IC');
        assert.equal(await a.evaluate(() => signatureProfiles['sec-ic'].image || ''), '', 'name-only profile must not require a signature image');
        assert.match(await a.locator('#signature-status-sec-ic').textContent(), /saved successfully/i);
        console.log('PASS: official name and designation save without a signature image');

        await a.fill('#signature-name-principal', 'Test Principal');
        await a.setInputFiles('#signature-file-principal', { name: 'principal-signature.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
        await a.waitForTimeout(120);
        assert.equal(await a.locator('#signature-file-principal').evaluate(input => input.files.length), 1, 'signature selection must survive UI refresh');
        await a.getByRole('button', { name: 'Save Official Profile' }).first().click();
        await a.waitForFunction(() => !!signatureProfiles.principal?.image);
        assert.match(await a.locator('#signature-status-principal').textContent(), /saved successfully/i);
        console.log('PASS: signature file selection survives refresh and saves to the shared profile');

        await a.evaluate(() => switchTab('teachers'));
        await a.fill('#tch-name-input', 'New Shared Teacher');
        await a.fill('#tch-desig-input', 'PGT SCIENCE');
        await a.locator('#add-teaching-class-button').click();
        assert.equal(await a.locator('.teaching-row .sub-sel').first().inputValue(),'SCIENCE','designation subject must become the default allotment subject');
        await a.selectOption('.teaching-row .sub-sel','ENGLISH');
        await a.fill('#tch-desig-input','PGT HINDI');
        assert.equal(await a.locator('.teaching-row .sub-sel').first().inputValue(),'ENGLISH','manual subject choice must be preserved');
        await a.selectOption('.teaching-row .sub-sel','SCIENCE');
        await a.fill('#tch-desig-input','PGT SCIENCE');
        assert.equal(await a.evaluate(() => subjectSuggestedByDesignation('PGT-History',['ENGLISH','HISTORY'])),'HISTORY');
        assert.equal(await a.evaluate(() => subjectSuggestedByDesignation('PGT-Pol Scie',['ENGLISH','Pol Scie'])),'Pol Scie','the exact saved Subject Mapping label must be retained');
        assert.equal(await a.evaluate(() => subjectSuggestedByDesignation('AI Instructor',['AI','COMPUTER LITERACY'])),'','AI Instructor must not be interpreted as the Artificial Intelligence subject');
        assert.equal(await a.evaluate(() => subjectSuggestedByDesignation('Artificial Intelligence Teacher',['AI','COMPUTER LITERACY'])),'AI','an explicit Artificial Intelligence designation may select the exact mapped AI label');
        assert.deepEqual(await a.evaluate(() => {const prior=sectionConfigs;sectionConfigs={'6-A':['SCIENCE'],'11-A':['ENGLISH','POLITICAL SCIENCE'],'12-B':['POLITICAL SCIENCE']};try{return defaultAllotmentFromDesignation('PGT-Political Science');}finally{sectionConfigs=prior;}}),{cls:'11',sec:'A',subject:'POLITICAL SCIENCE'},'designation must choose a configured class where its subject exists');
        assert.equal(await a.evaluate(() => subjectSuggestedByDesignation('TGT-Maths',['MATHEMATICS STANDARD + MATHEMATICS BASIC','ENGLISH','MATHEMATICS STANDARD','MATHEMATICS BASIC','SCIENCE'])),'MATHEMATICS STANDARD + MATHEMATICS BASIC');
        await a.fill('#tch-desig-input','TGT-Maths');
        await a.evaluate(() => {const prior=sectionConfigs['10-A'];sectionConfigs['10-A']=['ENGLISH','MATHEMATICS STANDARD','MATHEMATICS BASIC','SCIENCE'];addTeachingRow('10','A');sectionConfigs['10-A']=prior;});
        assert.equal(await a.locator('.teaching-row .sub-sel').last().inputValue(),'MATHEMATICS STANDARD + MATHEMATICS BASIC','a newly added class must default from the designation subject');
        await a.locator('.teaching-row').last().locator('button',{hasText:'✕'}).click();
        await a.fill('#tch-desig-input','PGT SCIENCE');
        const teachingRowCount=await a.locator('.teaching-row').count();
        await a.locator('#add-teaching-class-button').click();
        assert.equal(await a.locator('.teaching-row').count(),teachingRowCount+1,'Add Class must immediately create a complete default row');
        await a.waitForFunction(()=>document.activeElement===document.querySelector('.teaching-row:last-child .cls-sel'));
        assert.equal(await a.evaluate(()=>document.activeElement===document.querySelector('.teaching-row:last-child .cls-sel')),true,'the newly added class row must be brought into focus');
        assert.equal(await a.locator('.teaching-row .sub-sel').last().inputValue(),'SCIENCE','the new row must use the designation subject default');
        await a.locator('.teaching-row').last().locator('button',{hasText:'✕'}).click();
        await a.evaluate(() => saveTeacherDirect({ preventDefault() {} }));
        await b.waitForFunction(() => teachers.some(t => t.name === 'New Shared Teacher'));
        await a.locator('#faculty-completeness-popup').waitFor();
        assert.match(await a.locator('#faculty-completeness-popup').textContent(),/verified and saved successfully.*mapped class-subject assignment\(s\) remain incomplete/s);
        await a.locator('#faculty-completeness-popup button',{hasText:'Close'}).click();
        assert.equal(Object.values(data.teachers).length, 1);
        const savedFacultyId=await a.evaluate(()=>String(teachers[0].id));
        await a.evaluate(id=>editTeacher(id),savedFacultyId);
        assert.equal(await a.locator('.teaching-row').count(),1,'reopening a saved faculty record must restore every saved class row');
        assert.equal(await a.evaluate(()=>facultyAllotmentFingerprint([{cls:document.querySelector('.teaching-row .cls-sel').value,sec:document.querySelector('.teaching-row .sec-sel').value,subject:document.querySelector('.teaching-row .sub-sel').value,qpSetter:document.querySelector('.teaching-row .qp-sel').value,additionalQpSetter:document.querySelector('.teaching-row .qp-additional-sel').value,evaluator:document.querySelector('.teaching-row .eval-sel').value,additionalEvaluator:document.querySelector('.teaching-row .eval-additional-sel').value}])===facultyAllotmentFingerprint(teachers[0].allotments)),true,'reopened class rows must exactly match the confirmed faculty record');
        await a.evaluate(()=>resetTeacherForm());
        assert.equal(await a.locator('#tch-desig-input').getAttribute('list'),'faculty-designation-suggestions');
        assert.equal(await a.locator('#faculty-designation-suggestions option[value="PGT SCIENCE"]').count(),1,'previously entered designations must be available for quick selection');
        assert.equal(await a.locator('#faculty-designation-suggestions option[value="TGT-Maths"]').count(),1,'standard designation suggestions must remain available');
        await a.evaluate(async () => {
            teachers[0].allotments = [{ cls: '10', sec: 'A', subject: 'SCIENCE', qpSetter: 'Self', evaluator: 'Self' }];
            await saveData(['teachers']);
            renderTeachers();
            showFacultyCompletenessPopup();
        });
        assert.match(await a.locator('#faculty-completeness-popup').textContent(),/FINAL CONFIRMATION.*ALL ASSIGNMENTS COMPLETE.*All mapped classes and subjects/s);
        await a.locator('#faculty-completeness-popup button',{hasText:'Close'}).click();
        assert.deepEqual(await a.evaluate(() => sortedFacultyAllotments([
            {cls:'11',sec:'D',subject:'ENGLISH'}, {cls:'8',sec:'B',subject:'SCIENCE'},
            {cls:'11',sec:'A',subject:'ENGLISH'}, {cls:'6',sec:'A',subject:'SCIENCE'},
            {cls:'11',sec:'B',subject:'ENGLISH'}
        ]).map(item=>`${item.cls}-${item.sec}`)),['6-A','8-B','11-A','11-B','11-D']);
        assert.equal(await a.evaluate(() => facultyEvaluatorDisplay(teachers[0],teachers[0].allotments[0])),'New Shared Teacher');
        assert.deepEqual(await a.locator('#teacher-table-body').locator('xpath=..').locator('thead th').allTextContents(),['S.No.','Teacher Name & Desig','Teaching Allotments','QP Setter(s)','Evaluator','Booklets','Bundles','Actions']);
        assert.equal((await a.locator('#teacher-table-body .faculty-evaluator').first().innerText()).trim(),'New Shared Teacher');
        assert.equal((await a.locator('#teacher-table-body tr').first().locator('td').first().innerText()).trim(),'1');
        assert.doesNotMatch(await a.locator('#teacher-table-body tr').first().innerText(),/Seniority|Permanent ·|Contractual ·/,'category and seniority metadata must stay hidden in the roster');
        assert.equal((await a.locator('#faculty-roster-count').innerText()).trim(),'1 Faculty');
        assert.doesNotMatch(await a.locator('#teacher-table-body .faculty-qp-setter').first().innerText(),/Class X-A/);
        assert.match(await a.locator('#teacher-table-body .faculty-qp-setter').first().getAttribute('class'),/whitespace-nowrap/);
        assert.match(await a.locator('#teacher-table-body .faculty-duty-line').first().getAttribute('class'),/border-b/);
        assert.equal(await a.locator('#teacher-table-body .faculty-duty-line').first().locator(':scope > div').count(),3);
        assert.match(await a.locator('#teacher-table-body .faculty-teacher-name').first().getAttribute('class'),/whitespace-nowrap/);
        assert.doesNotMatch(await a.locator('#teacher-table-body').innerText(),/\bSelf\b/);
        console.log('PASS: faculty save is confirmed and appears on the other device');

        await a.evaluate(() => toggleFacultyRosterPublishing());
        await a.waitForFunction(() => publicPortalBoards.facultyRoster?.rows?.length === 1);
        await a.evaluate(() => renderPublicFacultyRoster());
        assert.doesNotMatch(await a.locator('#public-faculty-roster-section').getAttribute('class'),/(^|\s)hidden(\s|$)/);
        assert.equal(await a.locator('#public-faculty-select option').filter({hasText:'New Shared Teacher'}).count(),1);
        assert.match(await a.locator('#public-faculty-roster-section > div.max-h-56').getAttribute('class'),/overflow-y-auto/);
        await a.evaluate(() => {document.getElementById('public-faculty-search').value='science';renderPublicFacultyRoster();});
        assert.match(await a.locator('#public-faculty-roster-body').innerText(),/New Shared Teacher/);
        assert.deepEqual(await a.locator('#public-faculty-roster-section thead th').allTextContents(),['Faculty','Teaching Allotments / Strength','QP Setter(s)','Evaluator','Booklets','Bundles']);
        assert.match(await a.locator('#public-faculty-roster-body').innerText(),/0\s*Booklets\s*1\s*Bundle\(s\)/);
        assert.equal(await a.locator('#public-faculty-roster-section button', {hasText:'PDF / Print'}).count(),1);
        assert.equal(await a.locator('#public-faculty-roster-section button', {hasText:'Share PDF to WhatsApp'}).count(),1);
        assert.equal(await a.evaluate(async()=>new TextDecoder().decode((await publishedFacultyRosterPdfBlob().arrayBuffer()).slice(0,8))),'%PDF-1.4');
        const facultyPdfText=await a.evaluate(async()=>new TextDecoder().decode(await publishedFacultyRosterPdfBlob().arrayBuffer()));
        assert.match(facultyPdfText,/EXAMINATION CELL - FUNDAMENTAL EXAMINATION DUTIES & FACULTY ROSTER/);
        assert.match(facultyPdfText,/MediaBox \[0 0 842 595\]/);
        assert.match(facultyPdfText,/QP Setter.*Evaluator.*Booklets.*Bundles/s);
        await a.evaluate(()=>{window.__vemsPublicUpdateDecision='';teachers[0].desig='PGT SCIENCE UPDATED';});
        const liveFacultySave=a.evaluate(()=>saveData(['teachers']));
        await a.locator('#published-update-warning').waitFor();
        assert.match(await a.locator('#published-update-warning').innerText(),/Faculty Roster & Exam Duties/);
        await a.locator('#published-update-warning [data-choice="update"]').click();
        assert.equal(await liveFacultySave,true);
        await b.waitForFunction(()=>publicPortalBoards.facultyRoster?.rows?.[0]?.desig==='PGT SCIENCE UPDATED');
        await a.evaluate(async()=>{window.__vemsPublicUpdateDecision='update';teachers[0].desig='PGT SCIENCE';await saveData(['teachers']);});
        console.log('PASS: published faculty roster provides public dropdown, search and compact scrolling window');

        await a.evaluate(() => {resetTeacherForm();document.getElementById('teaching-allotments-container').innerHTML='';addTeachingRow('10','A','SCIENCE');window._facultyAlert=window.alert;window.facultyConflictAlert='';window.alert=message=>window.facultyConflictAlert=message;});
        await a.fill('#tch-name-input','Conflicting Teacher');
        await a.fill('#tch-desig-input','TGT SCIENCE');
        await a.evaluate(() => saveTeacherDirect({preventDefault(){}}));
        assert.match(await a.evaluate(() => window.facultyConflictAlert), /Faculty Allotment Conflict.*already assigned to New Shared Teacher/s);
        assert.equal(Object.values(data.teachers).length,1,'conflicting faculty allotment must not save');
        await a.evaluate(() => {window.alert=window._facultyAlert;delete window._facultyAlert;delete window.facultyConflictAlert;resetTeacherForm();});
        console.log('PASS: duplicate class-section-subject assignment to another teacher is blocked');

        await a.evaluate(() => {document.getElementById('teaching-allotments-container').innerHTML='';addTeachingRow('10','A','SCIENCE');});
        await a.fill('#tch-name-input','Second Science Teacher');
        assert.equal(await a.locator('.teaching-row label', {hasText:'Additional QP Setter (Optional)'}).count(),1);
        assert.deepEqual(await a.evaluate(()=>({differentSection:teacherHasStandardSubject({allotments:[{cls:'10',sec:'B',subject:'SCIENCE'}]},'10','SCIENCE'),differentStandard:teacherHasStandardSubject({allotments:[{cls:'11',sec:'A',subject:'SCIENCE'}]},'10','SCIENCE')})),{differentSection:true,differentStandard:false});
        assert.match(await a.evaluate(()=>{teachers.push({id:'other-standard',name:'Other Standard Science',desig:'PGT-Science',allotments:[{cls:'11',sec:'B',subject:'SCIENCE'}]});try{return getAdditionalEvaluatorOptionsHtml('','SCIENCE','10');}finally{teachers.pop();}}),/Priority 2.*Other Standard Science/s,'same-subject teachers from another standard must appear as second priority');
        const additionalOption=await a.locator('.teaching-row .qp-additional-sel option').filter({hasText:'New Shared Teacher'}).getAttribute('value');
        assert.ok(additionalOption);
        await a.selectOption('.teaching-row .qp-additional-sel',additionalOption);
        assert.equal(await a.locator('.teaching-row .qp-additional-sel').inputValue(),additionalOption);
        const additionalEvaluatorOption=await a.locator('.teaching-row .eval-additional-sel option').filter({hasText:'New Shared Teacher'}).getAttribute('value');
        assert.ok(additionalEvaluatorOption);
        assert.match(await a.evaluate(()=>{teachers.push({id:'emergency-test',name:'Emergency Employee',desig:'PGT-History',allotments:[]});try{return getAdditionalEvaluatorOptionsHtml('','SCIENCE','10');}finally{teachers.pop();}}),/Priority 3.*Emergency Employee.*PGT-History/s,'emergency evaluator options must include employees outside the relevant subject');
        await a.selectOption('.teaching-row .eval-additional-sel',additionalEvaluatorOption);
        assert.equal(await a.evaluate(id=>facultyEvaluatorDisplay({name:'Second Science Teacher'},{evaluator:'Self',additionalEvaluator:id}),additionalEvaluatorOption),'Second Science Teacher / New Shared Teacher');
        await a.evaluate(() => resetTeacherForm());
        console.log('PASS: same-subject teachers can be selected as additional QP setters and evaluators');

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

        await a.evaluate(() => { document.getElementById('faculty-completeness-popup')?.remove(); switchTab('teachers'); resetTeacherForm(); });
        assert.equal(await a.locator('.teaching-row').count(), 0, 'a new faculty record must not force a class or subject allotment');
        await a.fill('#tch-name-input', 'Support Faculty');
        await a.fill('#tch-desig-input', 'Office Assistant');
        await a.evaluate(() => saveTeacherDirect({ preventDefault() {} }));
        await b.waitForFunction(() => teachers.some(item => item.name === 'Support Faculty' && item.allotments.length === 0));
        await a.evaluate(() => { document.getElementById('faculty-completeness-popup')?.remove(); renderExamCoreTeam(); });
        const supportFacultyId = await a.evaluate(() => String(teachers.find(item => item.name === 'Support Faculty').id));
        await a.fill('#core-team-new-role', 'Examination Store Custodian');
        await a.getByRole('button', { name: '＋ Add Role' }).click();
        await a.waitForFunction(() => [...document.querySelectorAll('#core-team-role option')].some(option => option.textContent === 'Examination Store Custodian'));
        await a.selectOption('#core-team-faculty', supportFacultyId);
        await a.selectOption('#core-team-role', 'Examination Store Custodian');
        await a.getByRole('button', { name: '＋ Add Member' }).click();
        await b.waitForFunction(id => examCoreTeam[id]?.role === 'Examination Store Custodian' && examCoreTeam.__roles?.includes('Examination Store Custodian'), supportFacultyId);
        assert.deepEqual(await b.evaluate(() => resolvedCircularRecipients(['Examination Team Members'])), ['Support Faculty']);
        const sharedTeacherId=await a.evaluate(()=>String(teachers.find(item=>item.name==='New Shared Teacher').id));
        await a.selectOption('#core-team-faculty',sharedTeacherId);
        await a.selectOption('#core-team-role','Core Team Member');
        await a.getByRole('button',{name:'＋ Add Member'}).click();
        await a.evaluate(id=>moveExamCoreTeamMember(id,-1),sharedTeacherId);
        await a.waitForFunction(()=>coreTeamRows()[0]?.name==='New Shared Teacher');
        await a.getByRole('button',{name:'📢 Publish Team'}).click();
        await b.waitForFunction(()=>publicPortalBoards.coreTeam?.rows?.[0]?.name==='New Shared Teacher');
        await a.evaluate(()=>{publicVisiblePortalBoards=cloneData(publicPortalBoards);activateArea('public');renderPublicPortalBoards();});
        assert.deepEqual(await a.locator('#public-core-team-belt article b').allTextContents(),['New Shared Teacher','Support Faculty']);
        await a.evaluate(()=>activateArea('principal'));
        await a.getByRole('button',{name:'⛔ Stop Publishing Team'}).click();
        await b.waitForFunction(()=>!publicPortalBoards.coreTeam);
        console.log('PASS: core team order publishes as a public belt and can be stopped');
        await a.evaluate(async ({ supportId }) => {
            renderFacultyDisplayOrder();
            const main = document.querySelector(`.faculty-order-row[data-teacher-id="${teachers.find(item => item.name === 'New Shared Teacher').id}"]`);
            const support = document.querySelector(`.faculty-order-row[data-teacher-id="${supportId}"]`);
            main.querySelector('.faculty-order-category').value = 'PERMANENT'; main.querySelector('.faculty-order-number').value = '1';
            support.querySelector('.faculty-order-category').value = 'OTHER'; support.querySelector('.faculty-order-number').value = '2';
            await saveFacultyDisplayOrder();
        }, { supportId: supportFacultyId });
        await b.waitForFunction(() => teachers.find(item => item.name === 'New Shared Teacher')?.employmentCategory === 'PERMANENT');
        assert.deepEqual(await a.locator('#core-team-faculty option').allTextContents(), ['-- Select Faculty --','New Shared Teacher (PGT SCIENCE)','Support Faculty (Office Assistant)']);
        console.log('PASS: faculty without teaching allotments can join the separately managed core examination team');
        assert.deepEqual(await a.evaluate(() => sortFacultyForDisplay([
            {name:'Contract PGT',desig:'PGT-English',employmentCategory:'CONTRACTUAL',seniorityOrder:1},
            {name:'Permanent TGT',desig:'TGT-Maths',employmentCategory:'PERMANENT',seniorityOrder:1},
            {name:'Permanent PGT Two',desig:'PGT-Hindi',employmentCategory:'PERMANENT',seniorityOrder:2},
            {name:'Permanent PGT One',desig:'PGT-English',employmentCategory:'PERMANENT',seniorityOrder:1},
            {name:'Instructor',desig:'AI Instructor',employmentCategory:'INSTRUCTOR',seniorityOrder:1}
        ]).map(item=>item.name)),['Permanent PGT One','Contract PGT','Permanent TGT','Instructor','Permanent PGT Two']);
        console.log('PASS: one saved category and seniority rule controls faculty display order');
        assert.equal(await a.evaluate(() => finalFacultyRoster2026.length),50,'the final source must contain all 50 supplied Secondary roster positions');
        assert.equal(await a.evaluate(()=>isSecondSaturday('2026-11-14')),true,'the second Saturday must be detected automatically as a holiday warning');
        assert.equal(await a.evaluate(()=>examDurationLabel('08:30','11:00')),'2 Hours 30 Minutes','duration must be calculated from exam start and end times');
        assert.equal(await a.evaluate(()=>slotDurationMismatch({duration:'3 Hours',startTime:'09:30',overTime:'12:30'})),false);
        assert.equal(await a.evaluate(()=>slotDurationMismatch({duration:'3 Hours',startTime:'09:30',overTime:'11:30'})),true,'assigned duration must be checked against exam From-To');
        assert.deepEqual(await a.evaluate(()=>{const prior=datesheetDays;datesheetDays=[{id:1,paperSlots:[{slotId:1,duration:'3 Hours',repTime:'08:45'}]},{id:2,paperSlots:[{slotId:2,duration:'3 Hours',repTime:'08:45'}]}];try{return{id:examMasterTimingSlot().slotId,all:datesheetDays.flatMap(day=>day.paperSlots).map(slot=>slot.repTime)};}finally{datesheetDays=prior;}}),{id:1,all:['08:45','08:45']},'Day 1 Slot 1 must be the master timing template');
        assert.deepEqual(await a.evaluate(()=>{const prior=datesheetDays;datesheetDays=[{id:1,paperSlots:[{slotId:1,duration:'3 Hours',repTime:'08:45',readFrom:'09:15',readTo:'09:30',startTime:'09:30',overTime:'12:30'}]},{id:2,paperSlots:[{slotId:2,duration:'3 Hours',repTime:'08:00',readFrom:'08:15',readTo:'08:30',startTime:'08:30',overTime:'11:30'}]}];try{initializeMasterTimingDefaults();const child=datesheetDays[1].paperSlots[0];return{repTime:child.repTime,readFrom:child.readFrom,startTime:child.startTime,overTime:child.overTime,initialized:child.timingTemplateInitialized};}finally{datesheetDays=prior;}}),{repTime:'08:45',readFrom:'09:15',startTime:'09:30',overTime:'12:30',initialized:true},'existing uninitialized slots must receive Day 1 Slot 1 timings');
        assert.equal(await a.evaluate(()=>qpReadingRange({readFrom:'08:15',readTo:'08:30'})),'08:15–08:30','QP reading time must display a from-to range');
        assert.equal(await a.evaluate(()=>qpReadingRange({readTime:'08:15',startTime:'08:30'})),'08:15–08:30','older saved reading times must remain compatible');
        assert.match(await a.evaluate(()=>groupedDateSheetRowsHtml([{dateStr:'2026-11-12',cls:'10',selectedSections:['A'],subject:'ENGLISH',startTime:'08:30',overTime:'11:30'},{dateStr:'2026-11-12',cls:'12',selectedSections:['A'],subject:'PHYSICS',startTime:'08:30',overTime:'11:30'}])),/rowspan="2"/,'one date cell must group every paper scheduled on that day');
        assert.deepEqual(await a.evaluate(() => finalFacultyRoster2026.slice(-2).map(item=>({order:item.order,name:item.name,desig:item.desig,category:item.category}))),[{order:49,name:'MS. TAILYANG YASUNG',desig:'Special Educator',category:'CONTRACTUAL'},{order:50,name:'MS. ZEEME GIASING',desig:'Nurse',category:'CONTRACTUAL'}]);
        assert.deepEqual(await a.evaluate(() => {const priorTeachers=teachers,priorAssignments=classTeacherAssignments;teachers=[...new Set(classTeacherRoster2026.flatMap(([,ct,coCt])=>[ct[0],coCt[0]]))].map((name,index)=>({id:String(index),name,desig:'Approved Faculty'}));classTeacherAssignments={'10-A':{ct:'MANUAL CT',coCt:'MANUAL CO-CT',assignedOnDuty:'RELIEF'}};try{const result=mergeClassTeacherRoster2026();return{count:classTeacherRoster2026.length,unresolved:result.unresolved,manual:classTeacherAssignments['10-A'],sixD:classTeacherAssignments['6-D'],twelveE:classTeacherAssignments['12-E']};}finally{teachers=priorTeachers;classTeacherAssignments=priorAssignments;}}),{count:30,unresolved:[],manual:{ct:'MANUAL CT',coCt:'MANUAL CO-CT',assignedOnDuty:'RELIEF'},sixD:{ct:'AJAYKUMARCHAUBEY',coCt:'BIKASHJYOTIDAS',assignedOnDuty:''},twelveE:{ct:'MOHANSINGHRAJPUT',coCt:'PARAMVEERMEENA',assignedOnDuty:''}},'all 30 CT/Co-CT rows must resolve while preserving existing manual assignments');
        assert.deepEqual(await a.evaluate(() => {const prior=teachers;teachers=[{id:'existing-ipi',name:'PGT-Chemistry Vacant',desig:'Already Updated',allotments:[{cls:'12',sec:'A',subject:'CHEMISTRY'}]}];try{const match=matchFinalFacultyRecord(finalFacultyRoster2026.find(item=>item.order===16));return{id:match?.id,desig:match?.desig,allotments:match?.allotments?.length};}finally{teachers=prior;}}),{id:'existing-ipi',desig:'Already Updated',allotments:1},'vacant aliases must match existing records without replacing saved details');
        assert.deepEqual(await a.evaluate(() => {const prior=teachers,existing={id:'existing-ipi',name:'PGT-Chemistry Vacant',desig:'Custom Designation',employmentCategory:'OTHER',seniorityOrder:77,allotments:[{cls:'12',sec:'A',subject:'CHEMISTRY'}]};teachers=[existing];try{const result=mergeMissingFinalFaculty([finalFacultyRoster2026.find(item=>item.order===16)]);return{result,record:teachers[0],count:teachers.length};}finally{teachers=prior;}}),{result:{added:0,matched:1},record:{id:'existing-ipi',name:'PGT-Chemistry Vacant',desig:'Custom Designation',employmentCategory:'OTHER',seniorityOrder:77,allotments:[{cls:'12',sec:'A',subject:'CHEMISTRY'}]},count:1},'the one-time roster merge must leave every field of an existing record untouched');
        console.log('PASS: final faculty source matches aliases without duplicating or replacing existing records');

        await a.evaluate(() => { switchTab('config'); document.getElementById('cfg-class').value = '10'; updateCfgSections(); addNewSubjectField(); });
        await a.evaluate(() => toggleAddClassSectionPanel(true));
        assert.equal(await a.locator('#add-class-section-panel').isVisible(), true, 'class/section entry must open inline');
        await a.evaluate(() => toggleAddClassSectionPanel(false));
        await a.locator('.cfg-sub-input').last().fill('MATHS');
        await a.evaluate(() => saveSectionConfig({ preventDefault() {} }));
        await b.waitForFunction(() => sectionConfigs['10-A']?.includes('MATHS'));
        console.log('PASS: subject mappings synchronize');

        await a.locator('#cfg-subjects-container button[title="Move up"]').last().click();
        assert.deepEqual(await a.locator('.cfg-sub-input').evaluateAll(inputs=>inputs.map(input=>input.value)), ['MATHS','SCIENCE']);
        await a.evaluate(() => saveSectionConfig({ preventDefault() {} }));
        await b.waitForFunction(() => sectionConfigs['10-A']?.[0] === 'MATHS' && sectionConfigs['10-A']?.[1] === 'SCIENCE');
        assert.deepEqual(await a.evaluate(() => reorderedStudentSubjects({subjects:['SCIENCE','MATHS']},['SCIENCE','MATHS'],['MATHS','SCIENCE'],'10')), ['MATHS','SCIENCE']);
        console.log('PASS: subject cards reorder responsively and saved order controls CSV/data columns');

        assert.equal(await a.evaluate(() => getSectionStream('11', 'A')), 'Science');
        assert.equal(await a.evaluate(() => getSectionStream('11', 'C')), 'Commerce');
        assert.equal(await a.evaluate(() => getSectionStream('12', 'E')), 'Humanities');
        await a.evaluate(() => previewSubjectDirectoryPDF());
        assert.equal(await a.locator('#subject-directory-preview iframe').count(), 1);
        await a.evaluate(() => document.getElementById('subject-directory-preview').remove());
        await a.evaluate(() => publishSubjectDirectory());
        await b.waitForFunction(() => publishedSubjectDirectories.current?.sections?.['10-A']?.includes('MATHS'));
        await a.waitForFunction(() => document.getElementById('subject-publish-toggle')?.textContent.includes('Stop Publishing'));
        await b.evaluate(() => { switchPortalArea('public'); renderPublicSubjectDirectory(); });
        assert.deepEqual(await b.locator('#public-subject-class option').allTextContents(), ['All Classes','Class X']);
        await b.selectOption('#public-subject-class','10');
        assert.match(await b.locator('#public-subject-directory-body').innerText(), /Class X-A/);
        assert.equal(await b.locator('button[onclick="sharePublishedSubjectDirectory()"]', {hasText:'Share PDF'}).count(), 1);
        assert.equal(await b.evaluate(async()=>new TextDecoder().decode((await publishedSubjectDirectoryPdfBlob().arrayBuffer()).slice(0,8))), '%PDF-1.4');
        assert.match(await b.evaluate(async()=>new TextDecoder().decode(await publishedSubjectDirectoryPdfBlob().arrayBuffer())), /\(Class \/ Section\).*\(Subjects\)/s);
        await a.evaluate(() => {switchTab('config');document.getElementById('cfg-class').value='10';updateCfgSections();document.getElementById('cfg-section').value='A';loadSectionConfigDetails();});
        await a.locator('#cfg-subjects-container button[title="Move down"]').first().click();
        await a.evaluate(() => saveSectionConfig({preventDefault(){}}));
        await b.waitForFunction(() => publishedSubjectDirectories.current?.sections?.['10-A']?.[0]==='SCIENCE' && publishedSubjectDirectories.current?.sections?.['10-A']?.[1]==='MATHS');
        await b.evaluate(() => renderPublicSubjectDirectory());
        assert.match(await b.locator('#public-subject-directory-body').innerText(), /SCIENCE, MATHS/);
        console.log('PASS: stream rules, Subject Mapping PDF, publish and public directory synchronize');

        assert.deepEqual(await a.evaluate(() => rollDirectoryColumnPairs(Array.from({length:6},(_,index)=>({roll:index+1}))).map(pair=>[pair.leftNumber,pair.rightNumber])), [[1,4],[2,5],[3,6]]);
        console.log('PASS: roll-directory PDF completes the left column before continuing in the right column');

        await a.evaluate(async () => { sectionConfigs['10-B']=['SCIENCE']; await saveData(['sectionConfigs']); });
        await b.waitForFunction(() => Array.isArray(sectionConfigs['10-B']));
        await b.evaluate(() => { switchTab('students'); document.getElementById('filter-class').value='10'; handleClassChange(); document.getElementById('filter-section').value='B'; rememberStudentLocation(); filterStudents(); switchTab('students'); });
        assert.equal(await b.locator('#filter-section').inputValue(), 'B', 'same-tab rerender must retain the selected section');

        await a.evaluate(async () => { sectionConfigs['6-A']=['ENGLISH','HINDI','SANSKRIT','MATHS','SCIENCE','SOCIAL SCIENCE']; await saveData(['sectionConfigs']); switchTab('students'); });
        await a.selectOption('#filter-class','6');
        await a.selectOption('#filter-section','A');
        await a.evaluate(() => { window._originalAlert=window.alert; window.alert=message=>{window.csvValidationAlert=message;}; });
        await a.setInputFiles('#csv-file-input',{name:'class-6-a.csv',mimeType:'text/csv',buffer:Buffer.from('SNo,RollNo,StudentName,ENGLISH,HINDI,SANSKRIT,MATHS,SCIENCE,SOCIAL SCIENCE\n1,6101,Test Child,ENGLISH,HINDI,SANSKRIT,MATHS,SCIENCE,')});
        await a.waitForFunction(() => window.csvValidationAlert);
        assert.match(await a.evaluate(() => window.csvValidationAlert), /Empty subject cell.*SOCIAL SCIENCE/s);
        assert.equal(data.students?.['6']?.A, undefined, 'invalid VI-VIII CSV must not save');
        await a.evaluate(() => { window.alert=window._originalAlert; delete window._originalAlert; delete window.csvValidationAlert; });
        console.log('PASS: Classes VI-VIII reject CSV rows with an empty subject cell');

        await a.evaluate(async () => { sectionConfigs['9-A']=['SCIENCE','AI']; await saveData(['sectionConfigs']); switchTab('students'); initSelectors(); });
        await a.selectOption('#filter-class','9');
        await a.selectOption('#filter-section','A');
        await a.setInputFiles('#csv-file-input',{name:'class-9-a.csv',mimeType:'text/csv',buffer:Buffer.from('SNo,RollNo,StudentName,SCIENCE,AI\n1,9101,Dash Optional Child,SCIENCE,-\n2,9102,Blank Optional Child,SCIENCE,\n3,9103,Long Dash Optional Child,SCIENCE,—')});
        await a.waitForFunction(() => students.filter(student => String(student.class) === '9').length === 3);
        assert.deepEqual(Object.values(data.students['9'].A).map(student => student.subjects), [['SCIENCE','-'],['SCIENCE','-'],['SCIENCE','-']]);
        assert.equal(await a.evaluate(() => decodeCsvBuffer(new Uint8Array([0x97]).buffer)), '—', 'Excel Windows-1252 dash must decode correctly');
        assert.equal(await a.evaluate(() => studentTakesSubject(students.find(student => Number(student.roll) === 9101),'SCIENCE')), true);
        assert.equal(await a.evaluate(() => studentTakesSubject(students.find(student => Number(student.roll) === 9101),'AI')), false);
        assert.equal(await a.evaluate(() => examSlotCandidateCount({cls:'9',subject:'AI',selectedSections:['A']})), 0);
        assert.equal(await a.evaluate(() => seatingCandidates({datesheetSnapshot:[{dateStr:'2026-11-02',paperSlots:[{cls:'9',subject:'AI',selectedSections:['A']}]}]},'2026-11-02').candidates.length), 0);
        await a.evaluate(async () => { delete studentRecords['9']; await saveData(['students']); });
        console.log('PASS: Classes IX-XII accept optional blank subjects and exclude them from QP and seating counts');

        await a.evaluate(async () => { sectionConfigs['10-C']=['ENGLISH','HINDI','MATHS STANDARD','MATHS BASIC','SCIENCE','SOCIAL SCIENCE','AI']; await saveData(['sectionConfigs']); switchTab('students'); initSelectors(); });
        await a.selectOption('#filter-class','10');
        await a.selectOption('#filter-section','C');
        await a.evaluate(() => { window._mathAlert=window.alert;window.mathChoiceAlert='';window.alert=message=>window.mathChoiceAlert=message; });
        await a.setInputFiles('#csv-file-input',{name:'class-10-c.csv',mimeType:'text/csv',buffer:Buffer.from('SNo,RollNo,StudentName,ENGLISH,HINDI,MATHS STANDARD,MATHS BASIC,SCIENCE,SOCIAL SCIENCE,AI\n1,10101,No Maths Choice,ENGLISH,HINDI,-,—,SCIENCE,SOCIAL SCIENCE,AI')});
        await a.waitForFunction(() => window.mathChoiceAlert);
        assert.match(await a.evaluate(() => window.mathChoiceAlert), /Neither MATHS STANDARD nor MATHS BASIC.*must take one/s);
        assert.equal(data.students?.['10']?.C, undefined, 'student without either Mathematics option must not upload');
        assert.equal(await a.evaluate(() => validateMathematicsChoice(['MATHS STANDARD','MATHS BASIC'],['MATHS STANDARD','MATHS BASIC']).valid), false, 'both Mathematics choices must also be rejected');
        await a.evaluate(() => {window.mathChoiceAlert='';});
        await a.setInputFiles('#csv-file-input',{name:'class-10-c-missing-english.csv',mimeType:'text/csv',buffer:Buffer.from('SNo,RollNo,StudentName,ENGLISH,HINDI,MATHS STANDARD,MATHS BASIC,SCIENCE,SOCIAL SCIENCE,AI\n1,10102,No English Choice,-,HINDI,MATHS STANDARD,-,SCIENCE,SOCIAL SCIENCE,AI')});
        await a.waitForFunction(() => /Compulsory subject missing/.test(window.mathChoiceAlert));
        assert.match(await a.evaluate(() => window.mathChoiceAlert), /Required subject: ENGLISH/);
        assert.equal(data.students?.['10']?.C, undefined, 'student without a compulsory subject must not upload');
        await a.evaluate(() => {window.alert=window._mathAlert;delete window._mathAlert;delete window.mathChoiceAlert;document.getElementById('filter-section').value='B';rememberStudentLocation();filterStudents();});
        console.log('PASS: each student must select exactly one of Maths Standard or Maths Basic');

        const savedScrollPosition=await b.evaluate(async()=>{activateArea('principal');switchTab('students');const target=Math.min(360,Math.max(0,document.documentElement.scrollHeight-innerHeight));window.scrollTo(0,target);await new Promise(resolve=>setTimeout(resolve,100));saveWorkspacePositionNow();return Math.round(window.scrollY);});
        const savedScrollState=await b.evaluate(()=>localStorage.getItem('vems_workspace_state'));
        await b.reload();
        await login(b, 'principal2@example.test');
        assert.equal(await b.locator('#filter-section').inputValue(), 'B', 'reload must restore the selected section');
        await b.waitForTimeout(750);
        const restoredScrollPosition=await b.evaluate(()=>Math.round(window.scrollY));
        const restoredScrollState=await b.evaluate(()=>localStorage.getItem('vems_workspace_state'));
        assert.equal(Math.abs(restoredScrollPosition-savedScrollPosition)<=2,true,`reload must restore the same workspace scroll position (saved ${savedScrollPosition}, restored ${restoredScrollPosition}, before ${savedScrollState}, after ${restoredScrollState})`);
        await b.waitForFunction(() => teachers.some(t => t.name === 'New Shared Teacher'));
        console.log('PASS: shared records and the current class/section location survive rerender and reload');

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
        await a.evaluate(() => { window.duplicateRollAlert='';window._duplicateAlert=window.alert;window.alert=message=>window.duplicateRollAlert=message;openStudentModal(); });
        await a.fill('#stu-name', 'Duplicate Roll Student');
        await a.fill('#stu-roll', '101');
        await a.evaluate(() => saveStudent({ preventDefault() {} }));
        assert.match(await a.evaluate(() => duplicateRollAlert), /DUPLICATE ROLL NUMBER/);
        assert.equal(Object.values(data.students).flatMap(sections=>Object.values(sections)).flatMap(records=>Object.values(records)).filter(student=>Number(student.roll)===101).length, 1);
        await a.evaluate(() => {closeStudentModal();window.alert=window._duplicateAlert;delete window._duplicateAlert;delete window.duplicateRollAlert;});
        const studentId = Object.values(data.students).flatMap(sections=>Object.values(sections)).flatMap(records=>Object.values(records)).find(student=>student.name==='Test Student').id;
        await a.evaluate(id => deleteStudent(id), studentId);
        await b.waitForFunction(() => students.length === 0);
        console.log('PASS: student creation and deletion propagate, including an empty list');

        await a.evaluate(() => switchTab('exam-creator-prin'));
        assert.equal(await a.locator('#exam-creator-mount-prin button',{hasText:'Delete Vault'}).count(),1);
        await a.evaluate(() => openExamVault(100));
        await a.locator('#selected-exam-vault-workspace').waitFor();
        assert.match(await a.locator('#exam-creator-mount-prin h2').innerText(),/Existing Exam Examination Vault/);
        assert.equal(await a.locator('#exam-creator-mount-prin button',{hasText:'Open Pre-Exam Workspace'}).count(),1);
        assert.equal(await a.locator('#exam-creator-mount-prin button',{hasText:'Open During-Exam Workspace'}).count(),1);
        assert.equal(await a.locator('#exam-creator-mount-prin button',{hasText:'Open After-Exam Workspace'}).count(),1);
        assert.deepEqual(await a.locator('#selected-exam-vault-workspace span').filter({hasText:/^STAGE /}).allTextContents(), ['STAGE 1','STAGE 2','STAGE 3']);
        await a.evaluate(() => openLifecycleStage('during'));
        const emergencyEvaluatorSelect=a.locator('#lifecycle-stage-workspace table select').first();
        assert.deepEqual(await emergencyEvaluatorSelect.evaluate(select=>({groups:[...select.querySelectorAll('optgroup')].map(group=>group.label),matched:select.querySelectorAll('optgroup[label^="Priority 1"] option').length})),{groups:['Priority 1 — same standard & subject','Priority 3 — other employees / emergency'],matched:1},'same standard and subject teachers from any section must be listed first');
        const onSpotEvaluatorId=await emergencyEvaluatorSelect.locator('optgroup[label^="Priority 1"] option').first().getAttribute('value');
        await emergencyEvaluatorSelect.selectOption(onSpotEvaluatorId);
        await a.waitForFunction(()=>document.querySelector('#lifecycle-stage-workspace table tbody')?.textContent.includes('Assigned'));
        await b.waitForFunction(id=>Object.values(archivedExams).find(exam=>String(exam.id)===String(id))?.duringExamEvaluatorAssignments&&Object.keys(Object.values(archivedExams).find(exam=>String(exam.id)===String(id)).duringExamEvaluatorAssignments).length===1,100);
        assert.match(await a.locator('#lifecycle-stage-workspace table tbody').innerText(),/Assigned.*by principal/s);
        await a.evaluate(() => closeLifecycleStage());
        await a.evaluate(() => openPreExamFullPageWorkspace(100));
        await a.evaluate(() => switchPreExamSubTab('datesheet-orders'));
        assert.match(await a.locator('h3', { hasText: 'Date Sheet' }).textContent(), /Date Sheet/);
        assert.match(await a.locator('text=01/11/2026').first().textContent(), /01\/11\/2026/);
        assert.match(await a.locator('text=Sunday').first().textContent(), /Sunday/);
        assert.equal(await a.locator('text=Teacher Staff Room Office Order').count(), 0);
        await a.locator('button', { hasText: 'Preview & PDF' }).first().click();
        await a.locator('#date-sheet-preview iframe').waitFor();
        const dateSheetText = await a.locator('#date-sheet-preview iframe').contentFrame().locator('body').textContent();
        assert.match(dateSheetText, /Existing Exam/);
        assert.match(dateSheetText, /SCIENCE/);
        assert.match(dateSheetText, /From 01\/11\/2026 till 01\/11\/2026.*1 examination day/);
        await a.evaluate(() => document.getElementById('date-sheet-preview').remove());
        await a.locator('.datesheet-instruction-input').first().fill('Report 20 minutes before the examination.');
        await a.locator('button', { hasText: 'Add Instruction' }).click();
        await a.locator('.datesheet-instruction-input').last().fill('Carry the school identity card.');
        await a.waitForTimeout(100);
        await a.evaluate(() => saveDateSheetInstructions(true));
        assert.equal(data.dateSheetSettings.defaultInstructions[0], 'Report 20 minutes before the examination.');
        await a.locator('button', { hasText: 'Preview & PDF' }).last().click();
        const updatedDateSheetText = await a.locator('#date-sheet-preview iframe').contentFrame().locator('body').textContent();
        assert.match(updatedDateSheetText, /Report 20 minutes before/);
        await a.evaluate(() => { document.getElementById('date-sheet-preview').remove(); switchPreExamSubTab('qp-setters'); });
        const trackerKey = await a.evaluate(() => qpRecordKey(100, '10', 'SCIENCE'));
        const qpSourceSelect=a.locator('select[onchange^="saveExamQpSource"]').first();
        assert.deepEqual(await qpSourceSelect.locator('option').allTextContents(),['School / Internal — QP setter required','Regional Office (RO)','Headquarters (HQ)','CBSE','Other External Source']);
        await qpSourceSelect.selectOption('CBSE');
        await b.waitForFunction(key=>Object.values(archivedExams).find(exam=>String(exam.id)==='100')?.qpSources?.[key]==='CBSE',trackerKey);
        assert.match(await a.locator('select[onchange^="saveExamQpSource"]').first().locator('xpath=ancestor::tr').innerText(),/Not Required — External Paper.*CBSE/s);
        assert.deepEqual(await a.evaluate(()=>{const item=getExamSubjectsListForVault(100)[0];return{source:item.sourceCode,external:item.isExternal,setter:item.setterName};}),{source:'CBSE',external:true,setter:'Not Required — CBSE'});
        await a.locator('select[onchange^="saveExamQpSource"]').first().selectOption('INTERNAL');
        await b.waitForFunction(key=>Object.values(archivedExams).find(exam=>String(exam.id)==='100')?.qpSources?.[key]==='INTERNAL',trackerKey);
        await a.evaluate(key => toggleQpSubmissionTick(key, 'qpReceived'), trackerKey);
        await b.waitForFunction(key => qpSubmissionsTracker[key]?.qpReceived === true, trackerKey);
        await a.evaluate(() => switchPreExamSubTab('qp-receiving'));
        assert.match(await a.locator(`[id^="receiving-status-"]`).textContent(), /QP RECEIVED · MS NOT YET/);
        await a.locator(`[id^="ms-received-"]`).check();
        await a.waitForTimeout(100);
        await a.evaluate(() => renderExamCreatorModule());
        assert.equal(await a.locator(`[id^="qp-received-"]`).isChecked(), true);
        assert.equal(await a.locator(`[id^="ms-received-"]`).isChecked(), true);
        assert.match(await a.locator(`[id^="receiving-status-"]`).textContent(), /QP & MS RECEIVED/);
        await a.locator('button', { hasText: 'Save / Update' }).click();
        await b.waitForFunction(key => qpSubmissionsTracker[key]?.answerKeyReceived === true, trackerKey);
        assert.equal(await a.locator(`[id^="qp-received-"]`).isChecked(), true);
        assert.equal(await a.locator(`[id^="ms-received-"]`).isChecked(), true);
        await a.evaluate(() => switchPreExamSubTab('qp-printing'));
        assert.equal(await a.locator('select').last().isDisabled(), false);
        await a.evaluate(() => saveSubmissionDeadline('2026-11-05'));
        await b.waitForFunction(() => qpSubmissionDeadlines['100'] === '2026-11-05');
        await a.evaluate(key => updateQpPrintingStatus(key, 'Completed'), trackerKey);
        await b.waitForFunction(key => qpPrintingTracker[key] === 'Completed', trackerKey);
        assert.notEqual(await a.evaluate(() => qpRecordKey(100, '10', 'SCIENCE')), await a.evaluate(() => qpRecordKey(200, '10', 'SCIENCE')));
        console.log('PASS: exam-scoped QP submission, printing, and deadlines synchronize');

        await a.evaluate(async () => {
            studentRecords = { '10': { A: {
                seat1: { id: 'seat1', class: '10', section: 'A', roll: 1, name: 'Seat Student One' },
                seat2: { id: 'seat2', class: '10', section: 'A', roll: 2, name: 'Seat Student Two' },
                inactive1: { id: 'inactive1', class: '10', section: 'A', roll: 3, name: 'Transferred Student', active: false, deactivationReason: 'Transfer Certificate (TC)', deactivatedOn: '2026-10-22' }
            } } };
            await saveData(['students']);
            switchPreExamSubTab('seating');
        });
        assert.equal(await a.evaluate(() => seatingCandidates(archivedExams.find(ex=>ex.id===100),'2026-11-01').candidates.length), 2, 'inactive student must be excluded from seating');
        await a.evaluate(() => { switchTab('students'); showInactiveStudents(); });
        assert.match(await a.locator('#inactive-students-button').textContent(), /\(1\)/);
        assert.equal(await a.locator('#student-status-filter').inputValue(), 'inactive');
        assert.match(await a.locator('#student-status-results').innerText(), /INACTIVE/);
        await a.evaluate(() => { switchTab('exam-creator-prin'); openPreExamFullPageWorkspace(100); switchPreExamSubTab('seating'); });
        assert.match(await a.locator('#seating-examinee-store').innerText(),/0\/2 allocated/,'the Seating workspace must start from the unallocated Examinee Store');
        assert.match(await a.locator('#seating-examinee-store').innerText(),/Subject: SCIENCE/,'each Examinee Store box must show its scheduled subject');
        assert.match(await a.locator('#seating-room-layout').innerText(),/2\. Select rooms and enter the room layout/);
        assert.equal(await a.locator('#seating-add-classroom').count(),0,'mapped-room formulas and dropdowns must be removed');
        assert.equal(await a.getByRole('button',{name:/Add Open Area|Add Selected Room/}).count(),0,'special room commands must be removed');
        assert.equal(await a.evaluate(() => examActions.includes('addSeatingRoom')),false,'Add Room is a local draft action and must not be blocked by the Firebase write guard');
        assert.equal((await a.locator('#seating-remaining-room option').allTextContents()).includes('Classroom 10-A'),true,'remaining mapped classrooms must be available from a dropdown');
        await a.selectOption('#seating-remaining-room','10-A');
        await a.getByRole('button',{name:'+ Add Available Room',exact:true}).click();
        const classroomCard=a.locator('.seating-room-card').first();
        assert.equal(await classroomCard.locator('.seating-room-name').inputValue(),'Classroom 10-A');
        assert.equal((await a.locator('#seating-remaining-room option').allTextContents()).includes('Classroom 10-A'),false,'an added mapped classroom must leave the remaining-room list');
        await classroomCard.locator('.seating-room-columns').fill('6');
        await classroomCard.locator('.seating-room-desks').fill('7');
        assert.match(await classroomCard.innerText(),/42 desks · 84 seating/,'capacity must update while room dimensions are edited');
        await a.evaluate(() => acceptSharedValue('seatingRooms', cloneData(seatingRooms)));
        await a.waitForTimeout(100);
        assert.equal(await a.locator('.seating-room-card').first().locator('.seating-room-name').inputValue(),'Classroom 10-A','an incoming live seatingRooms refresh must not erase the local room-layout draft');
        assert.equal(await a.locator('.seating-room-card').first().locator('.seating-room-columns').inputValue(),'6','live synchronization must not reset draft room dimensions');
        await a.fill('#seating-custom-room-name','Library');
        await a.getByRole('button',{name:'+ Add Room',exact:true}).click();
        assert.equal(await a.locator('.seating-room-card').count(),2,'manually named rooms must be addable continuously');
        await a.locator('.seating-room-card').nth(1).getByRole('button',{name:'Remove'}).click();
        assert.equal(await a.locator('.seating-room-card').count(),1,'a manually added room must be removable');
        assert.equal(await a.locator('.seating-room-card').first().locator('.seating-room-columns').inputValue(),'6','room edits must survive add and remove renders');
        await a.fill('#seating-custom-room-name','');
        await a.getByRole('button',{name:'+ Add Room',exact:true}).click();
        assert.equal(await a.locator('.seating-room-card').count(),2,'Add Room must create a room even when the optional name field is blank');
        assert.equal(await a.locator('.seating-room-card').last().locator('.seating-room-name').inputValue(),'New Room 1');
        await a.locator('.seating-room-card').last().locator('.seating-room-name').fill('Library Annex');
        await a.getByRole('button',{name:/Save Room Layout/}).click();
        await a.getByRole('button',{name:/Edit Room Layout/}).waitFor();
        assert.equal(await a.locator('.seating-room-columns').first().isDisabled(),true,'saved room layouts must lock until Edit is selected');
        await a.evaluate(() => renderExamCreatorModule());
        assert.equal(await a.locator('.seating-room-card').filter({hasText:'Classroom 10-A'}).locator('.seating-room-columns').inputValue(),'6','saved room dimensions must remain stable after a refresh');
        assert.equal(await a.locator('#generated-seating-result').count(),0,'room layout must not generate a seating suggestion');
        console.log('PASS: room layout uses manual room names, supports removal and persists edited dimensions');

        await a.evaluate(() => switchPreExamSubTab('qp-setters'));
        await a.fill('#qp-order-number', 'KV1/EXAM/2026/01');
        await a.fill('#qp-order-deadline-at', '2026-11-04T15:30');
        await a.selectOption('#qp-order-method', "Email from the QP setter's personal secure email with Word file and PDF");
        await a.fill('#qp-order-email', 'examcell@example.test');
        const instructionInputs = a.locator('.qp-instruction-input');
        await instructionInputs.first().fill('Use the approved blueprint.');
        while (await instructionInputs.count() > 1) await instructionInputs.last().locator('xpath=..').locator('button').click();
        await a.locator('button', { hasText: 'Add Instruction' }).click();
        await instructionInputs.nth(1).fill('Submit both Word and PDF files.');
        await a.waitForTimeout(150);
        assert.equal(await instructionInputs.count(), 2, 'realtime refresh must not discard a newly added instruction row');
        assert.equal(await instructionInputs.nth(1).inputValue(), 'Submit both Word and PDF files.');
        await a.evaluate(() => renderExamCreatorModule());
        assert.equal(await a.locator('#qp-order-number').inputValue(), 'KV1/EXAM/2026/01');
        assert.equal(await a.locator('#qp-order-deadline-at').inputValue(), '2026-11-04T15:30');
        assert.equal(await a.locator('#qp-order-email').inputValue(), 'examcell@example.test');
        assert.equal(await a.locator('.qp-instruction-input').nth(1).inputValue(), 'Submit both Word and PDF files.');
        await a.evaluate(() => saveQpInstructionsAsDefault());
        assert.deepEqual(data.qpOfficeOrderSettings.defaultInstructions, ['Use the approved blueprint.', 'Submit both Word and PDF files.']);
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
        assert.match(previewText, /examcell@example.test/);
        assert.match(previewText, /Word and PDF files/);
        assert.match(previewText, /Use the approved blueprint/);
        assert.doesNotMatch(previewText, /Prepare the question paper strictly/);
        await a.evaluate(() => closeQpOfficeOrderPreview());
        console.log('PASS: issued QP office order auto-links setters, syncs, and opens an in-app A4 preview');

        const count = Object.values(data.archivedExams).length;
        await a.evaluate(() => {isPreExamFullPageOpen=false;activeLifecycleStage=null;isVaultOverviewOpen=false;return startNewExamSetup();});
        await b.waitForFunction(count => archivedExams.length === count + 1, count);
        const created = Object.values(data.archivedExams).find(exam => exam.id !== 100);
        await a.fill('#manual-exam-title', 'PB-1 Secondary Wing');
        await a.getByRole('button', { name: 'Apply' }).click();
        await a.waitForFunction(() => [...document.querySelectorAll('#exam-name-select option')].some(option => option.textContent === 'PB-1 Secondary Wing'));
        assert.equal(await a.locator('#exam-name-select option', { hasText: 'PB-1 Secondary Wing' }).count(), 1, 'a manually entered vault title must join the reusable dropdown');
        created.title = 'PB-1 Secondary Wing';
        assert.equal(await a.getByRole('button',{name:'➕ Add Day 2'}).count(),1);
        await a.evaluate(() => addNextDatesheetDay());
        assert.deepEqual(await a.evaluate(()=>{const seed=tentativeHolidaySeed2026(),prior=holidayCalendar;holidayCalendar={__breaks:seed.breaks};const warning=holidayName('2026-10-16');holidayCalendar=prior;return{holidays:Object.keys(seed.rows).length,pending:seed.pending.length,breaks:seed.breaks.length,warning,diwali:seed.rows['2026-11-08']};}),{holidays:22,pending:2,breaks:3,warning:'Autumn Break',diwali:{accountOf:'Diwali (Deepavali)',remark:'GH',source:'Tentative Holiday List 2026'}});
        await a.evaluate(async()=>{holidayCalendar={'2026-10-28':{accountOf:'Test Holiday',remark:'GH'},__tentative2026Seeded:true};await saveData(['holidayCalendar']);});
        await a.evaluate(()=>switchTab('holidays'));
        assert.match(await a.locator('#holiday-manager-mount h2').textContent(),/4\. Holiday Manager/);
        assert.deepEqual(await a.locator('#holiday-manager-mount thead').first().locator('th').allTextContents(),['S.No.','Date','Day','On Account Of','Remark','Edit']);
        assert.equal(await a.locator('#holiday-manager-mount h3',{hasText:'Monthly Holiday Calendar'}).count(),1,'Holiday Manager must show its own monthly holiday calendar');
        assert.equal(await a.locator('#holiday-manager-mount').evaluate(mount=>mount.lastElementChild?.lastElementChild?.querySelector('#holiday-publish-button')!==null),true,'holiday publishing control must be at the end of Holiday Manager');
        assert.equal(await a.locator('#holiday-manager-mount button',{hasText:'Edit'}).count(),1);
        assert.equal(await a.getByRole('button',{name:/Download CSV/}).count(),1);
        assert.equal(await a.evaluate(()=>parseHolidayCsvDate('26/10/2026')),'2026-10-26');
        await a.evaluate(()=>toggleHolidayPublishing());
        await a.waitForFunction(()=>publicPortalBoards.holidays?.rows?.some(row=>row.accountOf==='Test Holiday'));
        assert.equal(await a.evaluate(()=>holidayPublishedRows().some(row=>row.accountOf==='Sunday')&&holidayPublishedRows().some(row=>row.accountOf==='Second Saturday')),true,'weekly holidays must be generated for publishing and all holiday uses');
        assert.equal(await a.locator('#public-holiday-section').evaluate(element=>!element.classList.contains('hidden')),true,'published holidays must render on Public View');
        await a.evaluate(async()=>{const old=window.confirm;window.confirm=()=>true;try{await toggleHolidayCalendarLock();}finally{window.confirm=old;}});
        assert.equal(await a.locator('#holiday-date').isDisabled(),true,'locked holiday calendar must disable feeding');
        await a.evaluate(async()=>{const old=window.confirm;window.confirm=()=>true;try{await toggleHolidayCalendarLock();}finally{window.confirm=old;}switchTab('exam-creator-prin');});
        assert.equal(await a.evaluate(async()=>{const before=datesheetDays.find(day=>day.id===2).dateStr,old=window.confirm;window.confirm=()=>false;try{await updateExamDayDate(2,'2026-10-28');}finally{window.confirm=old;}return datesheetDays.find(day=>day.id===2).dateStr===before;}),true,'a cancelled holiday warning must keep the previous exam date');
        assert.equal(await a.evaluate(async()=>{const old=window.confirm;let confirmations=0;window.confirm=()=>{confirmations++;return true;};try{await updateExamDayDate(2,'2026-10-28');}finally{window.confirm=old;}return confirmations;}),2,'holiday override must require two confirmations');
        await b.waitForFunction(id => archivedExams.find(exam=>exam.id===id)?.datesheetSnapshot?.some(day=>day.dateStr==='2026-10-28'), created.id);
        assert.match(await a.evaluate(()=>datesheetDays.find(day=>day.dateStr==='2026-10-28').holidayOverride.reason),/administrative reasons/);
        assert.deepEqual(await a.evaluate(() => ({count:datesheetDays.length,added:datesheetDays.some(day=>day.dateStr==='2026-10-28')})), {count:2,added:true}, 'only explicitly selected examination dates should be added');
        assert.notEqual(await a.locator('.exam-day-card').nth(0).evaluate(el=>getComputedStyle(el).backgroundColor),await a.locator('.exam-day-card').nth(1).evaluate(el=>getComputedStyle(el).backgroundColor),'each examination day should have a distinct light background');
        assert.equal(await a.locator('.exam-day-card').nth(1).getByRole('button',{name:/Add Scheduled Paper Slot/}).count(),1);
        assert.equal(await a.locator('.exam-day-card').nth(1).evaluate(card=>{const header=card.firstElementChild,body=card.lastElementChild;return !header.textContent.includes('Save Day')&&body.lastElementChild.classList.contains('day-save-actions')&&body.lastElementChild.textContent.includes('Save Day');}),true,'Save Day must follow the final paper-slot area');
        assert.match(await a.evaluate(id => examPeriodSummary(archivedExams.find(exam=>exam.id===id)), created.id), /From .* till 28\/10\/2026.*2 examination days/);
        assert.equal(await a.evaluate(id => currentQpOfficeOrder(id).instructions[0], created.id), 'Use the approved blueprint.');
        await b.evaluate(id => loadArchivedExamToEdit(id), created.id);
        assert.equal(await b.evaluate(() => datesheetDays.length), 2);
        await b.evaluate(() => bindupAndSaveExamRecord());
        await b.locator('#selected-exam-vault-workspace').waitFor({state:'attached'});
        assert.deepEqual(await b.evaluate(() => ({id:selectedPreExamVaultId,open:isVaultOverviewOpen})), {id:created.id,open:true}, 'Save Vault & Continue must open the same vault');
        await a.evaluate(async ({id,title}) => {const oldConfirm=window.confirm,oldPrompt=window.prompt;window.confirm=()=>true;window.prompt=()=>title;try{await deleteArchivedExam(id);}finally{window.confirm=oldConfirm;window.prompt=oldPrompt;}}, {id:created.id,title:created.title});
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

        await a.evaluate(() => switchTab('settings'));
        await a.fill('#current-role-password','test-principal-passcode'); await a.fill('#new-role-password','NewPrincipalPass1!'); await a.fill('#confirm-role-password','NewPrincipalPass1!');
        await a.locator('button',{hasText:'Update Principal Passcode'}).click();
        await a.waitForFunction(() => document.getElementById('password-change-status').textContent.includes('successfully'));
        assert.equal(rolePasscodes.principal,'NewPrincipalPass1!');
        await a.evaluate(() => document.getElementById('password-change-status').textContent='');
        await a.fill('#current-role-password','NewPrincipalPass1!'); await a.fill('#new-role-password','test-principal-passcode'); await a.fill('#confirm-role-password','test-principal-passcode'); await a.locator('button',{hasText:'Update Principal Passcode'}).click();
        await a.waitForFunction(() => document.getElementById('password-change-status').textContent.includes('successfully'));
        console.log('PASS: signed-in role securely changes and re-verifies its own portal passcode');
        await a.evaluate(() => { document.getElementById('new-session-id').value='2027-28'; });
        await a.evaluate(() => createAcademicSession());
        await a.waitForFunction(() => selectedAcademicSession==='2027-28' && sharedStore?.ready);
        assert.deepEqual(await a.evaluate(() => ({sections:sectionConfigs,students,teachers,exams:archivedExams})), {sections:{},students:[],teachers:[],exams:[]}, 'new session must start empty');
        await a.evaluate(async()=>{sectionConfigs={'6-A':['ENGLISH']};await saveData(['sectionConfigs']);});
        assert.deepEqual(data['sessionData/2027-28/sectionConfigs'], {'6-A':['ENGLISH']});
        await a.evaluate(() => selectAcademicSession('2026-27'));
        await a.waitForFunction(() => selectedAcademicSession==='2026-27' && sharedStore?.ready);
        assert.equal(await a.evaluate(() => sectionConfigs['10-A'].includes('MATHS')), true, 'existing 2026-27 records must remain intact');
        await a.evaluate(() => selectAcademicSession('2027-28'));
        await a.waitForFunction(() => sharedStore?.ready && sectionConfigs['6-A']);
        await a.evaluate(() => freezeSelectedSession());
        await a.waitForFunction(() => isSelectedSessionFrozen());
        assert.equal(await a.evaluate(() => canEditSharedData('principal')), false, 'frozen session must be read-only');
        await a.evaluate(() => selectAcademicSession('2026-27'));
        await a.waitForFunction(() => sharedStore?.ready && selectedAcademicSession==='2026-27');
        console.log('PASS: academic sessions isolate records, preserve 2026-27 data and enforce frozen read-only state');

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
        assert.equal(await primary.locator('#exam-creator-mount-pri').getByRole('button', { name: '＋ Create New Examination Vault' }).count(), 1);
        await primary.evaluate(() => startNewExamSetup());
        await primary.evaluate(() => addPaperSlotToDay(1));
        const primaryId = await primary.evaluate(() => activeExamId);
        await b.waitForFunction(id => archivedExams.some(exam => exam.id === id && exam.datesheetSnapshot[0].paperSlots[0]?.cls === '1'), primaryId);
        await primary.evaluate(async id => {const exam=archivedExams.find(item=>item.id===id),oldConfirm=window.confirm,oldPrompt=window.prompt;window.confirm=()=>true;window.prompt=()=>exam.title;try{await deleteArchivedExam(id);}finally{window.confirm=oldConfirm;window.prompt=oldPrompt;}}, primaryId);
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
        console.log('Browser integration scenarios passed (Firebase contract double; no live writes).');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
