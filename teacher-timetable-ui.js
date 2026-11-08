/* Staff workflow only. No timetable is added to the public publication feeds. */
let selectedTimetableReportDate='';
let timetableReportPlannerKey='';
function timetableStaffAccess(){return ['principal','sec-ic','pri-ic'].includes(authorizedRole);}
function timetableMappings(){return circularSettings._teacherTimetableMatches || {};}
function timetablePeriodText(period){return `P-${period.label} ${period.start}–${period.end}: ${period.entry || 'Free (blank TT entry)'}`;}
function timetableOptionBrief(teacher,date){
    const today=TeacherTimetablePlanner.daily(VEMSTeacherTimetable,teacher,date,timetableMappings());
    if(!today.record)return 'TT: not linked';
    if(!today.known)return `TT: no ${today.day || 'dated'} schedule`;
    return 'TT: '+today.periods.map(p=>`${p.label}:${p.entry ? (p.entry.match(/\b\d{1,2}[A-E]\b/g)?.filter((v,i,a)=>a.indexOf(v)===i).join('+') || 'class') : 'free'}`).join(' ');
}
function timetableDutyBriefHtml(exam,date,teacherId,field,record={}){
    if(!timetableStaffAccess() || !teacherId)return '';
    const teacher=teachers.find(t=>String(t.id)===String(teacherId)), window=field==='relieverId'?{from:record.reliefFrom,to:record.reliefTo}:TeacherTimetablePlanner.fullWindow(exam,date);
    const comparison=TeacherTimetablePlanner.compare(VEMSTeacherTimetable,teacher,date,window.from,window.to,timetableMappings());
    let warning=!comparison.record?'Timetable not linked. Link this teacher below; availability cannot be confirmed.':!comparison.known?`No timetable row for ${comparison.day || 'this date'}; availability cannot be confirmed.`:!comparison.valid?'Enter valid duty start and finish times to check clashes.':'';
    return `<div data-timetable-duty="${escapeHtml(String(teacherId))}" class="mt-2 rounded border border-indigo-200 bg-indigo-50 p-2 text-[10px] leading-5"><b>${escapeHtml(teacher?.name || teacherId)} · ${escapeHtml(formatDateWithDay(date))}</b>${warning?`<p class="font-bold text-red-800">${escapeHtml(warning)}</p>`:''}${comparison.known?`<details><summary class="cursor-pointer font-bold">Today’s timetable · ${comparison.periods.filter(p=>p.entry).length} teaching periods</summary>${comparison.periods.map(p=>`<div>${escapeHtml(timetablePeriodText(p))}</div>`).join('')}</details>`:''}${comparison.valid && comparison.known?`<p class="mt-1 font-bold text-amber-900">TT IC: arrange replacement cover for ${escapeHtml(comparison.classes.map(timetablePeriodText).join('; ') || 'no overlapping scheduled classes')}.</p><p>Protect free periods during duty: ${escapeHtml(comparison.protectedFree.map(p=>`P-${p.label} (${p.start}–${p.end})`).join(', ') || 'None in this duty window')}. Do not assign arrangements during duty.</p>`:''}<p class="font-bold">TT IC requested: no additional arrangement on this exam-duty date.</p></div>`;
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
function timetableReportRows(exam,date){
    const extra=[];
    if((exam.datesheetSnapshot || []).some(day=>day.dateStr===date)){
        coreTeamRows().forEach(row=>extra.push({teacherId:String(row.teacherId),role:`Core examination team: ${row.role || 'coordination'}`,room:'Examination Cell'}));
        Object.entries(exam.afterExamRecords?.[date]?.collectionDuty || {}).forEach(([roomId,record])=>{if(record.teacherId)extra.push({teacherId:String(record.teacherId),role:'Bundle collection',room:record.roomName || roomId});});
    }
    return TeacherTimetablePlanner.report(VEMSTeacherTimetable,exam,date,teachers,invigilationPlans,occupiedInvigilationRooms(exam),timetableMappings(),allotmentSubjectParts,normalizedSubjectMatch,extra);
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
    return `<section id="timetable-ic-report" class="space-y-3 rounded-xl border-2 border-cyan-300 bg-cyan-50 p-4"><div class="flex flex-wrap items-center justify-between gap-2"><div><h4 class="font-extrabold text-indigo-950">TT IC — Daywise Exam Duty &amp; Arrangement Requests</h4><p class="text-[10px] text-slate-600">Working copy of current assignments. Save duties before sharing. Requests require TT IC action; replacement teachers are not automatically allocated.</p></div><button type="button" onclick="printTimetableIcReport(${jsArg(exam.id)},${jsArg(reportDate)})" class="rounded bg-indigo-700 px-4 py-2 text-xs font-bold text-white">PDF / Print TT IC Report</button></div><label class="block text-xs font-bold">Report date (includes following-day evaluation)<select aria-label="TT IC report date" onchange="changeTimetableReportDate(this.value,${jsArg(exam.id)})" class="mt-1 block rounded border bg-white p-2">${dates.map(d=>`<option value="${escapeHtml(d)}" ${d===reportDate?'selected':''}>${escapeHtml(formatDateWithDay(d))}</option>`).join('')}</select></label><p class="text-[10px]">Period times (IST): ${VEMSTeacherTimetable.periods.map(p=>`P-${p.label} ${p.start}–${p.end}`).join(' · ')}. Break 11:00–11:30.</p><details><summary class="cursor-pointer text-xs font-bold">View ${rows.length} teacher request(s) for ${escapeHtml(formatDateWithDay(reportDate))}</summary><div class="mt-2 space-y-2">${rows.map(row=>`<article class="rounded border bg-white p-3 text-[11px]"><b>${escapeHtml(row.teacher?.name || `Unknown teacher (${row.teacherId})`)}</b>${timetableReportTeacherLines(row,reportDate).map(line=>`<p class="mt-1">${escapeHtml(line)}</p>`).join('')}</article>`).join('') || '<p>No exam duty or evaluation request recorded for this date.</p>'}</div></details>${timetableLinkControlsHtml()}</section>`;
}
function timetableIcReportPdfBlob(exam,date){
    const rows=timetableReportRows(exam,date), streams=[];
    const clean=value=>String(value).normalize('NFKD').replace(/[^\x20-\x7E]/g,'-').replace(/([\\()])/g,'\\$1');
    const text=(value,x,y,size=9)=>`BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${clean(value)}) Tj ET\n`;
    const wrap=(value,max=103)=>{const lines=[];let line='';for(const word of String(value).split(/\s+/)){if((line+' '+word).trim().length>max && line){lines.push(line);line='';}for(let i=0;i<word.length;i+=max){const part=word.slice(i,i+max);if(i+max<word.length){if(line){lines.push(line);line='';}lines.push(part);}else line=(line+' '+part).trim();}}if(line)lines.push(line);return lines;};
    let stream='',y=0,page=0;
    const newPage=()=>{if(stream)streams.push(stream);page++;stream=text('PM SHRI KENDRIYA VIDYALAYA NO. 1, ITANAGAR',55,808,12)+text('TT IC - EXAM DUTY & ARRANGEMENT REQUESTS',55,790,11)+text(`${exam.title} | ${date} | Page ${page}`,35,770,9)+text('Working copy: save exam duties before sharing. Requests for TT IC action.',35,754,8);y=730;};
    newPage();
    const line=value=>{for(const part of wrap(value)){if(y<48)newPage();stream+=text(part,35,y);y-=13;}};
    line(`Timetable: ${VEMSTeacherTimetable.source}`);
    line('Period times (IST): '+VEMSTeacherTimetable.periods.map(p=>`P-${p.label} ${p.start}-${p.end}`).join(' | '));
    line('Break: 11:00-11:30. Any partial overlap needs cover for the affected class period.');
    line('Evaluation protection uses the following calendar date, including dates with no exam.');
    rows.forEach((row,index)=>{y-=10;if(y<90)newPage();line(`${index+1}. ${row.teacher?.name || `Unknown teacher (${row.teacherId})`} | ${row.teacher?.desig || ''}`);timetableReportTeacherLines(row,date).forEach(line);});
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
