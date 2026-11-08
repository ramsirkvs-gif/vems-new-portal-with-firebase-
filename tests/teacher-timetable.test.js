const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const P=require('../teacher-timetable.js'),data=require('../assets/teacher-timetable-2026-11-08.js');
const teacher={id:'t1',name:'MRS. E.T. ZIRDO',desig:'PGT-English',allotments:[{cls:'12',sec:'E',subject:'ENGLISH'}]};
const exam={id:7,title:'PT-1',datesheetSnapshot:[{dateStr:'2026-11-09',paperSlots:[{cls:'12',subject:'ENGLISH',selectedSections:['E'],repTime:'08:00',startTime:'08:30',overTime:'11:30'}]}]};
const occupied=[{date:'2026-11-09',room:{id:'r1',name:'Room 1'}}];
const plans={7:{'2026-11-09':{r1:{invigilators:['t1'],relieverId:'t2',reliefFrom:'11:20',reliefTo:'12:00'},stale:{invigilators:['deleted']}}}};
const split=s=>String(s).split(','),normalize=s=>String(s).toUpperCase();
test('source retains every uploaded staff/day row and all eight user-supplied periods',()=>{
 assert.equal(data.teachers.length,58);assert.equal(data.teachers.reduce((n,t)=>n+Object.keys(t.days).length,0),348);
 assert.equal(data.source,'Master_Teacher_Timetable_2026-11-08 (3).xlsx');assert.match(data.sha256,/^[a-f0-9]{64}$/);
 assert.deepEqual(data.periods.map(p=>[p.start,p.end]),[['08:20','09:00'],['09:00','09:40'],['09:40','10:20'],['10:20','11:00'],['11:30','12:10'],['12:10','12:50'],['12:50','13:30'],['13:30','14:10']]);
 assert.equal(data.teachers.find(t=>t.id==='3').days.MON[1],'12E');assert.equal(data.teachers.find(t=>t.id==='36').name,'MS. GOCHAM YAGOM');
});
test('school calendar weekdays are stable across timezones, leap dates and year rollover',()=>{
 assert.equal(P.dayKey('2026-11-09'),'MON');assert.equal(P.dayKey('2026-11-10'),'TUES');assert.equal(P.dayKey('2026-11-14'),'SAT');assert.equal(P.dayKey('2026-11-15'),'SUN');assert.equal(P.dayKey('2026-02-30'),'');assert.equal(P.dayKey('bad'),'');assert.equal(P.nextDate('2026-12-31'),'2027-01-01');
});
test('name matching ignores punctuation and honorifics but never guesses changed identities or serial numbers',()=>{
 assert.equal(P.resolve(data,{name:'E T ZIRDO'}).id,'3');assert.equal(P.resolve(data,{id:'36',name:'MR. JENLAN MONYAK'}),null);
 assert.equal(P.resolve(data,{id:'48',name:'MS. DAMIANG MEHA'}),null);assert.equal(P.resolve(data,{name:'MR. AVINASH SINGH'}),null);
 assert.equal(P.resolve(data,{id:'36',name:'MR. JENLAN MONYAK'},{36:{teacherName:'MR. JENLAN MONYAK',sourceId:'36'}}).name,'MS. GOCHAM YAGOM');
 assert.equal(P.resolve(data,teacher,{t1:{teacherName:teacher.name,sourceId:'none'}}),null);
 assert.equal(P.resolve(data,{id:'36',name:'Someone Else'},{36:{teacherName:'MR. JENLAN MONYAK',sourceId:'36'}}),null);
});
test('full reporting-to-finish interval separates affected classes from protected free periods',()=>{
 const w=P.fullWindow(exam,'2026-11-09'),r=P.compare(data,teacher,'2026-11-09',w.from,w.to);
 assert.deepEqual(w,{from:'08:00',to:'11:30'});assert.deepEqual(r.classes.map(p=>p.label),['II','IV']);assert.deepEqual(r.protectedFree.map(p=>p.label),['I','III']);assert.equal(r.classes[0].entry,'12E');
});
test('relief covers only entered times; partial overlap needs cover, boundaries and break do not',()=>{
 const r=P.compare(data,teacher,'2026-11-09','11:20','12:00');assert.deepEqual(r.classes.map(p=>p.label),['V']);
 assert.equal(P.compare(data,teacher,'2026-11-09','11:00','11:30').classes.length,0);
 assert.deepEqual(P.compare(data,teacher,'2026-11-09','09:40','10:20').protectedFree.map(p=>p.label),['III']);
 assert.deepEqual(P.compare(data,teacher,'2026-11-09','09:39','09:40').classes.map(p=>p.label),['II']);
});
test('missing teacher/day and incomplete or reversed times remain unknown, never available',()=>{
 assert.equal(P.compare(data,{name:'No Such Person'},'2026-11-09','08:00','12:00').known,false);
 assert.equal(P.compare(data,teacher,'2026-11-15','08:00','12:00').known,false);
 for(const[from,to]of[['','12:00'],['13:00','12:00'],['12:00','12:00'],['8:00','12:00'],['25:00','26:00']]){const r=P.compare(data,teacher,'2026-11-09',from,to);assert.equal(r.valid,false);assert.equal(r.classes.length,0);}
 assert.equal(P.fullWindow({...exam,datesheetSnapshot:[{dateStr:'2026-11-09',paperSlots:[{startTime:'08:30'}]}]},'2026-11-09').from,'');
});
test('duty report reads occupied rooms only, deduplicates same-room IDs and preserves relief window',()=>{
 const before=JSON.stringify(plans),rows=P.duties(exam,'2026-11-09',plans,occupied);assert.equal(rows.length,2);assert.equal(rows[0].teacherId,'t1');assert.equal(rows[1].from,'11:20');assert.equal(rows.some(r=>r.teacherId==='deleted'),false);assert.equal(JSON.stringify(plans),before);
 assert.equal(P.duties(exam,'2026-11-10',plans,occupied).length,0);
});
test('evaluation requests match flat datesheet papers and actual class/subject/section mapping',()=>{
 const owner={...teacher,allotments:[{cls:'12',sec:'E',subject:'ENGLISH',evaluator:'Evaluator Name',additionalEvaluator:'t3'},{cls:'12',sec:'D',subject:'ENGLISH'},{cls:'12',sec:'E',subject:'HINDI'}]},teachers=[owner,{id:'t2',name:'Evaluator Name'},{id:'t3',name:'Additional Evaluator'}];
 const rows=P.evaluationPapers(exam,'2026-11-09',teachers,split,normalize);assert.equal(rows.size,3);for(const id of ['t1','t2','t3'])assert.deepEqual([...rows.get(id)],['Class 12-E ENGLISH']);
});
test('next-day evaluation report exists even with no exam on that date, never jumps to the next exam day',()=>{
 const tomorrow=P.report(data,exam,'2026-11-10',[teacher],plans,occupied,{},split,normalize);assert.equal(tomorrow.length,1);assert.deepEqual(tomorrow[0].evaluation,['Class 12-E ENGLISH']);assert.equal(tomorrow[0].duties.length,0);
 assert.equal(P.report(data,exam,'2026-11-11',[teacher],plans,occupied,{},split,normalize).length,0);
 const today=P.report(data,exam,'2026-11-09',[teacher],plans,occupied,{},split,normalize);assert.deepEqual(today.find(t=>t.teacherId==='t1').nextEvaluation,['Class 12-E ENGLISH']);assert.equal(today.find(t=>t.teacherId==='t2').teacher,undefined);
});
function ui(){
 const ctx={TeacherTimetablePlanner:P,VEMSTeacherTimetable:data,Blob,Date,teachers:[teacher,{id:'t2',name:'Not in workbook'}],invigilationPlans:structuredClone(plans),circularSettings:{},publicPortalBoards:{},archivedExams:[structuredClone(exam)],authorizedRole:'principal',sharedStore:{pendingCount:0},occupiedInvigilationRooms:()=>occupied,coreTeamRows:()=>[],sortFacultyForDisplay:()=>ctx.teachers,allotmentSubjectParts:split,normalizedSubjectMatch:normalize,formatDateWithDay:String,escapeHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),jsArg:JSON.stringify,canEditSharedData:()=>true,saves:[],saveData:async(...args)=>{ctx.saves.push(args);return true;},renderExamCreatorModule(){},alert:s=>ctx.alerts.push(s),alerts:[],window:{open:url=>ctx.urls.push(url)},urls:[],URL:{createObjectURL:blob=>{ctx.blob=blob;return 'blob:report';},revokeObjectURL(){}},setTimeout(){}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../teacher-timetable-ui.js'),'utf8'),ctx);
 const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),start=source.indexOf('        function createPdfFromStreams('),end=source.indexOf('        function subjectDirectoryPdfBlob(',start);vm.runInContext(source.slice(start,end),ctx);return ctx;
}
test('selected teacher guidance includes full today TT, replacement classes and protected free periods',()=>{
 const c=ui(),html=c.timetableDutyBriefHtml(exam,'2026-11-09','t1','invigilator');assert.match(html,/Today’s timetable/);assert.match(html,/P-II 09:00–09:40: 12E/);assert.match(html,/P-I \(08:20–09:00\)/);assert.match(html,/no additional arrangement/);
 assert.match(c.timetableDutyBriefHtml(exam,'2026-11-09','t2','relieverId',{}),/availability cannot be confirmed/);
 assert.match(c.timetableDutyBriefHtml(exam,'2026-11-09','t1','relieverId',{}),/Enter valid duty/);
 c.authorizedRole=null;assert.equal(c.timetableDutyBriefHtml(exam,'2026-11-09','t1','invigilator'),'');assert.equal(c.timetableReportPanelHtml(exam,'2026-11-09'),'');
});
test('mapping edits are role checked, source checked and saved with a conflict baseline',async()=>{
 const c=ui();c.authorizedRole=null;assert.equal(await c.saveTimetableTeacherLink('t2','3'),false);assert.equal(c.saves.length,0);
 c.authorizedRole='sec-ic';assert.equal(await c.saveTimetableTeacherLink('t2','bad'),false);assert.equal(await c.saveTimetableTeacherLink('t2','3'),true);assert.equal(c.saves.length,1);assert.equal(c.saves[0][1].circularSettings[0].path.join('/'),'_teacherTimetableMatches');assert.equal(c.timetableMappings().t2.teacherName,'Not in workbook');
});
test('PDF contains correct day, duty clashes and evaluation-day requests with no data mutation',async()=>{
 const c=ui(),before=JSON.stringify([c.teachers,c.invigilationPlans,c.circularSettings]);const pdf=await c.timetableIcReportPdfBlob(exam,'2026-11-09').text();assert.match(pdf,/^%PDF-1.4/);assert.match(pdf,/12E/);assert.match(pdf,/P-III 09:40-10:20/);assert.match(pdf,/avoid all additional arrangements/);assert.match(pdf,/2026-11-10/);assert.match(pdf,/TT NOT LINKED/);
 const tomorrow=await c.timetableIcReportPdfBlob(exam,'2026-11-10').text();assert.match(tomorrow,/yesterday/);assert.match(tomorrow,/Class 12-E ENGLISH/);assert.equal(JSON.stringify([c.teachers,c.invigilationPlans,c.circularSettings]),before);
 c.printTimetableIcReport(7,'2026-11-10');assert.equal(c.urls.length,1);c.sharedStore.pendingCount=1;c.printTimetableIcReport(7,'2026-11-10');assert.equal(c.urls.length,1);c.authorizedRole=null;c.printTimetableIcReport(7,'2026-11-10');assert.equal(c.urls.length,1);
});
test('long timetable notes paginate without dropping the final text or corrupting PDF xrefs',async()=>{
 const c=ui();c.teachers[0]={...teacher,name:teacher.name};const long='COMBINED CLASS DETAILS '.repeat(600)+'END OF ORIGINAL NOTE';const clone=structuredClone(data);clone.teachers.find(t=>t.id==='3').days.MON[1]=long;c.VEMSTeacherTimetable=clone;
 const pdf=await c.timetableIcReportPdfBlob(exam,'2026-11-09').text();assert.match(pdf,/END OF ORIGINAL NOTE/);assert.ok((pdf.match(/\/Type \/Page /g)||[]).length>1);const offset=Number(pdf.match(/startxref\n(\d+)/)[1]);assert.equal(pdf.slice(offset,offset+4),'xref');
});

