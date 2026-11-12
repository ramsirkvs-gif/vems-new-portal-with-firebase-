/* Staff timetable guidance and explicitly published TT IC report snapshots. */
let selectedTimetableReportDate='';
let timetableReportPlannerKey='';
function timetableStaffAccess(){return ['principal','sec-ic','pri-ic'].includes(authorizedRole);}
function timetableMappings(){return circularSettings._teacherTimetableMatches || {};}
function timetablePeriodText(period){return `P-${period.label} ${period.start}–${period.end}: ${period.entry || 'Free (blank TT entry)'}`;}
function timetableOptionBrief(teacher,date){
    const today=TeacherTimetablePlanner.daily(VEMSTeacherTimetable,teacher,date,timetableMappings());
    if(!today.record)return 'TT: not linked';
    if(!today.known)return `TT: no ${today.day || 'dated'} schedule`;
    return `TT: ${today.periods.filter(p=>p.entry).length} classes`;
}
function timetableDutyBriefHtml(exam,date,teacherId,field,record={},roomId=''){
    if(!timetableStaffAccess() || !teacherId)return '';
    const teacher=teachers.find(t=>String(t.id)===String(teacherId)),window=field==='relieverId'?{from:record.reliefFrom,to:record.reliefTo}:TeacherTimetablePlanner.fullWindow(exam,date),c=TeacherTimetablePlanner.compare(VEMSTeacherTimetable,teacher,date,window.from,window.to,timetableMappings());
    const status=!c.record?'not linked':!c.known?'day unavailable':!c.valid?'set duty times':`${c.classes.length} class overlap${c.classes.length===1?'':'s'}`;
    return `<div data-timetable-duty="${escapeHtml(String(teacherId))}" class="mt-1"><button type="button" aria-haspopup="dialog" onclick="openTimetableDutyPreview(${jsArg(exam.id)},${jsArg(date)},${jsArg(String(teacherId))},${jsArg(field)},${jsArg(record.reliefFrom || '')},${jsArg(record.reliefTo || '')},${jsArg(String(roomId))})" class="rounded px-2 py-1 text-left text-[10px] font-bold text-indigo-800 underline underline-offset-2">Today’s TT · ${escapeHtml(status)}</button></div>`;
}
let timetablePreviewTrigger=null,timetablePreviewContext=null;
function closeTimetableDutyPreview(){timetablePreviewContext=null;document.getElementById('teacher-duty-tt-preview')?.remove();if(timetablePreviewTrigger?.isConnected)timetablePreviewTrigger.focus();timetablePreviewTrigger=null;}
function timetableDutyPreviewHtml(exam,date,teacher,field,record={}){
    const window=field==='relieverId'?{from:record.reliefFrom,to:record.reliefTo}:TeacherTimetablePlanner.fullWindow(exam,date),c=TeacherTimetablePlanner.compare(VEMSTeacherTimetable,teacher,date,window.from,window.to,timetableMappings()),relief=field==='relieverId',label=relief?'Relieving duty':'Invigilation duty';
    const warning=!c.record?'Timetable not linked. Link this teacher in Timetable name links.':!c.known?'No timetable is supplied for this day. Availability is unknown.':!c.valid?'Enter valid duty start and finish times to mark the duty periods.':'';
    const subject=c.record?.designation?.match(/\(([^)]+)\)\s*$/)?.[1] || '',days={MON:'Monday',TUES:'Tuesday',WED:'Wednesday',THU:'Thursday',FRI:'Friday',SAT:'Saturday',SUN:'Sunday'};
    const cells=c.periods.map(period=>{
        const duty=c.valid && TeacherTimetablePlanner.overlaps(c.from,c.to,period.start,period.end),cover=duty&&c.known&&!!period.entry,classes=period.entry.match(/\b\d{1,2}[A-E]\b/g) || [],short=[...new Set(classes)].join(' + ') || period.entry;
        const entry=!c.known?'<span class="text-slate-500">Unknown</span>':!period.entry?'<span class="text-slate-500">Free</span>':short===period.entry?`<b>${escapeHtml(short)}</b>`:`<details><summary class="cursor-pointer font-bold">${escapeHtml(short)}</summary><p class="mt-2 break-words text-[10px] font-normal">${escapeHtml(period.entry)}</p></details>`;
        return `<td data-tt-period="${period.label}" data-duty-overlap="${duty}" data-class-cover="${cover}" class="border border-slate-300 p-3 text-center align-top ${cover?'bg-amber-100 text-amber-950':duty?'bg-indigo-100 text-indigo-950':'bg-white'}">${entry}${c.known&&period.entry&&subject?`<small class="mt-1 block">(${escapeHtml(subject)})</small>`:''}${duty?`<span class="mt-2 block rounded px-1 py-1 text-[9px] font-extrabold ${cover?'bg-amber-300':'bg-indigo-200'}">${relief?'RELIEF':'EXAM DUTY'}${cover?' · COVER':''}</span>`:''}</td>`;
    }).join('');
    return `<div class="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-3 border-b bg-white p-4"><div><h3 id="teacher-duty-tt-heading" class="font-extrabold text-indigo-950">${escapeHtml(teacher.name)} — Today’s TT</h3><p class="mt-1 text-xs">${escapeHtml(formatDateWithDay(date))} · ${label} ${escapeHtml(window.from || '—')}–${escapeHtml(window.to || '—')} (IST)</p></div><button type="button" data-close-tt-preview class="rounded bg-slate-200 px-4 py-2 text-xs font-bold">Close ×</button></div><div class="space-y-3 p-4">${warning?`<p role="status" class="rounded bg-amber-50 p-2 text-xs font-bold text-amber-900">${escapeHtml(warning)}</p>`:''}<div class="overflow-x-auto rounded border"><table class="w-full min-w-[960px] table-fixed text-xs"><caption class="sr-only">Teacher timetable with periods overlapping ${label.toLowerCase()} marked</caption><thead class="bg-slate-100 text-indigo-950"><tr><th scope="col" class="border border-slate-300 p-2">Day</th>${c.periods.map(p=>`<th scope="col" class="border border-slate-300 p-2">P-${p.label}<small class="mt-1 block font-normal">${p.start}–${p.end}</small></th>`).join('')}<th scope="col" class="border border-slate-300 p-2">Load</th></tr></thead><tbody><tr><th scope="row" class="border border-slate-300 bg-slate-50 p-2">${days[c.day] || 'Unknown day'}</th>${cells}<td class="border border-slate-300 p-2 text-center font-bold">${c.known?c.periods.filter(p=>p.entry).length:'—'}</td></tr></tbody></table></div><div class="flex flex-wrap gap-3 text-[10px]"><span class="rounded bg-amber-100 px-2 py-1">Class overlaps duty · cover needed</span><span class="rounded bg-indigo-100 px-2 py-1">Duty during free / unknown TT period</span><span class="px-2 py-1">Break 11:00–11:30</span></div><p class="text-[10px] text-slate-500">Marked periods include partial overlaps. Tap a combined class entry for its original timetable note.</p></div>`;
}
function openTimetableDutyPreview(examId,date,teacherId,field,from='',to='',roomId=''){
    if(!timetableStaffAccess())return;
    const exam=archivedExams.find(e=>String(e.id)===String(examId)),teacher=teachers.find(t=>String(t.id)===String(teacherId));if(!exam || !teacher)return;
    closeTimetableDutyPreview();timetablePreviewTrigger=document.activeElement;timetablePreviewContext={examId:String(examId),date,teacherId:String(teacherId),field,from,to,roomId:String(roomId)};
    const modal=document.createElement('div');modal.id='teacher-duty-tt-preview';modal.className='fixed inset-0 z-[220] flex items-center justify-center bg-slate-950/60 p-3';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','teacher-duty-tt-heading');modal.innerHTML=`<section class="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-xl bg-white shadow-xl">${timetableDutyPreviewHtml(exam,date,teacher,field,{reliefFrom:from,reliefTo:to})}</section>`;
    modal.querySelector('[data-close-tt-preview]').onclick=closeTimetableDutyPreview;
    modal.onclick=event=>{if(event.target===modal)closeTimetableDutyPreview();};
    modal.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();closeTimetableDutyPreview();}else if(event.key==='Tab'){const nodes=[...modal.querySelectorAll('button,summary')];if(event.shiftKey&&document.activeElement===nodes[0]){event.preventDefault();nodes.at(-1).focus();}else if(!event.shiftKey&&document.activeElement===nodes.at(-1)){event.preventDefault();nodes[0].focus();}}};
    timetablePreviewContext.html=timetableDutyPreviewHtml(exam,date,teacher,field,{reliefFrom:from,reliefTo:to});
    document.body.appendChild(modal);modal.querySelector('[data-close-tt-preview]').focus();
}
function refreshTimetableDutyPreview(){
    const ctx=timetablePreviewContext,modal=document.getElementById('teacher-duty-tt-preview');if(!ctx || !modal)return;
    if(!timetableStaffAccess()){closeTimetableDutyPreview();return;}
    const exam=archivedExams.find(e=>String(e.id)===ctx.examId),teacher=teachers.find(t=>String(t.id)===ctx.teacherId),record=invigilationPlans[ctx.examId]?.[ctx.date]?.[ctx.roomId];
    if(!exam || !teacher || ctx.roomId && !(ctx.field==='relieverId'?String(record?.relieverId)===ctx.teacherId:(record?.invigilators || []).some(id=>String(id)===ctx.teacherId))){closeTimetableDutyPreview();return;}
    const html=timetableDutyPreviewHtml(exam,ctx.date,teacher,ctx.field,record || {reliefFrom:ctx.from,reliefTo:ctx.to});
    if(ctx.html===html)return;ctx.html=html;modal.querySelector('section').innerHTML=html;modal.querySelector('[data-close-tt-preview]').onclick=closeTimetableDutyPreview;modal.querySelector('[data-close-tt-preview]').focus();
}
async function saveTimetableTeacherLink(teacherId,sourceId){
    if(!timetableStaffAccess() || !canEditSharedData('exam'))return false;
    const teacher=teachers.find(t=>String(t.id)===String(teacherId));if(!teacher)return false;
    if(sourceId && sourceId!=='none' && !VEMSTeacherTimetable.teachers.some(t=>t.id===sourceId))return false;
    const old=timetableMappings()[String(teacherId)] || null, matches={...timetableMappings()};
    const baseline=circularSettings._teacherTimetableMatches ? {path:['_teacherTimetableMatches',String(teacherId)],value:old} : {path:['_teacherTimetableMatches'],value:null};
    if(sourceId){const source=VEMSTeacherTimetable.teachers.find(t=>t.id===sourceId);matches[String(teacherId)]={teacherName:teacher.name,sourceId,sourceName:source?.name || '',sourceSha256:VEMSTeacherTimetable.sha256};}else delete matches[String(teacherId)];
    circularSettings={...circularSettings,_teacherTimetableMatches:matches};
    const ok=await saveData(['circularSettings'],{circularSettings:[baseline]});
    renderExamCreatorModule();return ok;
}
function timetableLinkControlsHtml(){
    const unmatched=teachers.filter(t=>!TeacherTimetablePlanner.resolve(VEMSTeacherTimetable,t,timetableMappings()));
    return `<details class="rounded border bg-white p-3"><summary class="cursor-pointer text-xs font-bold">Timetable name links · ${unmatched.length} unlinked portal staff</summary><p class="my-2 text-[10px] text-slate-600">Names are matched exactly after removing titles and punctuation. Confirm links explicitly for changed/on-task names. Linking does not rename or add staff. Source: ${escapeHtml(VEMSTeacherTimetable.source)} · ${VEMSTeacherTimetable.teachers.length} records.</p><div class="max-h-80 space-y-2 overflow-y-auto">${sortFacultyForDisplay().map(teacher=>{const record=TeacherTimetablePlanner.resolve(VEMSTeacherTimetable,teacher,timetableMappings()),explicit=timetableMappings()[String(teacher.id)],selected=explicit?.teacherName===teacher.name?explicit.sourceId:'';return `<label class="block text-[10px]"><b>${escapeHtml(teacher.name)}</b> · ${record?escapeHtml(record.name):'<span class="font-bold text-red-800">Not linked</span>'}<select aria-label="Timetable link for ${escapeHtml(teacher.name)}" onchange="saveTimetableTeacherLink(${jsArg(String(teacher.id))},this.value)" class="mt-1 block w-full rounded border p-2"><option value="">Automatic exact-name match</option><option value="none" ${selected==='none'?'selected':''}>No timetable record — keep unlinked</option>${VEMSTeacherTimetable.teachers.map(t=>`<option value="${escapeHtml(t.id)}" ${selected===t.id?'selected':''}>${escapeHtml(t.name)} · ${escapeHtml(t.designation)}</option>`).join('')}</select></label>`;}).join('')}</div></details>`;
}
// Explicit exam/day period assignments are independent of the general internal task list.
let selectedCoreTaskDate='';
const coreTaskPeriodDrafts=new Map();
const coreTaskPeriodBaselines=new Map();
const coreTaskPeriodScopes=new Map();
function coreTaskPeriodKey(examId,date){return `${typeof selectedAcademicSession==='string'?selectedAcademicSession:'default'}|${examId}|${date}`;}
function coreTaskPeriodNumbers(value){
    return [...new Set(timetableReportList(value).map(Number).filter(n=>Number.isInteger(n)&&n>=1&&n<=VEMSTeacherTimetable.periods.length))].sort((a,b)=>a-b);
}
function coreTaskPeriodMembers(exam,date){
    const members=new Map(coreTeamRows().map(member=>[String(member.teacherId),member]));
    Object.entries(exam.coreTaskPeriods?.[date] || {}).forEach(([id,record])=>{if(!members.has(id))members.set(id,{...record,teacherId:id});});
    return [...members.values()];
}
function captureCoreTaskPeriodDraft(examId,date){
    const panel=document.getElementById('core-task-period-planner');if(!panel)return;
    const key=coreTaskPeriodKey(examId,date);if(!coreTaskPeriodBaselines.has(key)){const exam=archivedExams.find(item=>String(item.id)===String(examId));coreTaskPeriodBaselines.set(key,JSON.parse(JSON.stringify(exam?.coreTaskPeriods || null)));}
    const entries=[...panel.querySelectorAll('[data-core-task-member]')].map(row=>({teacherId:row.dataset.coreTaskMember,periods:[...row.querySelectorAll('input:checked')].map(input=>Number(input.value))}));
    coreTaskPeriodDrafts.set(coreTaskPeriodKey(examId,date),entries);
    const status=panel.querySelector('[data-core-task-status]');if(status)status.textContent='Unsaved period selections';
}
function setCoreTaskPeriodScope(examId,date,scope){coreTaskPeriodScopes.set(coreTaskPeriodKey(examId,date),scope);}
function discardCoreTaskPeriodDraft(examId,date){const key=coreTaskPeriodKey(examId,date);coreTaskPeriodDrafts.delete(key);coreTaskPeriodBaselines.delete(key);coreTaskPeriodScopes.delete(key);renderExamCreatorModule();}
function selectCoreTaskPeriodDate(date){selectedCoreTaskDate=date;renderExamCreatorModule();}
function coreTaskPeriodPlannerHtml(exam){
    if(!timetableStaffAccess())return '';
    const dates=timetableReportDates(exam);if(!dates.length)return '';
    const date=dates.includes(selectedCoreTaskDate)?selectedCoreTaskDate:dates[0],draft=coreTaskPeriodDrafts.get(coreTaskPeriodKey(exam.id,date)),members=coreTaskPeriodMembers(exam,date),locked=!!exam.afterExamFrozen;
    return `<section id="core-task-period-planner" class="rounded-xl border-2 border-cyan-300 bg-cyan-50 p-4 space-y-3"><h3 class="font-extrabold text-indigo-950">Core Team — On Task Periods</h3><p class="text-xs text-slate-600">Exam IC: select the periods needed for core examination work. Manage members and task descriptions in Faculty Manager → Core Examination Team. Save here, then publish or update the TT IC report.</p><div class="flex flex-wrap gap-3"><label class="text-xs font-bold">Exam day<select aria-label="Core task exam day" onchange="selectCoreTaskPeriodDate(this.value)" class="block rounded border p-2">${dates.map(day=>`<option value="${escapeHtml(day)}" ${day===date?'selected':''}>${escapeHtml(formatDateWithDay(day))}</option>`).join('')}</select></label><label class="text-xs font-bold">Apply selections to<select aria-label="Core task period scope" onchange="setCoreTaskPeriodScope(${jsArg(exam.id)},${jsArg(date)},this.value)" ${locked?'disabled':''} class="block rounded border p-2"><option value="day">Selected day only</option><option value="all" ${coreTaskPeriodScopes.get(coreTaskPeriodKey(exam.id,date))==='all'?'selected':''}>All scheduled exam days</option></select></label></div><div class="overflow-x-auto"><table class="w-full min-w-[600px] bg-white text-xs"><thead><tr><th class="p-2 text-left">Core Team Member / Task</th><th class="p-2 text-left">On task periods</th></tr></thead><tbody>${members.map(member=>{const id=String(member.teacherId),saved=exam.coreTaskPeriods?.[date]?.[id],periods=coreTaskPeriodNumbers(draft?.find(entry=>entry.teacherId===id)?.periods ?? saved?.periods);return `<tr data-core-task-member="${escapeHtml(id)}" class="border-t"><td class="p-3"><b>${escapeHtml(member.name)}</b><br>${escapeHtml(member.designation || '')}<br><small>${escapeHtml(coreInternalDutyFor(id) || member.role || 'Core Team Member')}</small></td><td class="p-3"><div class="flex flex-wrap gap-3">${VEMSTeacherTimetable.periods.map((period,index)=>`<label class="whitespace-nowrap"><input type="checkbox" aria-label="${escapeHtml(member.name)} P-${index+1}" value="${index+1}" ${periods.includes(index+1)?'checked':''} ${locked?'disabled':''} onchange="captureCoreTaskPeriodDraft(${jsArg(exam.id)},${jsArg(date)})"> P-${index+1}</label>`).join('')}</div></td></tr>`;}).join('')||'<tr><td colspan="2" class="p-4">Add Core Examination Team members in Faculty Manager first.</td></tr>'}</tbody></table></div><div class="flex flex-wrap items-center justify-end gap-3"><span data-core-task-status class="mr-auto text-xs font-bold">${draft?'Unsaved period selections':'Saved daywise selections shown'}</span><button type="button" onclick="discardCoreTaskPeriodDraft(${jsArg(exam.id)},${jsArg(date)})" class="rounded border bg-white px-4 py-2 text-xs font-bold">Reload Saved Periods</button><button type="button" onclick="saveCoreTaskPeriodPlanner(${jsArg(exam.id)},${jsArg(date)})" ${locked||!members.length?'disabled':''} class="rounded bg-indigo-700 px-4 py-2 text-xs font-bold text-white disabled:bg-slate-400">Save On Task Periods</button></div><p class="text-xs text-slate-500">Uncheck all periods for a member to clear their on-task duty. Applying to all days replaces that member’s existing selections on every scheduled day.</p></section>`;
}
async function saveCoreTaskPeriodPlanner(examId,date){
    captureCoreTaskPeriodDraft(examId,date);
    const scope=document.querySelector('[aria-label="Core task period scope"]')?.value || 'day';
    if(scope==='all'&&!confirm('Apply these selections to every scheduled exam day? Existing on-task period selections will be replaced.'))return false;
    return saveCoreTaskPeriods(examId,date,scope,coreTaskPeriodDrafts.get(coreTaskPeriodKey(examId,date)) || []);
}
async function saveCoreTaskPeriods(examId,date,scope,entries){
    if(!timetableStaffAccess()||!canEditSharedData('exam')||!sharedStore?.ready||sharedStore.pendingCount)return false;
    const exam=archivedExams.find(item=>String(item.id)===String(examId)),dates=exam?timetableReportDates(exam):[];
    if(!exam||exam.afterExamFrozen||!dates.includes(date)||!['day','all'].includes(scope))return false;
    const members=new Map(coreTaskPeriodMembers(exam,date).map(member=>[String(member.teacherId),member])),seen=new Set(),nextDay={};
    for(const entry of entries){const id=String(entry.teacherId),member=members.get(id);if(!member||seen.has(id))return false;seen.add(id);const periods=coreTaskPeriodNumbers(entry.periods);
        if(periods.length)nextDay[id]={name:String(member.name || ''),designation:String(member.designation || ''),periods};
    }
    // The form is a complete roster; never drop a member because a partial form was supplied.
    if(seen.size!==members.size)return false;
    const targets=scope==='all'?dates:[date],previous=exam.coreTaskPeriods || {},baseline=coreTaskPeriodBaselines.has(coreTaskPeriodKey(examId,date))?coreTaskPeriodBaselines.get(coreTaskPeriodKey(examId,date)):(exam.coreTaskPeriods || null),next={...previous},expected=[];
    if(!baseline)expected.push({path:[String(exam.id),'coreTaskPeriods'],value:null});
    for(const day of targets){next[day]=JSON.parse(JSON.stringify(nextDay));if(baseline)expected.push({path:[String(exam.id),'coreTaskPeriods',day],value:baseline[day] || null});}
    archivedExams=archivedExams.map(item=>String(item.id)===String(exam.id)?{...item,coreTaskPeriods:next}:item);
    if(!await saveData(['archivedExams'],{archivedExams:expected}))return false;
    for(const day of targets){coreTaskPeriodDrafts.delete(coreTaskPeriodKey(examId,day));coreTaskPeriodBaselines.delete(coreTaskPeriodKey(examId,day));coreTaskPeriodScopes.delete(coreTaskPeriodKey(examId,day));}
    renderExamCreatorModule();alert(scope==='all'?'On-task periods saved for all scheduled exam days.':'On-task periods saved for '+formatDateWithDay(date)+'.');return true;
}
function timetableSnapshotCoreRows(exam,date,rows){
    const grouped=new Map(rows.map(row=>[String(row.teacherId),{...row,lines:[...row.lines]}]));
    Object.entries(exam.coreTaskPeriods?.[date] || {}).forEach(([teacherId,record])=>{
        const periods=coreTaskPeriodNumbers(record.periods);if(!periods.length)return;
        const row=grouped.get(teacherId) || {teacherId,name:String(record.name || `Unknown teacher (${teacherId})`),designation:String(record.designation || ''),lines:[]};
        row.lines.push('Core Team / On Task | | Explicit period selection','Periods overlapping duty: '+periods.map(n=>'P-'+n).join(', '));grouped.set(teacherId,row);
    });return [...grouped.values()];
}
function timetableReportDates(exam){return [...new Set((exam.datesheetSnapshot || []).map(day=>day.dateStr).filter(Boolean))].sort();}
function timetableReportRows(exam,date){return timetableReportRowsFromSources(exam,date,teachers,invigilationPlans,occupiedInvigilationRooms(exam),timetableMappings());}
function timetableReportRowsFromSources(exam,date,staff,plans,occupied,mappings){return TeacherTimetablePlanner.report(VEMSTeacherTimetable,exam,date,staff,plans,occupied,mappings);}
function timetableReportTeacherLines(row,date){
    const lines=[];
    row.duties.filter(duty=>duty.role==='Invigilation'||duty.role==='Relieving').forEach(duty=>{
        lines.push(`${duty.role} | ${duty.room} | ${duty.from || 'time not entered'} - ${duty.to || 'time not entered'}`);
        const c=duty.comparison;if(!c)return;
        if(!c.record)lines.push('TT NOT LINKED: availability is unknown. Please confirm this teacher’s timetable.');
        else if(!c.known)lines.push('NO TIMETABLE FOR THIS DAY: availability is unknown.');
        if(!c.valid)lines.push('DUTY TIMES INCOMPLETE/INVALID: class clashes cannot be confirmed.');
        if(c.known && c.valid){
            lines.push('Replacement cover requested:');
            if((c.running || c.classes).length)(c.running || c.classes).forEach(p=>lines.push('  '+timetablePeriodText(p)+` · duty overlap ${duty.from>p.start?duty.from:p.start}–${duty.to<p.end?duty.to:p.end}`));else lines.push('  No scheduled class overlaps this duty window.');
            lines.push('Suspended-class lessons: '+((c.suspended || []).map(timetablePeriodText).join('; ') || 'None'));
            lines.push('Periods overlapping duty: '+[...c.classes,...c.protectedFree].map(p=>'P-'+p.label).join(', '));
            lines.push('Free periods protected during duty: '+(c.protectedFree.map(p=>`P-${p.label} ${duty.from>p.start?duty.from:p.start}-${duty.to<p.end?duty.to:p.end}`).join('; ') || 'None'));
        }
        if(c.valid)lines.push(`TT IC: no arrangement during ${duty.from}–${duty.to} (${duty.role}). Free in Master TT, but teacher is on examination duty. TT IC: Please do not assign any class arrangement or other duty during these periods.`);
    });
    return lines;
}
function changeTimetableReportDate(date,examId){selectedTimetableReportDate=date;const exam=archivedExams.find(e=>String(e.id)===String(examId)),mount=document.getElementById('timetable-ic-report');if(exam && mount)mount.outerHTML=timetableReportPanelHtml(exam,date,true);}
function timetableReportPanelHtml(exam,date,manual=false){
    if(!timetableStaffAccess())return '';
    const dates=timetableReportDates(exam),plannerKey=coreTaskPeriodKey(exam.id,date);if(!manual && timetableReportPlannerKey!==plannerKey){selectedTimetableReportDate=date;timetableReportPlannerKey=plannerKey;}if(!dates.includes(selectedTimetableReportDate))selectedTimetableReportDate=date;
    const reportDate=selectedTimetableReportDate, rows=timetableReportRows(exam,reportDate);
    return `<section id="timetable-ic-report" class="space-y-3 rounded-xl border-2 border-cyan-300 bg-cyan-50 p-4"><div class="flex flex-wrap items-center justify-between gap-2"><div><h4 class="font-extrabold text-indigo-950">TT IC — Daywise Exam Duty &amp; Arrangement Requests</h4><p class="text-[10px] text-slate-600">Invigilators, relievers and explicitly selected Core Team on-task periods. Save duties, then Publish this report date to Public View. Later edits require Update Published Copy. Requests require TT IC action; replacement teachers are not automatically allocated.</p></div><div class="flex flex-wrap gap-2"><button type="button" onclick="printTimetableIcReport(${jsArg(exam.id)},${jsArg(reportDate)})" class="rounded bg-indigo-700 px-4 py-2 text-xs font-bold text-white">PDF / Print TT IC Report</button>${timetableReportPublishControls(exam,reportDate)}</div></div><label class="block text-xs font-bold">Report date · invigilation / relieving timings<select aria-label="TT IC report date" onchange="changeTimetableReportDate(this.value,${jsArg(exam.id)})" class="mt-1 block rounded border bg-white p-2">${dates.map(d=>`<option value="${escapeHtml(d)}" ${d===reportDate?'selected':''}>${escapeHtml(formatDateWithDay(d))}</option>`).join('')}</select></label><p class="text-[10px]">Period times (IST): ${VEMSTeacherTimetable.periods.map(p=>`P-${p.label} ${p.start}–${p.end}`).join(' · ')}. Break 11:00–11:30.</p><details><summary class="cursor-pointer text-xs font-bold">View ${rows.length} teacher request(s) for ${escapeHtml(formatDateWithDay(reportDate))}</summary><div class="mt-2">${timetableReportTableHtml(timetableReportSnapshot(exam,reportDate,rows).rows)}</div></details>${timetableLinkControlsHtml()}</section>`;
}
function timetableIcReportPdfBlob(exam,date){return timetableReportSnapshotPdf(timetableReportSnapshot(exam,date));}
function timetableReportTableRows(value){
    const result=[];
    timedTimetableReportRows(value).forEach((employee,index)=>{let current=null;
        for(const value of timetableReportList(employee.lines)){const line=String(value),parts=line.split('|');
            if(/^(Invigilation|Relieving|Core Team \/ On Task)\s*\|/.test(line)){current={sn:index+1,teacherId:employee.teacherId,name:employee.name,designation:employee.designation,duty:parts[0].trim(),room:parts.slice(1,-1).join('|').trim(),time:parts.at(-1).trim(),cover:[],free:'',suspended:'',overlap:'',notes:[]};result.push(current);continue;}
            if(!current)continue;
            if(line.startsWith('Suspended-class lessons:'))current.suspended=line.slice(24).trim();
            else if(line.startsWith('Periods overlapping duty:'))current.overlap=line.slice(25).trim();
            else if(/^\s*P-/.test(line))current.cover.push(line.trim());
            else if(/^\s*No scheduled class overlaps/.test(line))current.cover.push('No class overlap');
            else if(line.startsWith('Free periods protected during duty:'))current.free=line.slice('Free periods protected during duty:'.length).trim();
            else if(/^(TT NOT LINKED:|NO TIMETABLE FOR THIS DAY:|DUTY TIMES INCOMPLETE)/.test(line))current.notes.push(line);
        }
    });return result;
}
function timetableArrangementText(value,arrange=false){
    const numbers={I:1,II:2,III:3,IV:4,V:5,VI:6,VII:7,VIII:8};
    let text=String(value || '').replace(/\s*[·-]?\s*duty overlap\s+\d{2}:\d{2}\s*[-–]\s*\d{2}:\d{2}/gi,'')
        .replace(/(P-(?:VIII|VII|VI|IV|III|II|V|I|[1-8]))\s+\d{2}:\d{2}\s*[-–]\s*\d{2}:\d{2}/g,'$1')
        .replace(/P-(VIII|VII|VI|IV|III|II|V|I)\b/g,(_,n)=>'P-'+numbers[n])
        .replace(/No class overlap|No scheduled class overlaps this duty window\./gi,'No arrangement needed')
        .replace(/Periods overlapping duty:/g,'Periods on exam duty:');
    if(arrange && /^\s*P-\d/.test(text))text+=' — Put arrangement';
    return text;
}
function timetableDutyPeriods(row){
    const numbers={I:1,II:2,III:3,IV:4,V:5,VI:6,VII:7,VIII:8};
    const source=[row.overlap,...(row.cover || []),row.free,row.suspended].join(' '),periods=new Set();
    for(const match of source.matchAll(/P-(VIII|VII|VI|IV|III|II|V|I|\d+)\b/g))periods.add(numbers[match[1]] || Number(match[1]));
    return [...periods].sort((a,b)=>a-b).map(n=>'P-'+n).join(', ') || '—';
}
function timetableReportCells(row,changes=false){
    return [row.sn,`${row.name}\n${row.designation}`,timetableDutyPeriods(row)];
}
function timetableReportHeadings(){return ['SN','Name & Designation','Periods on Exam Duty / On Task'];}
function timetableReportDisplayRows(value,changes=false){
    if(!changes)return timetableReportTableRows(value);
    return timetableReportList(value).flatMap((employee,index)=>{
        const duties=timetableReportTableRows([employee]);
        return (duties.length?duties:[{name:employee.name,designation:employee.designation,teacherId:employee.teacherId,duty:timetableReportTableRows([{...employee,lines:employee.previousLines}])[0]?.duty || 'Invigilation',room:'Removed / cancelled',cover:[],notes:[]}]).map(r=>({...r,sn:index+1,change:employee.change,reason:employee.reason,withdrawn:employee.withdrawn,cover:[...(r.cover || []),...(employee.absenceCover&&r.duty!=='Core Team / On Task'?['ABSENCE cover: '+employee.absenceCover]:[])]}));
    });
}
function timetableCompactRows(value,changes=false){
    const grouped=new Map();
    timetableReportDisplayRows(value,changes).forEach(row=>{
        const key=`${row.duty}|${row.teacherId || row.name}`,old=grouped.get(key);
        if(old){old.overlap=[old.overlap,row.overlap].join(' ');old.cover.push(...(row.cover || []));old.free=[old.free,row.free].join(' ');old.suspended=[old.suspended,row.suspended].join(' ');}
        else grouped.set(key,{...row,cover:[...(row.cover || [])]});
    });
    return [...grouped.values()];
}
function timetableDutyChartTitle(role){return role==='Invigilation'?'Invigilation Duty':role==='Relieving'?'Relieving Duty':'Core Team / On Task';}
function timetableReportTableHtml(value,changes=false){
    const rows=timetableCompactRows(value,changes);
    return ['Invigilation','Relieving','Core Team / On Task'].map(role=>{
        const selected=rows.filter(row=>row.duty===role);
        return selected.length?`<section class="mt-3"><h5 class="mb-2 text-sm font-extrabold text-indigo-950">${timetableDutyChartTitle(role)}</h5>${timetableDutyChartHtml(selected,changes)}</section>`:'';
    }).join('') || timetableDutyChartHtml(rows,changes);
}
function timetableDutyChartHtml(rows,changes=false){
    return `<div class="max-h-96 overflow-auto"><table data-tt-arrangement-table class="w-full min-w-[540px] border-collapse text-xs"><thead><tr>${timetableReportHeadings(changes).map(h=>`<th class="border bg-indigo-950 p-3 text-white">${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr data-tt-employee="${escapeHtml(String(row.teacherId || row.sn))}">${timetableReportCells(row,changes).map((cell,i)=>`<td class="border p-3 align-top whitespace-pre-line">${escapeHtml(String(cell))}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="3">No changes / no invigilator or reliever duty recorded.</td></tr>'}</tbody></table></div>`;
}
function timetableReportSnapshotPdf(snapshot){
    const changes=snapshot.kind==='morning-changes',rows=timetableCompactRows(snapshot.rows,changes).sort((a,b)=>['Invigilation','Relieving','Core Team / On Task'].indexOf(a.duty)-['Invigilation','Relieving','Core Team / On Task'].indexOf(b.duty)),streams=[],x=[30,75,400,812],limits=[4,45,55];
    const clean=value=>String(value??'').normalize('NFKD').replace(/[^\x20-\x7E]/g,'-').replace(/([\\()])/g,'\\$1'),text=(value,xx,y,size=8,color='0.07 0.12 0.32')=>`${color} rg BT /F1 ${size} Tf 1 0 0 1 ${xx} ${y} Tm (${clean(value)}) Tj ET\n`;
    const wrap=(value,max)=>{const out=[];let line='';for(const word of String(value??'').split(/\s+/)){if((line+' '+word).trim().length>max&&line){out.push(line);line='';}for(let i=0;i<word.length;i+=max){const part=word.slice(i,i+max);if(i+max<word.length){if(line){out.push(line);line='';}out.push(part);}else line=(line+' '+part).trim();}}if(line)out.push(line);return out.length?out:[''];};
    let stream='',y=0,page=0,chartRole=rows[0]?.duty || 'Invigilation';
    const newPage=()=>{if(stream)streams.push(stream+text(`Page ${page} | TT IC - Timed Duty Arrangements`,30,20,7));page++;stream=text('PM SHRI KENDRIYA VIDYALAYA NO. 1, ITANAGAR',225,568,12)+text('TT IC - EXAM DUTY & ARRANGEMENT REQUESTS',265,550,11)+text(timetableDutyChartTitle(chartRole).toUpperCase()+' CHART',30,544,9);y=532;for(const line of wrap(`${snapshot.examTitle} | ${formatDateWithDay(snapshot.date)}`,150)){stream+=text(line,30,y,9);y-=12;}if(changes){stream+=text(`Morning Changes | Revision ${snapshot.revision} | Baseline ${snapshot.baselineVersion} | Issued ${snapshot.issuedAt}`,30,y,8);y-=14;}stream+=text(snapshot.publishedAt?'Published report.':'Working copy: save exam duties before sharing.',30,y,7);y-=12;for(const line of wrap(`Timetable: ${snapshot.source || 'Uploaded teacher timetable'}`,160)){stream+=text(line,30,y,7);y-=11;}if(snapshot.publishedAt){stream+=text(`Published: ${new Date(snapshot.publishedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} (IST)`,30,y,7);y-=12;}y-=5;stream+=`0.07 0.12 0.32 rg 30 ${y-65} 782 65 re f\n`;const headings=timetableReportHeadings(changes).map((h,i)=>wrap(h,limits[i]));headings.forEach((lines,col)=>lines.forEach((line,i)=>stream+=text(line,x[col]+4,y-13-i*10,7,'1 1 1')));y-=65;};
    newPage();
    rows.forEach(row=>{
        if(row.duty!==chartRole){chartRole=row.duty;newPage();}
        const cells=timetableReportCells(row,changes).map(String),lines=cells.map((cell,col)=>String(cell).split('\n').flatMap(part=>wrap(part,limits[col]))),total=Math.max(...lines.map(a=>a.length));let offset=0;
        while(offset<total){const capacity=Math.floor((y-57)/10);if(capacity<1){newPage();continue;}const take=Math.min(total-offset,capacity),height=Math.max(32,take*10+12);if(y-height<42){newPage();continue;}if(row.sn%2===0)stream+=`0.95 0.98 1 rg 30 ${y-height} 782 ${height} re f\n`;stream+='0.75 0.8 0.88 RG 0.5 w ';x.forEach(xx=>stream+=`${xx} ${y-height} m ${xx} ${y} l S `);stream+=`30 ${y-height} m 812 ${y-height} l S\n`;lines.forEach((cell,col)=>{let visible=cell.slice(offset,offset+take);if(offset&&!visible.length&&col<5)visible=cell.slice(0,take);visible.forEach((line,index)=>stream+=text(line,x[col]+4,y-13-index*10,8));});y-=height;offset+=take;}
    });
    if(!rows.length){stream+=text('No invigilator or reliever duty recorded for this date.',34,y-20,9);y-=35;}
    if(y<85)newPage();stream+=text('Requested by: Examination IC',30,y-30,8)+text('For action: Timetable IC',635,y-30,8);streams.push(stream+text(`Page ${page} | TT IC - Timed Duty Arrangements`,30,20,7));return createPdfFromStreams(streams,'0 0 842 595');
}
function printTimetableIcReport(examId,date){
    if(!timetableStaffAccess()){alert('Sign in as an examination-team member.');return;}
    const exam=archivedExams.find(e=>String(e.id)===String(examId));if(!exam || !timetableReportDates(exam).includes(date))return;
    if(sharedStore?.pendingCount){alert('Wait for pending saves before printing the TT IC report.');return;}
    const url=URL.createObjectURL(timetableIcReportPdfBlob(exam,date));window.open(url,'_blank');setTimeout(()=>URL.revokeObjectURL(url),120000);
}

function timetableReportList(value){return Array.isArray(value)?value.filter(Boolean):value&&typeof value==='object'?Object.values(value).filter(Boolean):[];}
function timetableReportSnapshot(exam,date,reportRows=null){
    return {scope:'timed-invigilation-relief',absentFaculty:(exam.duringExamDays?.[date]?.absentFaculty || []).map(String).sort(),examId:exam.id,examTitle:String(exam.title || 'Examination'),date,source:VEMSTeacherTimetable.source,
        periods:VEMSTeacherTimetable.periods.map(p=>({label:p.label,start:p.start,end:p.end})),
        rows:timetableSnapshotCoreRows(exam,date,(reportRows || timetableReportRows(exam,date)).map(row=>({teacherId:String(row.teacherId),name:String(row.teacher?.name || `Unknown teacher (${row.teacherId})`),designation:String(row.teacher?.desig || ''),lines:timetableReportTeacherLines(row,date)})))};
}
function timetableConfirmedReportSnapshot(examId,date){
    const read=name=>normalizeSharedUiValue(name,sharedStore.view(name)),exams=Object.values(read('archivedExams')),exam=exams.find(e=>String(e.id)===String(examId));
    if(!exam || !timetableReportDates(exam).includes(date))return null;
    const staff=Object.values(read('teachers')),plans=read('invigilationPlans'),seating=read('seatingPlans'),mappings=read('circularSettings')._teacherTimetableMatches || {},dates=new Set(exam.datesheetSnapshot.map(day=>day.dateStr));
    const occupied=Object.entries(seating[String(exam.id)] || {}).filter(([day])=>dates.has(day)).flatMap(([day,plan])=>actualOccupiedRoomRows(plan).map(room=>({...room,date:day})));
    return timetableReportSnapshot(exam,date,timetableReportRowsFromSources(exam,date,staff,plans,occupied,mappings));
}
function timetableSnapshotSignature(value){
    const stable=item=>Array.isArray(item)?item.map(stable):item&&typeof item==='object'?Object.fromEntries(Object.keys(item).sort().map(key=>[key,stable(item[key])])):item;
    return JSON.stringify(stable(value));
}
function timetableReportPublishControls(exam,date){
    const published=String(publicPortalBoards.ttIcReports?.examId)===String(exam.id)&&!!publicPortalBoards.ttIcReports.days?.[date];
    return `<button type="button" onclick="publishTimetableIcReport(${jsArg(exam.id)},${jsArg(date)})" class="rounded bg-emerald-700 px-4 py-2 text-xs font-bold text-white">${published?'Update Published Copy':'Publish TT IC Report'}</button><button type="button" onclick="stopTimetableIcReport(${jsArg(exam.id)},${jsArg(date)})" ${published?'':'disabled'} class="rounded bg-orange-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">Stop Publishing This Date</button>`;
}
async function publishTimetableIcReport(examId,date){
    if(!timetableStaffAccess() || !canEditSharedData('exam'))return false;
    if(!sharedStore?.ready || sharedStore.pendingCount){alert('Wait for all saves to finish before publishing the TT IC report.');return false;}
    const exam=archivedExams.find(e=>String(e.id)===String(examId));if(!exam || !timetableReportDates(exam).includes(date))return false;
    const saved=timetableConfirmedReportSnapshot(examId,date),working=timetableReportSnapshot(exam,date);
    if(!saved || timetableSnapshotSignature(saved)!==timetableSnapshotSignature(working)){alert('Save the current duty, seating or timetable changes before publishing this TT IC report.');return false;}
    const previous=publicPortalBoards.ttIcReports,same=String(previous?.examId)===String(exam.id),now=new Date().toISOString(),days={...(same?previous.days || {}:{}),[date]:{...saved,revision:(same?previous.days?.[date]?.revision || 0:0)+1,notices:same?previous.days?.[date]?.notices || {}:{},publishedAt:now,publishedBy:authorizedRole}};
    publicPortalBoards={...publicPortalBoards,ttIcReports:{examId:exam.id,examTitle:exam.title,days,lastPublishedDate:date,publishedAt:same?previous.publishedAt || now:now,updatedAt:now}};
    if(!await saveData(['publicPortalBoards']))return false;
    if(!await refreshActivePublicFeed() || String(publicVisiblePortalBoards.ttIcReports?.examId)!==String(exam.id) || visiblePublicTimetableDays(publicVisiblePortalBoards.ttIcReports)[date]?.publishedAt!==now){alert('Report saved, but Public View confirmation is pending. Check the active session and retry.');return false;}
    renderExamCreatorModule();renderPublicPortalBoards();alert('TT IC report published to Public View for '+formatDateWithDay(date)+'.');return true;
}
async function stopTimetableIcReport(examId,date){
    if(!timetableStaffAccess() || !canEditSharedData('exam'))return false;
    const current=publicPortalBoards.ttIcReports;if(String(current?.examId)!==String(examId) || !current.days?.[date])return false;
    if(!confirm('Stop publishing the TT IC report for '+formatDateWithDay(date)+'? Other report dates will stay public.'))return false;
    const days={...current.days};delete days[date];const next={...publicPortalBoards};if(Object.keys(days).length)next.ttIcReports={...current,days,updatedAt:new Date().toISOString()};else delete next.ttIcReports;
    publicPortalBoards=next;if(!await saveData(['publicPortalBoards']))return false;await refreshActivePublicFeed();renderExamCreatorModule();renderPublicPortalBoards();return true;
}
function timedTimetableReportRows(value){
    return timetableReportList(value).map(row=>{let keep=false,from='',to='';const lines=[];
        for(const value of timetableReportList(row.lines)){const line=String(value);if(/^(Invigilation|Relieving|Core Team \/ On Task)\s*\|/.test(line)){keep=true;const times=line.split('|').at(-1).trim().match(/^(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})$/);from=times?.[1] || '';to=times?.[2] || '';lines.push(line);continue;}
            if(keep && /^(?:\s*P-|\s*No scheduled class overlaps|TT NOT LINKED:|NO TIMETABLE FOR THIS DAY:|DUTY TIMES INCOMPLETE|Suspended-class lessons:|Periods overlapping duty:|Replacement cover requested:|Free periods protected during duty:|TT IC: no arrangement during )/.test(line)){
                let text=line;if(from&&to){
                    if(line.startsWith('Free periods protected during duty:'))text=line.replace(/(P-[IVX]+ )(\d{2}:\d{2})[-–](\d{2}:\d{2})/g,(_,p,start,end)=>`${p}${from>start?from:start}-${to<end?to:end}`);
                    else if(/^\s*P-/.test(line)&&!line.includes('duty overlap')){const p=line.match(/^\s*P-[IVX]+ (\d{2}:\d{2})[-–](\d{2}:\d{2})/);if(p)text+=` · duty overlap ${from>p[1]?from:p[1]}–${to<p[2]?to:p[2]}`;}
                }
                lines.push(text);
            }else keep=false;
        }
        return {...row,lines};
    }).filter(row=>row.lines.length);
}
function visiblePublicTimetableDays(board){return Object.fromEntries(Object.entries(board?.days || {}).map(([date,day])=>[date,{...day,rows:timedTimetableReportRows(day?.rows)}]).filter(([,day])=>day.rows.length || day.scope==='timed-invigilation-relief'));}
function renderPublicTimetableReport(boards=visiblePortalBoards()){
    const section=document.getElementById('public-tt-ic-report-section'),content=document.getElementById('public-tt-ic-report-content');if(!section || !content)return;
    const board=boards.ttIcReports,days=visiblePublicTimetableDays(board),dates=Object.keys(days).sort(),previous=document.getElementById('public-tt-ic-report-date')?.value,date=dates.includes(previous)?previous:dates.includes(board?.lastPublishedDate)?board.lastPublishedDate:dates.at(-1);
    section.classList.toggle('hidden',!dates.length);if(!date){content.innerHTML='';return;}
    const snapshot=days[date],rows=timetableReportList(snapshot.rows);
    content.innerHTML=`<div class="flex flex-wrap items-end justify-between gap-3"><div><b class="block text-sm text-indigo-950">${escapeHtml(snapshot.examTitle || board.examTitle || 'Examination')}</b><label class="mt-2 block text-xs font-bold">Published report date<select id="public-tt-ic-report-date" onchange="renderPublicTimetableReport()" class="mt-1 block max-w-full rounded border bg-white p-2">${dates.map(d=>`<option value="${escapeHtml(d)}" ${d===date?'selected':''}>${escapeHtml(formatDateWithDay(d))}</option>`).join('')}</select></label></div><div class="flex flex-wrap gap-2"><button type="button" onclick="printPublicTimetableIcReport()" class="public-export-button rounded bg-indigo-700 px-3 py-2 text-xs font-bold text-white">PDF / Print TT IC Report</button><button type="button" onclick="sharePublicTimetableIcReport()" class="public-export-button rounded bg-emerald-700 px-3 py-2 text-xs font-bold text-white">Share PDF to WhatsApp</button></div></div><p class="mt-3 text-xs text-slate-600">${rows.length} teacher request(s) · Invigilation, relieving and saved Core Team on-task periods. Published copy; replacement staff must be allocated by TT IC.</p><div class="mt-3">${timetableReportTableHtml(rows)}</div>${Object.entries(snapshot.notices || {}).map(([key,notice])=>`<section class="mt-4 rounded border p-3">${timetableNoticeHtml(notice)}<button onclick="exportPublicTimetableNotice(${jsArg(date)},${jsArg(key)},'print')">Download PDF / Print</button> <button onclick="exportPublicTimetableNotice(${jsArg(date)},${jsArg(key)},'share')">Share to WhatsApp</button></section>`).join('')}`;
}
function selectedPublicTimetableReport(){const board=visiblePortalBoards().ttIcReports,date=document.getElementById('public-tt-ic-report-date')?.value;return visiblePublicTimetableDays(board)[date] || null;}
function publicTimetableIcReportPdfBlob(){const snapshot=selectedPublicTimetableReport();return snapshot?timetableReportSnapshotPdf(snapshot):null;}
function printPublicTimetableIcReport(){const blob=publicTimetableIcReportPdfBlob();if(!blob){alert('Select a published TT IC report date first.');return;}const url=URL.createObjectURL(blob);window.open(url,'_blank');setTimeout(()=>URL.revokeObjectURL(url),120000);}
async function sharePublicTimetableIcReport(){
    const snapshot=selectedPublicTimetableReport(),blob=publicTimetableIcReportPdfBlob();if(!snapshot || !blob){alert('Select a published TT IC report date first.');return;}
    const title=`${snapshot.examTitle} — TT IC report — ${snapshot.date}`,safe=String(snapshot.examTitle || 'Examination').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,''),filename=`TT-IC-Report-${safe}-${snapshot.date}.pdf`,file=new File([blob],filename,{type:'application/pdf'});
    if(navigator.share && navigator.canShare?.({files:[file]})){try{await navigator.share({title,text:title,files:[file]});return;}catch(error){if(error.name==='AbortError')return;}}
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),120000);window.open('https://wa.me/?text='+encodeURIComponent(title),'_blank','noopener,noreferrer');alert('PDF downloaded. Attach the downloaded report in WhatsApp. This browser cannot attach files directly.');
}

