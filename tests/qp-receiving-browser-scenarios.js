const assert=require('node:assert/strict');
module.exports=async function(staff,visitor){
    await staff.evaluate(async()=>{
        const e=archivedExams.find(e=>e.id===100);
        e.datesheetSnapshot[0].paperSlots=['HINDI','IP','AI','MATHS'].map((subject,i)=>({slotId:i,cls:'11',subject,selectedSections:['A']}));
        const states=[[true,true],[true,false],[false,true],[false,false]];
        ['HINDI','IP','AI','MATHS'].forEach((subject,i)=>qpSubmissionsTracker[qpRecordKey(100,'11',subject)]={qpReceived:states[i][0],answerKeyReceived:states[i][1],privateNote:'NEVER PUBLISH THIS NOTE'});
        qpSubmissionsTracker[qpRecordKey(999,'12','SECRET PAPER')]={qpReceived:true,answerKeyReceived:true};
        await workflowDocumentAction('qp-receiving','publish',100,'');
    });
    await visitor.waitForFunction(()=>document.getElementById('public-qp-receiving-content').textContent.includes('MATHS'));
    assert.equal(await visitor.evaluate(()=>authorizedRole),null);
    assert.equal(await visitor.evaluate(()=>archivedExams.length),0,'public PDF must not need staff exam records');
    const section=visitor.locator('#public-qp-receiving-section');
    assert.equal(await section.isVisible(),true);assert.equal(await section.locator('.public-export-button').count(),2);
    assert.doesNotMatch(await section.innerText(),/SECRET PAPER|NEVER PUBLISH/);
    const pdf=await visitor.evaluate(async()=>{
        let blob;URL.createObjectURL=value=>{blob=value;return 'blob:qp-status';};window.open=()=>{};
        document.querySelector('[onclick="previewPublishedQpReceivingPdf()"]').click();return await blob.text();
    });
    assert.match(pdf,/QP RECEIVING STATUS/);for(const subject of ['HINDI','IP','AI','MATHS'])assert.ok(pdf.includes(`(${subject}) Tj`));assert.match(pdf,/Complete: 1 \| Pending: 3/);
    require('node:fs').writeFileSync('/tmp/vems-qp-receiving-status.pdf',pdf);
    await visitor.evaluate(()=>{
        Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
        Object.defineProperty(navigator,'share',{configurable:true,value:async value=>{window.__sharedQp=value;}});
    });
    await section.getByRole('button',{name:'Share PDF to WhatsApp',exact:true}).click();
    const shared=await visitor.evaluate(async()=>({type:window.__sharedQp.files[0].type,name:window.__sharedQp.files[0].name,pdf:await window.__sharedQp.files[0].text()}));
    assert.equal(shared.type,'application/pdf');assert.equal(shared.pdf,pdf);assert.match(shared.name,/QP-Receiving-Status/);
    await staff.evaluate(()=>{qpSubmissionsTracker[qpRecordKey(100,'11','HINDI')].answerKeyReceived=false;});
    assert.equal(await visitor.evaluate(()=>publishedQpReceivingRows()[0].answerKeyReceived),true,'unpublished private edits cannot leak into public exports');
    await staff.evaluate(()=>workflowDocumentAction('qp-receiving','stop',100,''));
    await visitor.waitForFunction(()=>!visiblePortalBoards().qpReceiving);
    assert.equal(await visitor.evaluate(()=>publishedQpReceivingPdfBlob()),null);
    console.log('PASS: anonymous public QP status renders snapshot rows and exports/shares identical PDFs; private drafts stay private and stop publishing removes exports');
};
