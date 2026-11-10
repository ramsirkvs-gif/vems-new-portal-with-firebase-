const assert=require('node:assert/strict');
module.exports=async function(staff,other){
 const messages=[];staff.on('dialog',dialog=>messages.push(dialog.message()));
 await staff.evaluate(async()=>{
  const date='2026-11-12',exam={id:990,title:'Subject Change Confirmation',datesheetSnapshot:[{id:1,dateStr:date,paperSlots:['MATHS STANDARD','MATHS BASIC'].map((subject,i)=>({slotId:i,cls:'10',subject,selectedSections:['B'],repTime:'09:00',startTime:'09:30',overTime:'12:30'}))}]};
  await sharedStore.save('sectionConfigs',{'10-B':['MATHS STANDARD','MATHS BASIC']});
  await sharedStore.save('students',{'10':{B:{change1:{id:'change1',sno:1,roll:10207,name:'Subject Test Student',class:'10',section:'B',subjects:['MATHS STANDARD','-'],active:true}}}});
  await sharedStore.save('archivedExams',{990:exam});
  const room={id:'r1',name:'Room 1',rows:2,desksPerRow:2,deskCount:4},source=seatingCandidates(exam,date),plan={date,examId:990,method:'auto',rooms:[room],assignments:allocateTwoPerDesk(source.candidates,[room]).assignments};
  await sharedStore.save('seatingPlans',{990:{[date]:plan}});
  await sharedStore.save('publicPortalBoards',{seating:{examId:990,examTitle:exam.title,plans:{[date]:seatingPublicationPlan(exam,date,plan)}},admitCards:{examId:990,examTitle:exam.title,candidates:admitCardPublicationRows(exam)}});
  switchTab('students');document.getElementById('filter-class').value='10';document.getElementById('filter-section').innerHTML='<option value="B">B</option>';document.getElementById('filter-section').value='B';openStudentModal('change1');
 });
 await staff.fill('#modal-sub-0','-');await staff.fill('#modal-sub-1','MATHS BASIC');
 await staff.locator('#student-form button[type="submit"]').click();
 await staff.waitForFunction(()=>!sharedStore.pendingCount&&document.getElementById('student-modal').classList.contains('hidden'));
 const receipt=messages.find(message=>message.startsWith('UPDATE CONFIRMED'));assert.ok(receipt,'the actual Save must show a completion receipt');assert.match(receipt,/All saves for this update have finished/);assert.match(receipt,/Seating arrangements: 1 saved day plan/);assert.match(receipt,/Published admit cards: updated and save confirmed/);
 await other.waitForFunction(()=>students.find(s=>s.id==='change1')?.subjects?.[1]==='MATHS BASIC');
 assert.equal(await other.evaluate(()=>seatingPlans['990']['2026-11-12'].assignments[0].subject),'MATHS BASIC');
 assert.equal(await other.evaluate(()=>publicPortalBoards.admitCards.candidates.find(s=>s.id==='change1').admitSchedule[0].subject),'MATHS BASIC');
 assert.equal(await staff.evaluate(()=>sharedStore.pendingCount),0);
 console.log('PASS: saving the student subject switch shows the detailed completion receipt only after Firebase saves, and another device confirms updated seating and admit-card subjects');
};
