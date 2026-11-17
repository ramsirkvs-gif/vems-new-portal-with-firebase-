const assert = require('node:assert/strict');
module.exports = async ({ a, b, pageFor, login, setDenyWrites }) => {
    await a.evaluate(async () => {
        teachers = [{ id: 'eval-a', name: 'Evaluator A', desig: 'PGT-English', allotments: [{ cls: '10', sec: 'A', subject: 'ENGLISH', evaluator: 'Self' }] }, { id: 'eval-b', name: 'Evaluator B', desig: 'TGT-English', allotments: [{ cls: '10', sec: 'B', subject: 'ENGLISH', evaluator: 'Self' }] }];
        archivedExams[0].datesheetSnapshot = [{ dateStr: '2026-11-12', paperSlots: [{ cls: '10', subject: 'ENGLISH', selectedSections: ['A', 'B'] }] }];
        if (!await saveData(['teachers', 'archivedExams'])) throw Error('Fixture save failed');
        switchTab('evaluation-planning');
    });
    const area = a.locator('#sec-evaluation-planning');
    await a.locator('#tab-btn-evaluation-planning').click();
    await area.waitFor({ state: 'visible' });
    assert.equal(await area.locator('tbody tr').count(), 2);
    assert.match(await area.innerText(), /6 Primary faculty available/);
    assert.match(await area.innerText(), /Evaluator A/);
    assert.match(await area.innerText(), /Evaluator B/);
    const primaryId = await area.locator('[data-planning-field="checkerId"]').first().locator('option').filter({ hasText: 'ANIL KUMAR' }).getAttribute('value');
    for (let i = 0; i < 2; i++) {
        await area.locator('[data-planning-field="checkerId"]').nth(i).selectOption(primaryId);
        await area.locator('[data-planning-field="matcherId"]').nth(i).selectOption('eval-b');
    }
    assert.equal(await area.getByRole('button', { name: 'Publish Plan', exact: true }).isDisabled(), true);
    await area.getByRole('button', { name: 'Save Plan', exact: true }).click();
    await a.waitForFunction(() => !evaluationPlanningBusy && !evaluationPlanningDrafts.size);
    await b.waitForFunction(() => !!archivedExams[0]?.evaluationPlan?.savedAt);
    await area.getByRole('button', { name: 'Mark Reviewed by Principal', exact: true }).click();
    await a.waitForFunction(() => !evaluationPlanningBusy && !!archivedExams[0].evaluationPlan.reviewedAt);
    await area.getByRole('button', { name: 'Publish Plan', exact: true }).click();
    await a.waitForFunction(() => !evaluationPlanningBusy && !!publicPortalBoards.evaluationPlanning);
    const visitor = await pageFor({ mobile: true });
    await visitor.locator('#public-evaluation-planning-section').waitFor({ state: 'visible' });
    const publicPlan = visitor.locator('#public-evaluation-planning-section');
    assert.match(await publicPlan.innerText(), /ANIL KUMAR/);
    assert.match(await publicPlan.innerText(), /Reviewed by Principal/);
    assert.equal(await publicPlan.locator('select').count(), 0);
    await a.reload();
    await a.waitForFunction(() => portalGateReady === true);
    if (await a.locator('#portal-curtain').isVisible()) {
        await a.fill('#portal-curtain-password', 'kvs123');
        await a.locator('#portal-curtain button[type="submit"]').click();
    }
    await login(a, 'principal1@example.test');
    await a.locator('#tab-btn-evaluation-planning').click();
    assert.equal(await a.locator('[data-planning-field="checkerId"]').first().inputValue(), primaryId);
    await a.locator('[data-planning-field="checkerId"]').first().selectOption('eval-b');
    await area.getByRole('button', { name: 'Save Plan', exact: true }).click();
    await a.waitForFunction(() => !evaluationPlanningBusy && !evaluationPlanningDrafts.size);
    assert.match(await area.locator('tbody').innerText(), /Pending Principal review/);
    assert.match(await publicPlan.innerText(), /Reviewed by Principal/, 'saved edits do not silently change a published snapshot');
    setDenyWrites(true);
    await area.getByRole('button', { name: 'Publish / Update Plan', exact: true }).click();
    await a.waitForFunction(() => !evaluationPlanningBusy);
    assert.match(await publicPlan.innerText(), /Reviewed by Principal/, 'failed publication keeps the last confirmed public copy');
    setDenyWrites(false);
    await area.getByRole('button', { name: 'Publish / Update Plan', exact: true }).click();
    await visitor.waitForFunction(() => visiblePortalBoards().evaluationPlanning?.reviewed === false);
    await area.getByRole('button', { name: 'Stop Publishing', exact: true }).click();
    await visitor.waitForFunction(() => !visiblePortalBoards().evaluationPlanning);
    await publicPlan.waitFor({ state: 'hidden' });
    await b.evaluate(() => { authorizedRole = 'sec-ic'; });
    assert.equal(await b.evaluate(() => evaluationPlanningCanEdit()), false);
    console.log('PASS: item 6 auto-fills date sheet/evaluators, assigns Primary faculty, saves across devices/reload, reviews, publishes a read-only snapshot, preserves it on failed writes, and stops publishing');
};
