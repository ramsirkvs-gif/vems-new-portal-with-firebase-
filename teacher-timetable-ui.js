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
function timetableReportDates(exam){return [...new Set((exam.datesheetSnapshot || []).flatMap(day=>[day.dateStr,TeacherTimetablePlanner.nextDate(day.dateStr)]).filter(Boolean))].sort();}
function timetableReportRows(exam,date){return timetableReportRowsFromSources(exam,date,teachers,invigilationPlans,occupiedInvigilationRooms(exam),timetableMappings(),coreTeamRows());}
function timetableReportRowsFromSources(exam,date,staff,plans,occupied,mappings,coreRows){
    const extra=[];
    if((exam.datesheetSnapshot || []).some(day=>day.dateStr===date)){
        coreRows.forEach(row=>extra.push({teacherId:String(row.teacherId),role:`Core examination team: ${row.role || 'coordination'}`,room:'Examination Cell'}));
        Object.entries(exam.afterExamRecords?.[date]?.collectionDuty || {}).forEach(([roomId,record])=>{if(record.teacherId)extra.push({teacherId:String(record.teacherId),role:'Bundle collection',room:record.roomName || roomId});});
    }
    return TeacherTimetablePlanner.report(VEMSTeacherTimetable,exam,date,staff,plans,occupied,mappings,allotmentSubjectParts,normalizedSubjectMatch,extra);
}
function timetableReportTeacherLines(row,date){
    const lines=[];
    row.duties.forEach(duty=>{
        lines.push(`${duty.role} | ${duty.room} | ${duty.from || 'time not entered'} - ${duty.to || 'time not entered'}`);
        const c=duty.comparison;if(!c)return;
        if(!c.record)lines.push('TT NOT LINKED: availability is unknown. Please confirm this teacher’s timetable.');
        else if(!c.known)lines.push('NO TIMETABLE FOR THIS DAY: availability is unknown.');
        if(!c.valid)lines.push('DUTY TIMES INCOMPLETE/INVALID: class clashes cannot be confirmed.');
        if(c.known && c.valid){
            lines.push('Replacement cover requested:');
            if(c.classes.length)c.classes.forEach(p=>lines.push('  '+timetablePeriodText(p)));else lines.push('  No scheduled class overlaps this duty window.');
            lines.push('Free periods protected during duty: '+(c.protectedFree.map(p=>`P-${p.label} ${p.start}-${p.end}`).join('; ') || 'None'));
        }
    });
    if(row.duties.length)lines.push(`TT IC requested: avoid all additional arrangements for this teacher on ${date}, including timetable free periods during exam/relief duty.`);
    if(row.evaluation.length)lines.push(`TT IC requested: avoid arrangements on ${date} for bundle evaluation following yesterday’s exam: ${[...new Set(row.evaluation)].join('; ')}.`);
    if(row.nextEvaluation.length)lines.push(`TT IC requested: avoid arrangements on ${TeacherTimetablePlanner.nextDate(date)} for bundle evaluation after today’s papers: ${[...new Set(row.nextEvaluation)].join('; ')}.`);
    return lines;
}
function changeTimetableReportDate(date,examId){selectedTimetableReportDate=date;const exam=archivedExams.find(e=>String(e.id)===String(examId)),mount=document.getElementById('timetable-ic-report');if(exam && mount)mount.outerHTML=timetableReportPanelHtml(exam,date,true);}
function timetableReportPanelHtml(exam,date,manual=false){
    if(!timetableStaffAccess())return '';
    const dates=timetableReportDates(exam),plannerKey=`${exam.id}|${date}`;if(!manual && timetableReportPlannerKey!==plannerKey){selectedTimetableReportDate=date;timetableReportPlannerKey=plannerKey;}if(!dates.includes(selectedTimetableReportDate))selectedTimetableReportDate=date;
    const reportDate=selectedTimetableReportDate, rows=timetableReportRows(exam,reportDate);
    return `<section id="timetable-ic-report" class="space-y-3 rounded-xl border-2 border-cyan-300 bg-cyan-50 p-4"><div class="flex flex-wrap items-center justify-between gap-2"><div><h4 class="font-extrabold text-indigo-950">TT IC — Daywise Exam Duty &amp; Arrangement Requests</h4><p class="text-[10px] text-slate-600">Working copy of current assignments. Save duties, then Publish this report date to Public View. Later edits require Update Published Copy. Requests require TT IC action; replacement teachers are not automatically allocated.</p></div><div class="flex flex-wrap gap-2"><button type="button" onclick="printTimetableIcReport(${jsArg(exam.id)},${jsArg(reportDate)})" class="rounded bg-indigo-700 px-4 py-2 text-xs font-bold text-white">PDF / Print TT IC Report</button>${timetableReportPublishControls(exam,reportDate)}</div></div><label class="block text-xs font-bold">Report date (includes following-day evaluation)<select aria-label="TT IC report date" onchange="changeTimetableReportDate(this.value,${jsArg(exam.id)})" class="mt-1 block rounded border bg-white p-2">${dates.map(d=>`<option value="${escapeHtml(d)}" ${d===reportDate?'selected':''}>${escapeHtml(formatDateWithDay(d))}</option>`).join('')}</select></label><p class="text-[10px]">Period times (IST): ${VEMSTeacherTimetable.periods.map(p=>`P-${p.label} ${p.start}–${p.end}`).join(' · ')}. Break 11:00–11:30.</p><details><summary class="cursor-pointer text-xs font-bold">View ${rows.length} teacher request(s) for ${escapeHtml(formatDateWithDay(reportDate))}</summary><div class="mt-2 space-y-2">${rows.map(row=>`<article class="rounded border bg-white p-3 text-[11px]"><b>${escapeHtml(row.teacher?.name || `Unknown teacher (${row.teacherId})`)}</b>${timetableReportTeacherLines(row,reportDate).map(line=>`<p class="mt-1">${escapeHtml(line)}</p>`).join('')}</article>`).join('') || '<p>No exam duty or evaluation request recorded for this date.</p>'}</div></details>${timetableLinkControlsHtml()}</section>`;
}
function timetableIcReportPdfBlob(exam,date){return timetableReportSnapshotPdf(timetableReportSnapshot(exam,date));}
function timetableReportSnapshotPdf(snapshot){
    const rows=timetableReportList(snapshot.rows),date=snapshot.date, streams=[];
    const clean=value=>String(value).normalize('NFKD').replace(/[^\x20-\x7E]/g,'-').replace(/([\\()])/g,'\\$1');
    const text=(value,x,y,size=9)=>`BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${clean(value)}) Tj ET\n`;
    const wrap=(value,max=103)=>{const lines=[];let line='';for(const word of String(value).split(/\s+/)){if((line+' '+word).trim().length>max && line){lines.push(line);line='';}for(let i=0;i<word.length;i+=max){const part=word.slice(i,i+max);if(i+max<word.length){if(line){lines.push(line);line='';}lines.push(part);}else line=(line+' '+part).trim();}}if(line)lines.push(line);return lines;};
    let stream='',y=0,page=0;
    const newPage=()=>{if(stream)streams.push(stream);page++;stream=text('PM SHRI KENDRIYA VIDYALAYA NO. 1, ITANAGAR',55,808,12)+text('TT IC - EXAM DUTY & ARRANGEMENT REQUESTS',55,790,11)+text(`${snapshot.examTitle} | ${date} | Page ${page}`,35,770,9)+text(snapshot.publishedAt?'Published report. Requests for TT IC action.':'Working copy: save exam duties before sharing. Requests for TT IC action.',35,754,8);y=730;};
    newPage();
    const line=value=>{for(const part of wrap(value)){if(y<48)newPage();stream+=text(part,35,y);y-=13;}};
    line(`Timetable: ${snapshot.source}`);
    if(snapshot.publishedAt)line(`Published: ${new Date(snapshot.publishedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} (IST)`);
    line('Period times (IST): '+timetableReportList(snapshot.periods).map(p=>`P-${p.label} ${p.start}-${p.end}`).join(' | '));
    line('Break: 11:00-11:30. Any partial overlap needs cover for the affected class period.');
    line('Evaluation protection uses the following calendar date, including dates with no exam.');
    rows.forEach((row,index)=>{y-=10;if(y<90)newPage();line(`${index+1}. ${row.name || `Unknown teacher (${row.teacherId})`} | ${row.designation || ''}`);timetableReportList(row.lines).forEach(line);});
    if(!rows.length)line('No duty or evaluation requests recorded for this date.');
    y-=15;line('Requested by: Examination IC                         For action: Timetable IC');streams.push(stream);
    return createPdfFromStreams(streams);
}
function printTimetableIcReport(examId,date){
    if(!timetableStaffAccess()){alert('Sign in as an examination-team member.');return;}
    const exam=archivedExams.find(e=>String(e.id)===String(examId));if(!exam || !timetableReportDates(exam).includes(date))return;
    if(sharedStore?.pendingCount){alert('Wait for pending saves before printing the TT IC report.');return;}
    const url=URL.createObjectURL(timetableIcReportPdfBlob(exam,date));window.open(url,'_blank');setTimeout(()=>URL.revokeObjectURL(url),120000);
}