// Morning reports compare confirmed saves with the latest explicitly published full snapshot.
function timetableMorningChanges(examId,date){
    if(!timetableStaffAccess() || !sharedStore?.ready || sharedStore.pendingCount)throw Error('Wait for all saves to finish.');
    const exam=archivedExams.find(e=>String(e.id)===String(examId)),saved=timetableConfirmedReportSnapshot(examId,date);
    if(!exam || !saved || timetableSnapshotSignature(saved)!==timetableSnapshotSignature(timetableReportSnapshot(exam,date)))throw Error('Save duty, seating and timetable changes first.');
    const board=publicPortalBoards.ttIcReports,baseline=String(board?.examId)===String(examId)?board.days?.[date]:null;
    if(!baseline?.revision || baseline.scope!=='timed-invigilation-relief')throw Error('A complete baseline report is needed. Publish the full TT IC report first.');
    const confirmedExam=Object.values(normalizeSharedUiValue('archivedExams',sharedStore.view('archivedExams'))).find(e=>String(e.id)===String(examId));
    const absent=new Set((confirmedExam?.duringExamDays?.[date]?.absentFaculty || []).map(String));
    const before=new Map(timetableReportList(baseline.rows).map(r=>[String(r.teacherId),r])),after=new Map(saved.rows.map(r=>[String(r.teacherId),r]));
    const rows=[];
    for(const id of new Set([...before.keys(),...after.keys()])){
        const old=before.get(id),current=after.get(id);
        if(timetableSnapshotSignature(old)===timetableSnapshotSignature(current)&&absent.has(id)===(baseline.absentFaculty || []).includes(id))continue;
        const staff=teachers.find(t=>String(t.id)===id),daily=TeacherTimetablePlanner.daily(VEMSTeacherTimetable,staff,date,timetableMappings());
        const absenceCover=absent.has(id)?(daily.known?TeacherTimetablePlanner.classify(exam,date,daily.periods.filter(p=>p.entry)).running.map(timetablePeriodText).join('; '):'Timetable unavailable: review all running-class absence cover'):'';
        rows.push({...current || old,lines:current?.lines || [],change:!old?'Incoming / replacement teacher':!current?'Outgoing / duty cancelled':'Duty changed / reduced / room or timing revised',
            absenceCover,reason:absent.has(id)?'ABSENCE: running-class cover is required because the teacher is absent.':'Assignment revision; absence is not recorded.',
            withdrawn:old?'Earlier requests superseded: '+timetableReportList(old.lines).join('\n'):'None',previousLines:old?.lines || []});
    }
    return {...saved,rows,kind:'morning-changes',baselineVersion:baseline.revision,revision:baseline.revision+1,issuedAt:new Date().toISOString(),nextBaseline:saved};
}
function timetableMorningControls(exam,date){return `<section class="mt-3 rounded border border-cyan-400 bg-cyan-50 p-3"><b>TT IC — Morning Changes</b><p class="text-xs">Save replacements first. Only publishing advances the TT IC baseline.</p><div class="flex flex-wrap gap-2">${[['preview','Preview Changes'],['print','Download PDF / Print'],['share','Share to WhatsApp'],['publish','Publish / Update TT IC Changes']].map(([action,label])=>`<button type="button" class="rounded bg-indigo-700 p-2 text-xs text-white" onclick="runTimetableMorningAction(${jsArg(exam.id)},${jsArg(date)},'${action}')">${label}</button>`).join('')}</div></section>`;}
async function runTimetableMorningAction(examId,date,action){
    try{
        const notice=timetableMorningChanges(examId,date);
        if(!notice.rows.length){alert('No changes.');return;}
        if(action==='publish'){
            if(!canEditSharedData('exam'))return;
            const previous=publicPortalBoards,board=previous.ttIcReports,day=board.days[date],{nextBaseline,...published}=notice,key='revision-'+notice.revision;
            const now=new Date().toISOString();
            if(day.revision!==notice.baselineVersion)throw Error('The baseline changed. Preview the latest changes again.');
            publicPortalBoards={...previous,ttIcReports:{...board,updatedAt:now,days:{...board.days,[date]:{...nextBaseline,revision:notice.revision,publishedAt:now,publishedBy:authorizedRole,notices:{...day.notices,[key]:{...published,publishedAt:now,publishedBy:authorizedRole}}}}}};
            if(!await saveData(['publicPortalBoards'],{publicPortalBoards:[{path:['ttIcReports','days',date,'revision'],value:notice.baselineVersion}]})){publicPortalBoards=previous;return;}
            await refreshActivePublicFeed();renderExamCreatorModule();renderPublicPortalBoards();alert('TT IC changes published.');return;
        }
        if(action==='preview'){
            document.getElementById('tt-morning-preview')?.remove();const modal=document.createElement('dialog');modal.id='tt-morning-preview';modal.className='w-full max-w-7xl rounded p-4';modal.innerHTML=`<button type="button" onclick="this.closest('dialog').remove()">Close ×</button>${timetableNoticeHtml(notice)}`;document.body.appendChild(modal);modal.showModal();return;
        }
        await exportTimetableNotice(notice,action);
    }catch(error){alert(error.message || String(error));}
}
function timetableNoticeHtml(notice){return `<h4 class="font-bold">TT IC — Morning Changes · ${escapeHtml(notice.examTitle)} · ${escapeHtml(notice.date)}</h4><p>Revision ${escapeHtml(notice.revision)} · Baseline ${escapeHtml(notice.baselineVersion)} · Issued ${escapeHtml(new Date(notice.issuedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}))} IST</p>${timetableReportTableHtml(notice.rows, true)}`;}
async function exportTimetableNotice(notice,action){
    const blob=timetableReportSnapshotPdf(notice),title=`TT IC Morning Changes ${notice.examTitle} ${notice.date} revision ${notice.revision}`,file=new File([blob],`TT-IC-Changes-${notice.date}-r${notice.revision}.pdf`,{type:'application/pdf'});
    if(action==='share'&&navigator.share&&navigator.canShare?.({files:[file]})){try{await navigator.share({title,text:title,files:[file]});return;}catch(error){if(error.name==='AbortError')return;}}
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=file.name;a.click();
    if(action==='print')window.open(url,'_blank');else {window.open('https://wa.me/?text='+encodeURIComponent(title),'_blank','noopener,noreferrer');alert('PDF downloaded. Attach the downloaded report in WhatsApp.');}setTimeout(()=>URL.revokeObjectURL(url),120000);
}
function exportPublicTimetableNotice(date,key,action){const board=visiblePortalBoards().ttIcReports,notice=board?.days?.[date]?.notices?.[key];if(notice)return exportTimetableNotice(notice,action);}
