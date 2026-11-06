const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const helpers=['automaticWeeklyHolidayName','holidaySessionBounds','automaticWeeklyHolidayEntries','manualDatedHolidayEntries','isSecondSaturday','dateSheetDay','holidayCsvCell','completeHolidayExportRows','completeHolidayCsvBlob','downloadCompleteHolidayCSV'];
function setup(){
    const calendar={'2026-11-08':{accountOf:'Portal-only custom holiday',remark:'OTHER',note:'Exactly as uploaded',source:'School upload'},'2026-10-02':'Literal portal holiday',__locked:true,__breaks:[{name:'Uploaded Vacation',from:'2026-12-23',to:'2027-01-11',days:20}],__pending:[{accountOf:'School Annual Event',remark:'RH',note:'Date not decided by Principal'}]};
    const c={Blob,Date,selectedAcademicSession:'2026-27',holidayCalendar:calendar,sharedStore:{ready:true,pendingCount:0},alerts:[],downloads:[],alert:value=>c.alerts.push(value),document:{createElement:()=>({click(){c.downloads.push(this.download);}})},URL:{createObjectURL:blob=>{c.lastBlob=blob;return'blob:holiday-csv';},revokeObjectURL(){}},setTimeout(){},tentativeHolidaySeed2026(){throw new Error('Export must never seed or invent holiday records');}};
    vm.createContext(c);for(const name of helpers){const start=source.indexOf(`        function ${name}(`);assert(start>=0,name);const next=/^        (?:async )?function /gm;next.lastIndex=start+20;vm.runInContext(source.slice(start,next.exec(source)?.index||source.length),c);}return c;
}
test('export uses saved portal names and ranges without filling from the built-in sample list',()=>{
    const c=setup(),before=JSON.stringify(c.holidayCalendar),rows=c.completeHolidayExportRows();assert.ok(rows.some(row=>row.name==='Portal-only custom holiday'&&row.remark==='OTHER'&&row.source==='School upload'));assert.ok(rows.some(row=>row.name==='Literal portal holiday'));assert.ok(rows.some(row=>row.name==='Uploaded Vacation'&&row.date==='2026-12-23'&&row.to==='2027-01-11'&&row.days===20));assert.doesNotMatch(JSON.stringify(rows),/Diwali|Republic Day|Summer Vacation|Christmas/);assert.equal(JSON.stringify(c.holidayCalendar),before,'read-only export cannot alter the locked holiday calendar');
});
test('every Sunday and second Saturday matches the portal generator, including overlaps with manual holidays',()=>{
    const c=setup(),rows=c.completeHolidayExportRows(),weekly=c.automaticWeeklyHolidayEntries(),exported=rows.filter(row=>row.type==='Automatic weekly closure');assert.equal(exported.length,weekly.length);for(const[date,value]of weekly)assert.ok(exported.some(row=>row.date===date&&row.name===value.accountOf));const overlap=rows.filter(row=>row.date==='2026-11-08');assert.ok(overlap.some(row=>row.name==='Sunday'));assert.ok(overlap.some(row=>row.name==='Portal-only custom holiday'));assert.ok(rows.some(row=>row.date==='2026-11-14'&&row.name==='Second Saturday'));assert.ok(rows.some(row=>row.date==='2027-01-03'&&row.name==='Sunday'),'weekly closures follow portal session bounds, including the next-year portion');
});
test('pending events retain undecided dates and notes instead of acquiring guessed dates',()=>{
    const c=setup(),pending=c.completeHolidayExportRows().find(row=>row.name==='School Annual Event');assert.equal(pending.date,'');assert.equal(pending.to,'');assert.equal(pending.type,'Date to be decided');assert.equal(pending.note,'Date not decided by Principal');assert.equal(pending.remark,'RH');
});
test('Excel CSV has UTF-8 BOM, CRLF and correct quoting for original commas, quotes and line breaks',async()=>{
    const c=setup();c.holidayCalendar['2026-01-01']={accountOf:'Portal, "Name"\nsecond line',remark:'GH'};const blob=c.completeHolidayCsvBlob(),bytes=new Uint8Array(await blob.arrayBuffer()),csv=new TextDecoder().decode(bytes);assert.deepEqual(Array.from(bytes.slice(0,3)),[239,187,191]);assert.match(csv,/S.No.,Date \/ From,To,Day,On Account Of/);assert.match(csv,/"Portal, ""Name""\nsecond line"/);assert.match(csv,/\r\n/);assert.equal(blob.type,'text/csv;charset=utf-8');
});
test('download reads confirmed records, works with a locked list and uses the selected portal session',()=>{
    const c=setup();c.downloadCompleteHolidayCSV();assert.deepEqual(c.downloads,['KVS_Complete_Holiday_List_2026-27.csv']);assert.ok(c.lastBlob);c.sharedStore.pendingCount=1;c.downloadCompleteHolidayCSV();assert.equal(c.downloads.length,1);assert.match(c.alerts[0],/pending save/);
});
test('an empty or unloaded calendar cannot be passed off as a complete saved export',()=>{
    const c=setup();c.sharedStore.ready=false;c.downloadCompleteHolidayCSV();assert.equal(c.downloads.length,0);c.sharedStore.ready=true;c.holidayCalendar={};c.downloadCompleteHolidayCSV();assert.equal(c.downloads.length,0);assert.match(c.alerts.at(-1),/No saved holiday/);
});
