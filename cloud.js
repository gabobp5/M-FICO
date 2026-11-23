/* MAFICO Sync - Conexión directa y simple sin Google Cloud */
(()=>{'use strict';
const CONF_KEY='mafico_simple_url_v1';
const APP_KEY='mafico_business_v1';
const $=id=>document.getElementById(id);

let attached=null, connected=false, revision=0, cloudData='', dirty=false, conflict=false, busy=false, changedWhileBusy=false, pushTimer=0, checking=false;
let config=(()=>{try{return JSON.parse(localStorage.getItem(CONF_KEY))||{}}catch{return {}}})();

const notify=(msg,state='neutral')=>{
  const el=$('cloudStatus');
  if(el){el.textContent=msg;el.dataset.state=state}
  const indicator=$('syncSummary');
  if(indicator){
    indicator.textContent=(state==='success'?'☁ Sincronizado':state==='error'?'⚠ Error':state==='warning'?'◷ Pendiente':'☁ Sin conectar');
    indicator.title=msg;
    indicator.dataset.state=state;
  }
};

function getUrl(){
  const a=$('googleScriptId'), b=$('googleClientId'), c=$('webAppUrl');
  return ((a&&a.value)||(b&&b.value)||(c&&c.value)||config.url||'').trim();
}

function initUI(){
  if($('googleClientId'))$('googleClientId').placeholder='No hace falta llenar esto';
  if($('googleScriptId')){
    $('googleScriptId').placeholder='Pega aquí tu enlace de Google (https://script.google.com/...)';
    $('googleScriptId').value=config.url||'';
  }
  notify('Sin conectar · tus cambios se guardan solo aquí.');
  if($('cloudConnect'))$('cloudConnect').onclick=connect;
  if($('cloudLoad'))$('cloudLoad').onclick=loadCloud;
  if($('cloudUpload'))$('cloudUpload').onclick=uploadLocal;
  if($('cloudDisconnect'))$('cloudDisconnect').onclick=disconnect;
  window.addEventListener('online',()=>{if(connected&&dirty)queuePush();else if(connected)checkCloud()});
  window.addEventListener('focus',()=>{if(connected&&!dirty)checkCloud()});
  setInterval(()=>{if(connected&&!dirty&&document.visibilityState==='visible')checkCloud()},30000);
  if(config.url)connect();
}

function storeConfig(){
  config={url:getUrl()};
  localStorage.setItem(CONF_KEY,JSON.stringify(config));
}

async function apiCall(payload){
  if(!config.url||!config.url.startsWith('https://script.google.com/'))throw Error('Pega el enlace correcto de Google que termina en /exec');
  const res=await fetch(config.url,{
    method:'POST',
    headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify(payload)
  });
  const data=await res.json();
  if(!res.ok||data?.error)throw Error(data?.error||'Error conectando con Google.');
  return data;
}

async function connect(){
  try{
    storeConfig();
    if(!config.url)throw Error('Falta pegar el enlace de Google.');
    connected=true;
    setButtons();
    notify('Conectando con tu hoja de Google…');
    await checkCloud(true);
  }catch(e){
    connected=false;
    setButtons();
    notify('Error: '+e.message,'error');
  }
}

function setButtons(){
  if($('cloudLoad'))$('cloudLoad').disabled=!connected;
  if($('cloudUpload'))$('cloudUpload').disabled=!connected;
  if($('cloudDisconnect'))$('cloudDisconnect').disabled=!connected;
  if($('cloudConnect'))$('cloudConnect').disabled=connected;
}

function disconnect(){
  connected=false;revision=0;cloudData='';dirty=false;conflict=false;
  localStorage.removeItem(CONF_KEY);
  setButtons();
  notify('Desconectado · datos locales conservados.');
}

function normalize(x){
  const o=x||{};
  return ['products','clients','sales','expenses','packs','gifts','costBatches'].every(k=>Array.isArray(o[k]));
}

function localData(){
  return attached?.getData()||JSON.parse(localStorage.getItem(APP_KEY)||'{}');
}

function hasEntries(d){
  return Object.values(d||{}).some(x=>Array.isArray(x)&&x.length>0);
}

function statusAfterRead(remote){
  cloudData=remote.data||'';
  revision=remote.revision||0;
  const current=JSON.stringify(localData());
  if(remote.revision===0){
    notify(hasEntries(localData())?'La hoja está vacía. Pulsa «Subir mis datos» para guardar por primera vez.':'Hoja vacía: registra algo y pulsa «Subir mis datos».','warning');
    return;
  }
  if(remote.data===current){dirty=false;conflict=false;notify('Sincronizado ✓','success');return}
  if(!hasEntries(localData())){notify('Hay datos en Google. Pulsa «Cargar nube» para traerlos aquí.','warning');return}
  notify('Hay datos distintos aquí y en Google. Elige «Subir mis datos» o «Cargar nube».','warning');
}

async function checkCloud(initial=false){
  if(!connected||checking||busy||dirty)return;
  checking=true;
  try{
    const remote=await apiCall({action:'read'});
    if(initial){statusAfterRead(remote)}
    else if(remote.revision!==revision){
      cloudData=remote.data;revision=remote.revision;
      notify('Hay cambios nuevos desde otro dispositivo. Pulsa «Cargar nube».','warning');
      conflict=true;
    }else if(!conflict){
      notify('Sincronizado ✓','success');
    }
  }catch(e){
    notify('Error leyendo Google: '+e.message,'error');
  }finally{
    checking=false;
  }
}

function changed(){
  if(!connected)return;
  dirty=true;changedWhileBusy=true;
  notify('Guardando en Google…','warning');
  clearTimeout(pushTimer);
  pushTimer=setTimeout(queuePush,900);
}

async function queuePush(){
  if(!connected||!dirty||busy||conflict)return;
  busy=true;changedWhileBusy=false;
  const payload=JSON.stringify(localData());
  try{
    if(revision===0&&!cloudData){
      notify('Pulsa «Subir mis datos» una vez para iniciar la copia en Google.','warning');
      return;
    }
    const res=await apiCall({action:'write',baseRevision:revision,json:payload});
    if(res?.conflict){
      conflict=true;
      notify('Conflicto: se editó desde otro dispositivo. Pulsa «Cargar nube».','error');
      return;
    }
    revision=res.revision;cloudData=payload;dirty=changedWhileBusy;
    if(!dirty)notify('Guardado en Google ✓','success');
  }catch(e){
    notify('No se pudo guardar: '+e.message,'error');
  }finally{
    busy=false;
    if(dirty&&!conflict&&connected&&revision>0)setTimeout(queuePush,2500);
  }
}

async function loadCloud(){
  if(!connected)return;
  try{
    const result=await apiCall({action:'read'});
    if(!result.data){notify('La hoja está vacía.','warning');return}
    const obj=JSON.parse(result.data);
    if(!normalize(obj))throw Error('Formato de datos no válido.');
    if(!confirm('Se reemplazarán los datos de ESTE dispositivo por los de Google Sheets. ¿Continuar?'))return;
    attached.replaceData(obj);
    revision=result.revision;cloudData=result.data;conflict=false;dirty=false;
    notify('Datos descargados de Google ✓','success');
  }catch(e){
    notify('Error al descargar: '+e.message,'error');
  }
}

async function uploadLocal(){
  if(!connected||busy)return;
  if(!confirm('Se subirán los datos de ESTE dispositivo a Google Sheets. ¿Continuar?'))return;
  busy=true;
  try{
    const latest=await apiCall({action:'read'});
    revision=latest.revision||0;
    const payload=JSON.stringify(localData());
    const res=await apiCall({action:'write',baseRevision:revision,json:payload});
    if(res?.conflict)throw Error('Alguien más modificó la hoja al mismo tiempo.');
    revision=res.revision;cloudData=payload;dirty=false;conflict=false;
    notify('Datos subidos a Google ✓','success');
  }catch(e){
    notify('Error al subir: '+e.message,'error');
  }finally{
    busy=false;
  }
}

window.MaficoCloud={attach(api){attached=api;initUI()},changed};
})();