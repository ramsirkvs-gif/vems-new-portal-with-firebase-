const assert=require('node:assert/strict');
module.exports=async function(staff,visitor){
 await staff.evaluate(async()=>{const exam=archivedExams.find(e=>e.id===100);exam.datesheetSnapshot=[{id:1,dateStr:'2026-11-18',paperSlots:Array.from({length:40},(_,i)=>({slotId:i,cls:'11',subject:`PUBLISHED PAPER ${i}`,selectedSections:['A','B'],repTime:'09:00',readFrom:'09:15',readTo:'09:30',startTime:'09:30',overTime:'12:30',duration:'3 Hours',maxMarks:70}))}];dateSheetInstructions['100']=['Bring your admit card.'];await workflowDocumentAction('datesheet','publish',100,'');});
 await visitor.waitForFunction(()=>document.getElementById('public-date-sheet-content').textContent.includes('PUBLISHED PAPER 39'));
 assert.equal(await visitor.evaluate(()=>authorizedRole),null);assert.equal(await visitor.evaluate(()=>archivedExams.length),0);
 const section=visitor.locator('#public-date-sheet-section');assert.equal(await section.isVisible(),true);assert.equal(await section.locator('.public-export-button').count(),2);assert.match(await section.innerText(),/09:30–12:30/);assert.match(await section.locator('tbody tr').nth(2).innerText(),/PUBLISHED PAPER 2\t/);
 const pdf=await visitor.evaluate(async()=>{let blob;URL.createObjectURL=v=>{blob=v;return'blob:datesheet';};window.open=()=>{};document.querySelector('[onclick="previewPublishedDateSheetPdf()"]').click();return await blob.text();});
 assert.match(pdf,/EXAMINATION CELL - DATE SHEET/);assert.match(pdf,/PUBLISHED PAPER 39/);assert.match(pdf,/Bring your admit card/);assert.ok((pdf.match(/\/Type \/Page /g)||[]).length>1);require('node:fs').writeFileSync('/tmp/vems-public-datesheet.pdf',pdf);
 await visitor.evaluate(()=>{Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async p=>window.__dateSheetShare=p});});
 await section.getByRole('button',{name:'Share PDF to WhatsApp',exact:true}).click();assert.equal(await visitor.evaluate(()=>window.__dateSheetShare.files[0].text()),pdf);
 await staff.evaluate(()=>{archivedExams.find(e=>e.id===100).datesheetSnapshot[0].paperSlots[0].subject='UNPUBLISHED CHANGE';});assert.equal(await visitor.evaluate(()=>publishedDateSheetRows().some(r=>r.subject==='UNPUBLISHED CHANGE')),false);
 await staff.evaluate(()=>workflowDocumentAction('datesheet','stop',100,''));await visitor.waitForFunction(()=>!visiblePortalBoards().dateSheet);assert.equal(await visitor.evaluate(()=>publishedDateSheetPdfBlob()),null);
 console.log('PASS: public Date Sheet buttons export every published row to PDF and share the identical file without staff login; private edits and stopped publications stay excluded');
};
