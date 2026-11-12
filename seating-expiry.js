/* Recurring checks run in the portal. Public expiry is enforced even without a staff session. */
const SeatingExpiry = (() => {
    const rows=value=>Array.isArray(value)?value:Object.values(value || {});
    const copy=value=>JSON.parse(JSON.stringify(value));
    function validDate(date){if(!/^\d{4}-\d{2}-\d{2}$/.test(date || ''))return false;const ms=Date.parse(date+'T00:00:00Z');return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===date;}
    function cutoff(date,slots=[]){
        if(!validDate(date))return 0;
        const ends=rows(slots).map(slot=>slot.overTime || slot.endTime || '');
        // Missing legacy timing must never hide an ongoing paper early.
        if(!ends.length || ends.some(end=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(end)))return Date.parse(date+'T00:00:00+05:30')+86400000;
        return Date.parse(`${date}T${ends.sort().at(-1)}:00+05:30`);
    }
    function cutoffForExam(exam,date){return cutoff(date,rows(exam?.datesheetSnapshot).find(day=>day.dateStr===date)?.paperSlots);}
    function cutoffForPublished(board,date,plan,boards={}){
        if(!validDate(date))return 0;
        const explicit=Date.parse(plan?.publicSeatingExpiresAt || '');
        if(Number.isFinite(explicit))return Math.min(explicit,cutoff(date,[]));
        const schedule=String(boards.dateSheet?.examId)===String(board?.examId)?rows(boards.dateSheet.rows).filter(row=>(row.dateStr || row.date)===date):[];
        return cutoff(date,schedule);
    }
    function planFor(exam,date,plan){return {...copy(plan),publicSeatingExpiresAt:new Date(cutoffForExam(exam,date)).toISOString()};}
    function dutyCutoff(date,day){
        if(!validDate(date))return 0;
        const explicit=Date.parse(day?.dutyExpiresAt || '');
        if(Number.isFinite(explicit))return Math.min(explicit,cutoff(date,[]));
        const end=String(day?.dutyWindow || '').match(/(\d{2}:\d{2})\s*$/)?.[1];
        const ends=[end,...rows(day?.rooms).map(room=>room.reliefTo).filter(Boolean)];
        return cutoff(date,ends.map(overTime=>({overTime})));
    }
    function visibleDuty(boards,now){
        const board=boards?.liveDuty;if(!board)return boards;
        const days=Object.fromEntries(Object.entries(board.days || {}).filter(([date,day])=>now<dutyCutoff(date,day)));
        if(Object.keys(days).length===Object.keys(board.days || {}).length)return boards;
        const next={...boards};if(Object.keys(days).length)next.liveDuty={...board,days};else delete next.liveDuty;
        return next;
    }
    function dutyReminders(boards,exams,now){
        const today=new Date(now+19800000).toISOString().slice(0,10),result=[];
        for(const exam of exams){
            if(exam.mockPractice?.active)continue;
            const dates=rows(exam.datesheetSnapshot).map(d=>d.dateStr).filter(validDate).sort();
            const starts=rows(rows(exam.datesheetSnapshot).find(day=>day.dateStr===today)?.paperSlots).map(slot=>slot.startTime).filter(time=>/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '')).sort();
            const attendanceEnd=starts.length?Date.parse(`${today}T${starts[0]}:00+05:30`)+3600000:0;
            if(dates.includes(today)&&now<attendanceEnd)result.push({examId:String(exam.id),examTitle:exam.title,date:today,kind:'attendance'});
            const completed=dates.filter(date=>cutoffForExam(exam,date)<=now).at(-1),nextDate=completed&&dates.find(date=>date>completed);
            if(completed===today&&nextDate&&cutoffForExam(exam,nextDate)>now&&!(String(boards.liveDuty?.examId)===String(exam.id)&&boards.liveDuty?.days?.[nextDate]))result.push({examId:String(exam.id),examTitle:exam.title,date:nextDate,kind:'publish'});
        }
        return result;
    }
    function visible(boards,now){
        boards=visibleDuty(boards,now);
        const board=boards?.seating;if(!board)return boards;
        const plans=Object.fromEntries(Object.entries(board.plans || {}).filter(([date,plan])=>now<cutoffForPublished(board,date,plan,boards)));
        if(Object.keys(plans).length===Object.keys(board.plans || {}).length)return boards;
        const next={...boards};if(Object.keys(plans).length)next.seating={...board,plans};else delete next.seating;
        return next;
    }
    function maintenance(boards,exams,now){
        const board=boards.seating;if(!board)return boards;
        const exam=exams.find(item=>String(item.id)===String(board.examId)),plans={},expired=[];
        for(const[date,plan]of Object.entries(board.plans || {})){
            const dated=rows(exam?.datesheetSnapshot).some(day=>day.dateStr===date);
            const expiry=dated?cutoffForExam(exam,date):cutoffForPublished(board,date,plan,boards);
            if(now>=expiry)expired.push(date);
            else plans[date]=dated?planFor(exam,date,plan):copy(plan);
        }
        const next={...boards};if(Object.keys(plans).length)next.seating={...board,plans};else delete next.seating;
        if(expired.length){
            const date=expired.sort().at(-1),key=String(board.examId),previous=boards._seatingExpiredDays?.[key];
            next._seatingExpiredDays={...(boards._seatingExpiredDays || {}),[key]:previous?.date>date?previous:{date,examTitle:board.examTitle || exam?.title || 'Examination',expiredAt:new Date(now).toISOString()}};
        }
        return JSON.stringify(next)===JSON.stringify(boards)?boards:next;
    }
    function reminders(boards,exams,now){
        const history={...(boards._seatingExpiredDays || {})},board=boards.seating;
        // Generate the prompt even if a cleanup write is waiting for connectivity.
        if(board)for(const[date,plan]of Object.entries(board.plans || {})){
            const exam=exams.find(item=>String(item.id)===String(board.examId)),expiry=exam?cutoffForExam(exam,date):cutoffForPublished(board,date,plan,boards),key=String(board.examId);
            if(now>=expiry && (!history[key] || history[key].date<date))history[key]={date};
        }
        const live=visible(boards,now),result=[];
        for(const[examId,entry]of Object.entries(history)){
            const exam=exams.find(item=>String(item.id)===examId);if(!exam || exam.afterExamFrozen)continue;
            const dates=[...new Set(rows(exam.datesheetSnapshot).map(day=>day.dateStr).filter(validDate))].sort(),completed=dates.indexOf(entry.date);
            if(completed<0 || now<cutoffForExam(exam,entry.date))continue;
            const next=dates.find((date,index)=>index>completed && now<cutoffForExam(exam,date));if(!next)continue;
            if(String(live.seating?.examId)===examId && live.seating.plans?.[next])continue;
            result.push({examId,examTitle:exam.title || entry.examTitle || 'Examination',completedDate:entry.date,nextDate:next,day:dates.indexOf(next)+1});
        }
        return result.sort((a,b)=>a.nextDate.localeCompare(b.nextDate));
    }
    return {dutyCutoff,visibleDuty,dutyReminders,validDate,cutoff,cutoffForExam,cutoffForPublished,planFor,visible,maintenance,reminders};
})();
let seatingServerClockOffset=0,seatingExpiryBusy=false,seatingExpiryLastAttempt=0,seatingExpiryLastView='';
const seatingReminderMemory=new Map();
function seatingExpiryNow(){return Date.now()+seatingServerClockOffset;}
function seatingViewSignature(boards){return JSON.stringify([currentActiveRole,boards.seating?.examId,Object.keys(boards.seating?.plans || {}),boards.liveDuty?.examId,Object.keys(boards.liveDuty?.days || {})]);}
function filterPublicSeatingBoards(boards){return SeatingExpiry.visible(boards,seatingExpiryNow());}
function seatingPublicationPlan(exam,date,plan){return SeatingExpiry.planFor(exam,date,plan);}
function seatingReminderKey(item){const uid=firebase.auth().currentUser?.uid || authorizedRole;return `vems_seating_reminder_${uid}_${selectedAcademicSession}_${item.examId}_${item.nextDate}`;}
function seatingReminderDue(item,now){const key=seatingReminderKey(item);let until=seatingReminderMemory.get(key) || 0;try{until=Math.max(until,Number(localStorage.getItem(key)) || 0);}catch(error){}return now>=until;}
function dismissNextSeatingReminder(item,open=false){
    const until=seatingExpiryNow()+15*60*1000,key=seatingReminderKey(item);seatingReminderMemory.set(key,until);try{localStorage.setItem(key,String(until));}catch(error){}
    document.getElementById('next-seating-publication-reminder')?.remove();
    if(open && ['principal','sec-ic','pri-ic'].includes(authorizedRole)){
        selectedSeatingDate=item.nextDate;selectedInvigilationDate=item.nextDate;
        activePreExamSubTab='seating';localStorage.setItem('vems_pre_exam_tab','seating');
        openPreExamFullPageWorkspace(archivedExams.find(exam=>String(exam.id)===item.examId)?.id);
    }
}
function showNextSeatingReminder(boards,now){
    const existing=document.getElementById('next-seating-publication-reminder');
    if(!['principal','sec-ic','pri-ic'].includes(authorizedRole) || currentActiveRole==='public' || selectedAcademicSession!==(systemSettings.activeSession || DEFAULT_ACADEMIC_SESSION) || isSelectedSessionFrozen()){existing?.remove();return;}
    const candidates=SeatingExpiry.reminders(boards,archivedExams,now);
    if(existing){if(!candidates.some(item=>item.examId===existing.dataset.examId&&item.nextDate===existing.dataset.nextDate))existing.remove();else return;}
    if(document.hidden || document.activeElement?.matches('input,textarea,select') || document.querySelector('[role="dialog"]:not(.hidden),.modal-backdrop:not(.hidden),#login-modal:not(.hidden)'))return;
    const item=candidates.find(row=>seatingReminderDue(row,now));if(!item)return;
    const modal=document.createElement('div');modal.id='next-seating-publication-reminder';modal.dataset.examId=item.examId;modal.dataset.nextDate=item.nextDate;modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','next-seating-reminder-heading');modal.className='fixed inset-0 z-[105] flex items-center justify-center bg-slate-950/60 p-4';
    modal.innerHTML=`<section class="w-full max-w-lg rounded-xl border-2 border-amber-300 bg-white p-5 shadow-xl"><h3 id="next-seating-reminder-heading" class="text-lg font-extrabold text-indigo-950">Please publish Day ${item.day} Seating Arrangement</h3><p class="mt-3 text-sm text-slate-700">${escapeHtml(item.examTitle)}</p><p class="mt-2 text-sm">The exam day ${escapeHtml(formatDateWithDay(item.completedDate))} has ended. Its seating arrangement has expired in Public View.</p><p class="mt-2 font-bold text-indigo-900">Please review and publish Day ${item.day} seating for ${escapeHtml(formatDateWithDay(item.nextDate))}.</p><p class="mt-2 text-xs text-slate-500">Open the next day, save any changes, then press Publish. Future seating is not published automatically.</p><div class="mt-5 flex flex-wrap justify-end gap-2"><button type="button" data-seating-reminder-later class="rounded bg-slate-200 px-4 py-2 text-xs font-bold">Remind me in 15 minutes</button><button type="button" data-seating-reminder-open class="rounded bg-indigo-700 px-4 py-2 text-xs font-bold text-white">Open Day ${item.day} Seating</button></div></section>`;
    modal.querySelector('[data-seating-reminder-later]').onclick=()=>dismissNextSeatingReminder(item);
    modal.querySelector('[data-seating-reminder-open]').onclick=()=>dismissNextSeatingReminder(item,true);
    document.body.appendChild(modal);modal.querySelector('[data-seating-reminder-open]').focus();
}
async function processSeatingPublicationExpiry(){
    const now=seatingExpiryNow();showInvigilationReminders(now);const raw=currentActiveRole==='public'?publicVisiblePortalBoards:publicPortalBoards,filtered=SeatingExpiry.visible(raw,now),view=seatingViewSignature(filtered);
    if(view!==seatingExpiryLastView){seatingExpiryLastView=view;renderPublicPortalBoards();}
    if(!['principal','sec-ic','pri-ic'].includes(authorizedRole)){document.getElementById('next-seating-publication-reminder')?.remove();return;}
    showNextSeatingReminder(publicPortalBoards,now);
    const store=sharedStore;
    if(seatingExpiryBusy || !store?.ready || !store.connected || store.pendingCount || isSelectedSessionFrozen() || isExamIcMasterView() || selectedAcademicSession!==(systemSettings.activeSession || DEFAULT_ACADEMIC_SESSION) || (now>=seatingExpiryLastAttempt && now-seatingExpiryLastAttempt<30000))return;
    // Read the confirmed shared view, so maintenance cannot publish any UI drafts.
    const before=store.view('publicPortalBoards'),confirmedExams=Object.values(store.view('archivedExams') || {}).filter(Boolean),after=SeatingExpiry.maintenance(before,confirmedExams,now);
    if(after===before)return;
    seatingExpiryBusy=true;seatingExpiryLastAttempt=now;
    try{await store.save('publicPortalBoards',after,[],before);}catch(error){console.warn('Seating expiry cleanup will retry; expired public seating stays hidden.',error);}
    finally{seatingExpiryBusy=false;}
}
function startSeatingExpiryMonitor(){
    const run=()=>processSeatingPublicationExpiry().catch(error=>console.warn('Seating expiry check deferred.',error));
    if(db){try{db.ref('.info/serverTimeOffset').on('value',snapshot=>{const offset=snapshot.val();if(typeof offset==='number'&&Number.isFinite(offset))seatingServerClockOffset=offset;run();},()=>{});}catch(error){}}
    setInterval(run,10000);
    window.addEventListener('focus',run);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)run();});
}
if(typeof module!=='undefined')module.exports=SeatingExpiry;

