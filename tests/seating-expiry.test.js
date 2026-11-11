const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const E=require('../seating-expiry.js');
const exam={id:7,title:'Preboard',datesheetSnapshot:[{dateStr:'2026-11-12',paperSlots:[{overTime:'10:30'},{overTime:'11:30'}]},{dateStr:'2026-11-13',paperSlots:[{overTime:'11:00'}]},{dateStr:'2026-11-16',paperSlots:[{overTime:'12:00'}]}]};
const iso=s=>Date.parse(s),before=iso('2026-11-12T11:29:59+05:30'),after=iso('2026-11-12T11:30:00+05:30');
const plan={rooms:[{id:'r1',name:'Room 1'}],assignments:[{studentId:'s1',name:'Candidate',roomId:'r1'}]};
function board(){return{seating:{examId:7,examTitle:'Preboard',plans:{'2026-11-12':E.planFor(exam,'2026-11-12',plan)}},notice:{heading:'Keep this notice'}};}
test('expiry uses the last paper end in IST, including a different UTC date',()=>{
 assert.equal(E.cutoffForExam(exam,'2026-11-12'),after);assert.equal(E.cutoff('2026-11-12',[{overTime:'00:15'}]),iso('2026-11-11T18:45:00Z'));assert.equal(E.cutoff('2026-02-30',[]),0);
});
test('missing/invalid legacy paper times fall back to end of the Indian calendar day',()=>{
 for(const slots of [[],[{}],[{overTime:'11:00'},{}],[{overTime:'25:00'}]])assert.equal(E.cutoff('2026-11-12',slots),iso('2026-11-13T00:00:00+05:30'));
});
test('public seating is visible up to the cutoff, then hidden exactly at the cutoff without mutating source records',()=>{
 const raw=board(),snapshot=JSON.stringify(raw);assert.equal(E.visible(raw,before),raw);assert.equal(E.visible(raw,after).seating,undefined);assert.equal(E.visible(raw,after).notice.heading,'Keep this notice');assert.equal(JSON.stringify(raw),snapshot);
});
test('future-day public seating survives cleanup of expired dates',()=>{
 const raw=board();raw.seating.plans['2026-11-13']=E.planFor(exam,'2026-11-13',plan);
 const filtered=E.visible(raw,after);assert.deepEqual(Object.keys(filtered.seating.plans),['2026-11-13']);
 const cleaned=E.maintenance(raw,[exam],after);assert.deepEqual(Object.keys(cleaned.seating.plans),['2026-11-13']);assert.equal(cleaned._seatingExpiredDays['7'].date,'2026-11-12');
});
test('legacy public feeds can use only their own published datesheet, or expire at midnight if absent',()=>{
 const raw={seating:{examId:7,plans:{'2026-11-12':plan}},dateSheet:{examId:7,rows:[{dateStr:'2026-11-12',overTime:'11:30'}]}};
 assert.equal(E.visible(raw,after).seating,undefined);raw.dateSheet.examId=8;assert.ok(E.visible(raw,after).seating);assert.equal(E.visible(raw,iso('2026-11-12T18:30:00Z')).seating,undefined);
});
test('connected maintenance upgrades legacy expiry and later removes only the public publication',()=>{
 const raw=board();delete raw.seating.plans['2026-11-12'].publicSeatingExpiresAt;const savedPrivate=JSON.stringify(plan),upgraded=E.maintenance(raw,[exam],before);assert.equal(upgraded.seating.plans['2026-11-12'].publicSeatingExpiresAt,new Date(after).toISOString());
 const cleaned=E.maintenance(upgraded,[exam],after);assert.equal(cleaned.seating,undefined);assert.equal(cleaned._seatingExpiredDays['7'].date,'2026-11-12');assert.equal(cleaned.notice.heading,'Keep this notice');assert.equal(JSON.stringify(plan),savedPrivate);assert.equal(E.maintenance(cleaned,[exam],after),cleaned);
});
test('reminder opens actual Day 2, follows the exam calendar over a weekend, and never publishes it',()=>{
 const raw=board(),snapshot=JSON.stringify(raw);let reminders=E.reminders(raw,[exam],after);assert.equal(reminders[0].day,2);assert.equal(reminders[0].nextDate,'2026-11-13');assert.equal(JSON.stringify(raw),snapshot);
 const fri={_seatingExpiredDays:{7:{date:'2026-11-13'}}};reminders=E.reminders(fri,[exam],iso('2026-11-13T11:00:00+05:30'));assert.equal(reminders[0].day,3);assert.equal(reminders[0].nextDate,'2026-11-16');
});
test('no popup before exam finish, after final day, for frozen vaults, or when the next day is already public',()=>{
 assert.equal(E.reminders(board(),[exam],before).length,0);assert.equal(E.reminders(board(),[{...exam,afterExamFrozen:true}],after).length,0);
 assert.equal(E.reminders({_seatingExpiredDays:{7:{date:'2026-11-16'}}},[exam],iso('2026-11-16T13:00:00+05:30')).length,0);
 const raw=board();raw.seating.plans['2026-11-13']=E.planFor(exam,'2026-11-13',plan);assert.equal(E.reminders(raw,[exam],after).length,0);
});
test('catch-up after an offline weekend prompts the first still-upcoming exam day',()=>{
 const raw=board(),now=iso('2026-11-14T10:00:00+05:30');assert.equal(E.reminders(raw,[exam],now)[0].nextDate,'2026-11-16');assert.equal(E.reminders(raw,[exam],now)[0].day,3);
});
test('schedule edits refresh expiry metadata rather than expiring an extended paper at the previous end',()=>{
 const changed=structuredClone(exam);changed.datesheetSnapshot[0].paperSlots[1].overTime='13:00';const updated=E.planFor(changed,'2026-11-12',board().seating.plans['2026-11-12']);assert.equal(updated.publicSeatingExpiresAt,'2026-11-12T07:30:00.000Z');assert.ok(E.visible({seating:{examId:7,plans:{'2026-11-12':updated}}},after).seating);
});
function runtime(){
 const c={Date:class extends Date{static now(){return after;}},Map,Set,console:{warn(){}},publicVisiblePortalBoards:board(),publicPortalBoards:board(),currentActiveRole:'principal',authorizedRole:'principal',selectedAcademicSession:'2026-27',DEFAULT_ACADEMIC_SESSION:'2026-27',systemSettings:{activeSession:'2026-27'},archivedExams:[exam],isSelectedSessionFrozen:()=>false,isExamIcMasterView:()=>false,renderPublicPortalBoards(){c.renders++;},renders:0,document:{getElementById:()=>null,hidden:true},sharedStore:{ready:true,connected:true,pendingCount:0,view:name=>name==='archivedExams'?{7:exam}:c.remote,save:async(...args)=>{c.calls.push(args);c.remote=args[1];}},remote:board(),calls:[],firebase:{auth:()=>({currentUser:{uid:'exam-ic'}})},localStorage:{getItem:()=>null,setItem(){}},setInterval(){},window:{addEventListener(){}}};
 vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../seating-expiry.js'),'utf8'),c);return c;
}
test('maintenance saves the confirmed store baseline, never pending local public-board drafts',async()=>{
 const c=runtime();c.publicPortalBoards.notice.heading='UNPUBLISHED DRAFT';await c.processSeatingPublicationExpiry();assert.equal(c.calls.length,1);assert.equal(c.calls[0][1].notice.heading,'Keep this notice');assert.equal(c.calls[0][1].seating,undefined);assert.equal(c.calls[0][3].seating.examId,7);assert.equal(c.calls[0][0],'publicPortalBoards');
});
test('anonymous/offline/frozen/pending/inactive-session clients never write cleanup records',async()=>{
 for(const mutate of [c=>c.authorizedRole=null,c=>c.sharedStore.connected=false,c=>c.sharedStore.pendingCount=1,c=>c.sharedStore.ready=false,c=>c.isSelectedSessionFrozen=()=>true,c=>c.isExamIcMasterView=()=>true,c=>c.selectedAcademicSession='2027-28']){const c=runtime();mutate(c);await c.processSeatingPublicationExpiry();assert.equal(c.calls.length,0);}
});
test('cleanup conflict is retried later and cannot remove a newly published day',async()=>{
 const c=runtime();c.sharedStore.save=async()=>{throw Error('Another device published next day');};await c.processSeatingPublicationExpiry();assert.ok(c.remote.seating.plans['2026-11-12']);assert.equal(c.filterPublicSeatingBoards(c.remote).seating,undefined);
});

