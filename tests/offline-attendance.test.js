const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function setup(){
    const exam={id:7,title:'PT-1',datesheetSnapshot:[{dateStr:'2026-11-04'},{dateStr:'2026-11-05'}]},date='2026-11-04';
    const assignments=Array.from({length:81},(_,i)=>({studentId:`s${i}`,roomId:i<80?'r1':'r2',roll:`RN${1000+i}`,name:`Candidate ${i}`,cls:'10',section:'A',desk:i}));
    const context={Blob,Set,selectedAcademicSession:'2026-27',seatingPlans:{7:{[date]:{rooms:[{id:'r1',name:'Room 1'},{id:'r2',name:'Room 2'},{id:'empty',name:'Empty Room'}],assignments},'2026-11-05':{rooms:[{id:'other',name:'Other Day'}],assignments:[{roomId:'other',studentId:'other',name:'Other Date Student',roll:'OTHER'}]}}},invigilationPlans:{7:{[date]:{r1:{invigilators:['t1']},r2:{invigilators:[]}}}},teachers:[{id:'t1',name:'Assigned Teacher'}],archivedExams:[exam],authorizedRole:'principal',formatClass:value=>String(value),formatDateWithDay:value=>value,examinationRoomName:value=>value,escapeHtml:value=>String(value).replace(/[<>&"]/g,'_'),jsArg:JSON.stringify,alerts:[],urls:[],document:{getElementById:()=>null},window:{open:()=>{}},URL:{createObjectURL:()=> 'blob:offline',revokeObjectURL:()=>{}},setTimeout:()=>{}};
    context.alert=message=>context.alerts.push(message);context.window.open=url=>context.urls.push(url);vm.createContext(context);
    for(const name of ['actualOccupiedRoomRows','occupiedInvigilationRooms','duringRoomInvigilatorNames','compareExamAttendanceCandidate','createPdfFromStreams','workflowSeatingReviewMessage','workflowSeatingReviewHtml','emergencyOfflineAttendanceRooms','emergencyOfflineAttendancePdfBlob','printEmergencyOfflineAttendance','openEmergencyOfflineAttendancePrint','emergencyOfflineAttendanceSection']){
        const start=source.indexOf(`        function ${name}(`);assert(start>=0,name);const next=/^        (?:async )?function /gm;next.lastIndex=start+20;const end=next.exec(source)?.index||source.length;vm.runInContext(source.slice(start,end),context);
    }
    return {context,exam,date};
}
test('offline room sheets use actual occupied rooms for the selected day and saved invigilators',()=>{
    const {context:c,exam,date}=setup(),rooms=c.emergencyOfflineAttendanceRooms(exam,date);
    assert.equal(rooms.length,2);assert.equal(rooms[0].invigilators[0],'Assigned Teacher');assert.equal(rooms[0].assignments.length,80);
    assert.equal(c.emergencyOfflineAttendanceRooms(exam,'2026-11-06').length,0);
    const html=c.emergencyOfflineAttendanceSection(exam,date);assert.match(html,/2 occupied room\(s\) · 81 students/);assert.doesNotMatch(html,/Empty Room|Other Day/);
});
test('PDF has every candidate once, blank pen boxes, repeated continuation headings and no online mutations',async()=>{
    const {context:c,exam,date}=setup(),before=JSON.stringify({exam,seating:c.seatingPlans,duties:c.invigilationPlans});
    const pdf=await c.emergencyOfflineAttendancePdfBlob(exam,date).text();assert.match(pdf,/^%PDF-1.4/);assert.ok(pdf.includes('Room 1 \\(continued\\)'),'large rooms continue with repeated room headings');assert.match(pdf,/Assigned Teacher/);assert.match(pdf,/Not assigned/);assert.doesNotMatch(pdf,/Other Date Student|Empty Room/);
    for(let i=0;i<81;i++)assert.equal(pdf.split(`(RN${1000+i}) Tj`).length-1,1,`candidate ${i} exactly once`);
    assert.equal((pdf.match(/10 10 re S/g)||[]).length,162,'two unfilled boxes for each candidate');
    assert.equal(JSON.stringify({exam,seating:c.seatingPlans,duties:c.invigilationPlans}),before);assert.match(pdf,/Paper backup only/);
});
test('print works without network or Firebase and is restricted to exam-team roles',()=>{
    const {context:c,exam,date}=setup();c.navigator={onLine:false};c.printEmergencyOfflineAttendance(exam.id,date);assert.equal(c.urls.length,1);
    c.authorizedRole=null;c.printEmergencyOfflineAttendance(exam.id,date);assert.equal(c.urls.length,1);assert.match(c.alerts[0],/Sign in/);
});
test('missing seating produces no PDF and an actionable message',()=>{
    const {context:c,exam}=setup();assert.equal(c.emergencyOfflineAttendancePdfBlob(exam,'2026-11-06'),null);c.printEmergencyOfflineAttendance(exam.id,'2026-11-06');assert.match(c.alerts[0],/Save the seating arrangement/);assert.equal(c.urls.length,0);
});

test('small room lists share a page to reduce paper without mixing room headings',async()=>{
    const {context:c,exam,date}=setup(),plan=c.seatingPlans[7][date];
    plan.assignments=plan.assignments.filter((row,index)=>index<20||index===80);
    const pdf=await c.emergencyOfflineAttendancePdfBlob(exam,date).text();assert.match(pdf,/\/Count 1\b/);assert.match(pdf,/Room 1/);assert.match(pdf,/Room 2/);
});

test('single-room export excludes every other occupied room and invalid rooms cannot print',async()=>{
    const {context:c,exam,date}=setup();const pdf=await c.emergencyOfflineAttendancePdfBlob(exam,date,'r2').text();
    assert.match(pdf,/Room 2/);assert.match(pdf,/RN1080/);assert.doesNotMatch(pdf,/Room 1|RN1000|Assigned Teacher/);
    assert.equal(c.emergencyOfflineAttendancePdfBlob(exam,date,'empty'),null);
    assert.equal(c.emergencyOfflineAttendancePdfBlob(exam,date,'missing'),null);
    c.printEmergencyOfflineAttendance(exam.id,date,'r2');assert.equal(c.urls.length,1);
});
test('print chooser offers all rooms and only occupied classrooms from the selected date',()=>{
    const {context:c,exam,date}=setup();let modal;
    c.document={getElementById:id=>id==='emergency-attendance-room'?{focus(){}}:null,createElement:()=>({setAttribute(){}}),body:{appendChild:node=>{modal=node;}}};
    c.openEmergencyOfflineAttendancePrint(exam.id,date);
    assert.match(modal.innerHTML,/All Occupied Rooms \(2\)/);
    assert.match(modal.innerHTML,/value="r1"/);assert.match(modal.innerHTML,/value="r2"/);
    assert.doesNotMatch(modal.innerHTML,/Empty Room|Other Day|value="empty"/);
});