function timetableReportList(value){return Array.isArray(value)?value.filter(Boolean):value&&typeof value==='object'?Object.values(value).filter(Boolean):[];}
function timetableReportSnapshot(exam,date,reportRows=null){
    return {examId:exam.id,examTitle:String(exam.title || 'Examination'),date,source:VEMSTeacherTimetable.source,
        periods:VEMSTeacherTimetable.periods.map(p=>({label:p.label,start:p.start,end:p.end})),
        rows:(reportRows || timetableReportRows(exam,date)).map(row=>({teacherId:String(row.teacherId),name:String(row.teacher?.name || `Unknown teacher (${row.teacherId})`),designation:String(row.teacher?.desig || ''),lines:timetableReportTeacherLines(row,date)}))};
}
function timetableConfirmedReportSnapshot(examId,date){
    const read=name=>normalizeSharedUiValue(name,sharedStore.view(name)),exams=Object.values(read('archivedExams')),exam=exams.find(e=>String(e.id)===String(examId));
    if(!exam || !timetableReportDates(exam).includes(date))return null;
    const staff=Object.values(read('teachers')),plans=read('invigilationPlans'),seating=read('seatingPlans'),core=Object.values(read('examCoreTeam')).filter(row=>row?.teacherId),mappings=read('circularSettings')._teacherTimetableMatches || {},dates=new Set(exam.datesheetSnapshot.map(day=>day.dateStr));
    const occupied=Object.entries(seating[String(exam.id)] || {}).filter(([day])=>dates.has(day)).flatMap(([day,plan])=>actualOccupiedRoomRows(plan).map(room=>({...room,date:day})));
    return timetableReportSnapshot(exam,date,timetableReportRowsFromSources(exam,date,staff,plans,occupied,mappings,core));
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
    if(!saved || timetableSnapshotSignature(saved)!==timetableSnapshotSignature(working)){alert('Save the current duty, seating, evaluator or timetable changes before publishing this TT IC report.');return false;}
    const previous=publicPortalBoards.ttIcReports,same=String(previous?.examId)===String(exam.id),now=new Date().toISOString(),days={...(same?previous.days || {}:{}),[date]:{...saved,publishedAt:now,publishedBy:authorizedRole}};
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
function visiblePublicTimetableDays(board){return board?.days&&typeof board.days==='object'?board.days:{};}
function renderPublicTimetableReport(boards=visiblePortalBoards()){
    const section=document.getElementById('public-tt-ic-report-section'),content=document.getElementById('public-tt-ic-report-content');if(!section || !content)return;
    const board=boards.ttIcReports,days=visiblePublicTimetableDays(board),dates=Object.keys(days).sort(),previous=document.getElementById('public-tt-ic-report-date')?.value,date=dates.includes(previous)?previous:dates.includes(board?.lastPublishedDate)?board.lastPublishedDate:dates.at(-1);
    section.classList.toggle('hidden',!dates.length);if(!date){content.innerHTML='';return;}
    const snapshot=days[date],rows=timetableReportList(snapshot.rows);
    content.innerHTML=`<div class="flex flex-wrap items-end justify-between gap-3"><div><b class="block text-sm text-indigo-950">${escapeHtml(snapshot.examTitle || board.examTitle || 'Examination')}</b><label class="mt-2 block text-xs font-bold">Published report date<select id="public-tt-ic-report-date" onchange="renderPublicTimetableReport()" class="mt-1 block max-w-full rounded border bg-white p-2">${dates.map(d=>`<option value="${escapeHtml(d)}" ${d===date?'selected':''}>${escapeHtml(formatDateWithDay(d))}</option>`).join('')}</select></label></div><div class="flex flex-wrap gap-2"><button type="button" onclick="printPublicTimetableIcReport()" class="public-export-button rounded bg-indigo-700 px-3 py-2 text-xs font-bold text-white">PDF / Print TT IC Report</button><button type="button" onclick="sharePublicTimetableIcReport()" class="public-export-button rounded bg-emerald-700 px-3 py-2 text-xs font-bold text-white">Share PDF to WhatsApp</button></div></div><p class="mt-3 text-xs text-slate-600">${rows.length} teacher request(s) · Requests to TT IC for replacement cover and arrangement protection. Published copy; replacement staff must be allocated by TT IC.</p><div class="mt-3 max-h-96 space-y-3 overflow-auto rounded border bg-white p-3">${rows.map((row,index)=>`<article class="rounded-lg border border-cyan-200 bg-cyan-50/40 p-3"><div class="flex gap-2"><span class="rounded bg-indigo-900 px-2 py-1 text-xs font-bold text-white">${index+1}</span><div><b class="text-sm text-indigo-950">${escapeHtml(row.name)}</b><p class="text-[11px] text-slate-500">${escapeHtml(row.designation || '')}</p></div></div><ul class="mt-2 list-disc space-y-1 pl-5 text-xs leading-5">${timetableReportList(row.lines).map(line=>`<li class="break-words">${escapeHtml(line)}</li>`).join('')}</ul></article>`).join('') || '<p class="p-3 text-center text-xs text-slate-500">No duty or evaluation requests were recorded in this published report.</p>'}</div>`;
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