test('unsaved local exam-time edits cannot change the cleanup cutoff',async()=>{const c=runtime();c.archivedExams=structuredClone([exam]);c.archivedExams[0].datesheetSnapshot[0].paperSlots.forEach(slot=>slot.overTime='23:59');await c.processSeatingPublicationExpiry();assert.equal(c.calls.length,1);assert.equal(c.calls[0][1].seating,undefined);});

test('saved public invigilation duty expires at last duty/relief end and keeps internal history untouched',()=>{
 const input={liveDuty:{examId:7,days:{'2026-11-12':{dutyWindow:'08:00–11:30',rooms:[{reliefTo:'11:40'}]},'2026-11-13':{dutyWindow:'08:00–11:00'}}},examDayFlow:{date:'2026-11-12',attendanceEnabled:true}},original=JSON.stringify(input);
 assert.ok(E.visible(input,after).liveDuty.days['2026-11-12']);
 const view=E.visible(input,iso('2026-11-12T11:40:00+05:30'));
 assert.equal(view.liveDuty.days['2026-11-12'],undefined);assert.ok(view.liveDuty.days['2026-11-13']);assert.deepEqual(view.examDayFlow,input.examDayFlow);assert.equal(JSON.stringify(input),original);
 assert.equal(E.dutyCutoff('2026-11-12',{dutyWindow:'missing'}),iso('2026-11-13T00:00:00+05:30'));
});
test('invigilation reminders use the next scheduled day across weekends and suppress already published duty',()=>{
 const now=iso('2026-11-13T11:01:00+05:30');
 assert.equal(E.dutyReminders({},[exam],before)[0].kind,'attendance');
 const next=E.dutyReminders({},[exam],now);assert.equal(next.length,1);assert.equal(next[0].date,'2026-11-16');assert.equal(next[0].kind,'publish');
 assert.equal(E.dutyReminders({liveDuty:{examId:7,days:{'2026-11-16':{}}}},[exam],now).length,0);
 assert.equal(E.dutyReminders({},[exam],iso('2026-11-16T12:01:00+05:30')).length,0);
});
