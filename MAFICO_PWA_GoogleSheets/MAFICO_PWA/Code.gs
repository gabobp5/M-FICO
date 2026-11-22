/** MAFICO · Backend privado de Google Sheets vía API executable.
 * 1. Crea Google Sheet y pega el ID.
 * 2. Vincula este Apps Script al mismo proyecto STANDARD de Cloud que el OAuth web.
 * 3. Despliega como API ejecutable y autoriza con TU cuenta.
 * Acceso restringido por OAuth + permisos de Google Sheets. Nunca publiques una web app pública con privilegios de dueño.
 */
const MAFICO_SHEET_ID = 'PEGA_AQUI_ID_GOOGLE_SHEETS';
const MAFICO_FIELDS = ['products','clients','sales','expenses','packs','gifts','costBatches'];
function sheet_(name) {
  const book=SpreadsheetApp.openById(MAFICO_SHEET_ID);
  return book.getSheetByName(name)||book.insertSheet(name);
}
function maficoRead(){
  const props=PropertiesService.getScriptProperties();
  const rev=Number(props.getProperty('revision')||0);
  if(!rev)return {revision:0,data:''};
  const bank=props.getProperty('bank')||'A';
  const sh=sheet_('DATA_'+bank);
  const n=sh.getLastRow();
  if(!n)return {revision:rev,data:''};
  const rows=sh.getRange(1,1,n,1).getDisplayValues();
  return {revision:rev,data:rows.map(r=>r[0]).join('')};
}
function maficoWrite(baseRevision,json){
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(25000))throw Error('La nube está ocupada. Intenta otra vez.');
  try{
    const props=PropertiesService.getScriptProperties();
    const actual=Number(props.getProperty('revision')||0);
    if(Number(baseRevision)!==actual)return {conflict:true,revision:actual};
    if(typeof json!=='string'||json.length>4000000)throw Error('Datos inválidos o demasiado grandes (máximo 4 MB).');
    const parsed=JSON.parse(json);
    if(!parsed||!MAFICO_FIELDS.every(k=>Array.isArray(parsed[k])))throw Error('Estructura MAFICO inválida.');
    const bank=(props.getProperty('bank')||'A')==='A'?'B':'A';
    const sh=sheet_('DATA_'+bank);
    const chunks=json.match(/[\s\S]{1,30000}/g)||[''];
    sh.clearContents();
    if(chunks.length>sh.getMaxRows())sh.insertRowsAfter(sh.getMaxRows(),chunks.length-sh.getMaxRows());
    sh.getRange(1,1,chunks.length,1).setNumberFormat('@');
    sh.getRange(1,1,chunks.length,1).setValues(chunks.map(s=>[s]));
    SpreadsheetApp.flush();
    props.setProperties({bank,revision:String(actual+1)});
    return {revision:actual+1,conflict:false};
  }finally{lock.releaseLock()}
}