function showInvigilationReminders(now){
    const old=document.getElementById('invigilation-day-reminders');
    if(!['principal','sec-ic','pri-ic'].includes(authorizedRole)||currentActiveRole==='public'||isSelectedSessionFrozen()||selectedAcademicSession!==(systemSettings.activeSession || DEFAULT_ACADEMIC_SESSION)){old?.remove();return;}
    if(document.hidden)return;
    const confirmed=sharedStore?.ready?Object.values(sharedStore.view('archivedExams') || {}).filter(Boolean):archivedExams;
    const items=SeatingExpiry.dutyReminders(publicPortalBoards,confirmed,now);
    if(!items.length){old?.remove();return;}
    const panel=old || document.createElement('aside');panel.id='invigilation-day-reminders';panel.className='fixed bottom-3 left-3 z-50 max-h-48 max-w-sm overflow-auto rounded-xl border-2 border-amber-400 bg-white p-3 text-xs shadow-lg';
    const html=items.map(item=>`<p class="mb-2"><b>${item.kind==='attendance'?'Take invigilator attendance first':'Publish the next scheduled examination day’s invigilation duty'}</b><br>${escapeHtml(item.examTitle || 'Examination')} · ${escapeHtml(formatDateWithDay(item.date))}<br><button class="font-bold text-indigo-800 underline" onclick="openInvigilationReminder(${jsArg(item.examId)},${jsArg(item.date)},'${item.kind}')">${item.kind==='attendance'?'Open faculty attendance':'Review next day duty'}</button></p>`).join('');
    if(panel.innerHTML!==html)panel.innerHTML=html;
    if(!old)document.body.appendChild(panel);
}
function openInvigilationReminder(examId,date,kind){
    if(!['principal','sec-ic','pri-ic'].includes(authorizedRole))return;
    selectedPreExamVaultId=Number(examId)||examId;selectedDuringExamDate=date;selectedInvigilationDate=date;
    if(kind==='attendance'){duringExamStep=1;openLifecycleStage('during',examId);}
    else {activePreExamSubTab='invigilation';openPreExamFullPageWorkspace(Number(examId)||examId);}
}
