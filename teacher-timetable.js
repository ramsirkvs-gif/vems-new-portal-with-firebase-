/* Pure timetable comparison: intervals are [start,end), dates use the school calendar. */
const TeacherTimetablePlanner = (() => {
    const key = value => String(value || '').toUpperCase().replace(/\b(DR|MR|MRS|MS|MISS)\b/g, '').replace(/[^A-Z0-9]/g, '');
    function dayKey(date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return '';
        const parsed = new Date(date + 'T00:00:00Z');
        return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? ['SUN','MON','TUES','WED','THU','FRI','SAT'][parsed.getUTCDay()] : '';
    }
    function nextDate(date) {
        if (!dayKey(date)) return '';
        const parsed = new Date(date + 'T00:00:00Z'); parsed.setUTCDate(parsed.getUTCDate() + 1);
        return parsed.toISOString().slice(0,10);
    }
    const minutes = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '') ? Number(value.slice(0,2))*60 + Number(value.slice(3)) : null;
    const validWindow = (from,to) => minutes(from) !== null && minutes(to) !== null && minutes(from) < minutes(to);
    const overlaps = (a,b,c,d) => validWindow(a,b) && validWindow(c,d) && minutes(a)<minutes(d) && minutes(c)<minutes(b);
    function resolve(data, teacher, mappings = {}) {
        if (!teacher) return null;
        const explicit = mappings[String(teacher.id)];
        if (explicit && explicit.teacherName === teacher.name) {
            const row=data.teachers.find(row=>row.id===explicit.sourceId);
            return row && (!explicit.sourceName || explicit.sourceName===row.name) && (!explicit.sourceSha256 || explicit.sourceSha256===data.sha256) ? row : null;
        }
        const matches = data.teachers.filter(row => key(row.name) === key(teacher.name));
        return matches.length === 1 ? matches[0] : null;
    }
    function daily(data, teacher, date, mappings = {}) {
        const record = resolve(data,teacher,mappings), day = dayKey(date), entries = record?.days[day];
        return {record,day,known:Array.isArray(entries) && entries.length === data.periods.length,
            periods:data.periods.map((period,index)=>({...period,entry:entries?.[index] || ''}))};
    }
    function compare(data, teacher, date, from, to, mappings = {}) {
        const today = daily(data,teacher,date,mappings), valid = validWindow(from,to);
        const affected = today.known && valid ? today.periods.filter(p=>overlaps(from,to,p.start,p.end)) : [];
        return {...today,valid,from,to,classes:affected.filter(p=>p.entry),protectedFree:affected.filter(p=>!p.entry)};
    }
    function fullWindow(exam,date) {
        const slots = (exam?.datesheetSnapshot || []).find(day=>day.dateStr===date)?.paperSlots || [];
        if (!slots.length || slots.some(slot=>!validWindow(slot.repTime,slot.overTime || slot.endTime))) return {from:'',to:''};
        return {from:slots.map(s=>s.repTime).sort()[0],to:slots.map(s=>s.overTime || s.endTime).sort().at(-1)};
    }
    function duties(exam,date,plans,occupied) {
        const window=fullWindow(exam,date), rows=[];
        occupied.filter(item=>item.date===date).forEach(item=>{
            const roomId=String(item.room.id), record=plans[String(exam.id)]?.[date]?.[roomId] || {}, room=item.room.name || roomId;
            [...new Set((record.invigilators || []).filter(Boolean).map(String))].forEach(teacherId=>rows.push({teacherId,role:'Invigilation',room,...window}));
            if(record.relieverId) rows.push({teacherId:String(record.relieverId),role:'Relieving',room,from:record.reliefReportTime || record.reliefFrom || '',to:record.reliefTo || ''});
        });
        return rows;
    }
    function evaluationPapers(exam,date,teachers,splitSubjects,normalizeSubject) {
        const day=(exam.datesheetSnapshot || []).find(day=>day.dateStr===date), papers=day?.paperSlots || [], byTeacher=new Map();
        teachers.forEach(owner=>(owner.allotments || []).forEach(allotment=>splitSubjects(allotment.subject).forEach(subject=>{
            if(!papers.some(p=>String(p.cls)===String(allotment.cls) && normalizeSubject(p.subject)===normalizeSubject(subject) && (!(p.selectedSections || []).length || p.selectedSections.map(String).includes(String(allotment.sec))))) return;
            const resolveId=value=>teachers.find(t=>String(t.id)===String(value) || t.name===value)?.id;
            const evaluator=(!allotment.evaluator || allotment.evaluator==='Self')?owner.id:resolveId(allotment.evaluator);
            const ids=new Set([owner.id,evaluator,resolveId(allotment.additionalEvaluator)].filter(value=>value!==undefined && value!==null && value!==''));
            ids.forEach(id=>{const k=String(id);if(!byTeacher.has(k))byTeacher.set(k,new Set());byTeacher.get(k).add(`Class ${allotment.cls}-${allotment.sec} ${subject}`);});
        })));
        papers.forEach(slot=>(slot.selectedSections?.length ? slot.selectedSections : ['']).forEach(section=>{
            const id=exam.duringExamEvaluatorAssignments?.[`${day.id}|${slot.slotId}|${section || '-'}`]?.teacherId;
            if(!id)return;
            const k=String(id);if(!byTeacher.has(k))byTeacher.set(k,new Set());
            byTeacher.get(k).add(`Class ${slot.cls}${section ? '-'+section : ''} ${slot.subject} (emergency evaluator)`);
        }));
        return byTeacher;
    }
    function suspendedClasses(exam,date) {
        const confirmed=['2026-11-12','2026-11-13'].includes(date)?['10','12']:date>='2026-11-16'&&date<='2026-11-21'?['10','11','12']:[];
        return new Set([...confirmed,...(exam?.ttSuspendedClasses?.[date] || [])].map(String));
    }
    function classify(exam,date,periods) {
        const suspended=suspendedClasses(exam,date),running=[],stopped=[];
        periods.forEach(p=>{
            const matches=[...p.entry.matchAll(/\b(1[0-2]|[1-9])\s*[-]?\s*([A-Z])\b/g)];
            if(!matches.length){running.push({...p,entry:p.entry+' (class not recognised: review)'});return;}
            const split=flag=>matches.filter(m=>suspended.has(String(Number(m[1])))===flag).map(m=>m[0]);
            if(split(true).length)stopped.push({...p,entry:split(false).length?split(true).join(' + '):p.entry});
            if(split(false).length)running.push({...p,entry:split(true).length?split(false).join(' + '):p.entry});
        });return {running,suspended:stopped};
    }
    function report(data,exam,date,teachers,plans,occupied,mappings) {
        const byTeacher=new Map();
        duties(exam,date,plans,occupied).forEach(duty=>{
            if(!byTeacher.has(duty.teacherId))byTeacher.set(duty.teacherId,{teacherId:duty.teacherId,teacher:teachers.find(t=>String(t.id)===duty.teacherId),duties:[]});
            const row=byTeacher.get(duty.teacherId);row.duties.push({...duty,comparison:compare(data,row.teacher,date,duty.from,duty.to,mappings)});
        });
        byTeacher.forEach(row=>row.duties.forEach(duty=>Object.assign(duty.comparison,classify(exam,date,duty.comparison.classes))));
        return [...byTeacher.values()].sort((a,b)=>String(a.teacher?.name || a.teacherId).localeCompare(String(b.teacher?.name || b.teacherId)));
    }
    return {suspendedClasses,classify,key,dayKey,nextDate,minutes,validWindow,overlaps,resolve,daily,compare,fullWindow,duties,evaluationPapers,report};
})();
if(typeof module!=='undefined')module.exports=TeacherTimetablePlanner;