test('emergency evaluators receive following-day protection even without teaching allotments',()=>{
 const e=structuredClone(exam);e.datesheetSnapshot[0].id=11;e.datesheetSnapshot[0].paperSlots[0].slotId=22;e.duringExamEvaluatorAssignments={'11|22|E':{teacherId:'emergency'}};
 const rows=P.report(data,e,'2026-11-10',[teacher,{id:'emergency',name:'Emergency Teacher'}],plans,occupied,{},split,normalize);
 assert.deepEqual(rows.find(row=>row.teacherId==='emergency').evaluation,['Class 12-E ENGLISH (emergency evaluator)']);
});

test('confirmed name links become unknown after the supplied source changes',()=>{
 const mappings={t1:{teacherName:teacher.name,sourceId:'3',sourceName:teacher.name,sourceSha256:data.sha256}};
 assert.equal(P.resolve(data,teacher,mappings).id,'3');assert.equal(P.resolve({...data,sha256:'new-source'},teacher,mappings),null);
 const changed=structuredClone(data);changed.teachers.find(t=>t.id==='3').name='Changed Source Identity';assert.equal(P.resolve(changed,teacher,mappings),null);
});
test('daywise report includes core-team and recorded bundle collectors without inventing duty times',()=>{
 const c=ui();c.coreTeamRows=()=>[{teacherId:'core',role:'Exam IC'}];const e=structuredClone(exam);e.afterExamRecords={'2026-11-09':{collectionDuty:{r1:{teacherId:'collector'}}}};
 const rows=c.timetableReportRows(e,'2026-11-09');assert.equal(rows.find(r=>r.teacherId==='core').duties[0].role,'Core examination team: Exam IC');assert.equal(rows.find(r=>r.teacherId==='collector').duties[0].role,'Bundle collection');assert.equal(rows.find(r=>r.teacherId==='collector').duties[0].from,undefined);
 assert.equal(c.timetableReportRows(e,'2026-11-10').some(r=>r.teacherId==='core'),false);
});
