/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║       LOOK DESIGNER — Backend Google Apps Script v4.0        ║
 * ║         Studio de Cílios · Agenda + CMS Procedimentos        ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  INSTALAÇÃO:                                                  ║
 * ║  1. Abra seu Google Sheets                                    ║
 * ║  2. Extensões > Apps Script                                   ║
 * ║  3. SUBSTITUA TODO O CÓDIGO por este e salve                  ║
 * ║  4. Implantar > Nova implantação > App da Web               ║
 * ║     - Executar como: Você (seu e-mail)                       ║
 * ║     - Quem acessa: Qualquer pessoa                           ║
 * ║  5. Cole a URL em CFG.API_URL no index.html                  ║
 * ║                                                              ║
 * ║  SCRIPT PROPERTIES (obrigatório):                            ║
 * ║  - admin_password: Sua senha de acesso                       ║
 * ║                                                              ║
 * ║  GATILHO AUTO-RELEASE (opcional):                            ║
 * ║  - Função: autoReleaseExpiredSlots                           ║
 * ║  - Baseado no tempo > A cada 5 minutos                      ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

// ═══════════════ CONFIGURAÇÕES ════════════════════════════════
const ADMIN_PASSWORD  = "";            // Use Script Properties: admin_password
const SHEET_NAME      = "AGENDA";
const CONFIG_SHEET    = "CONFIG";
const LOG_SHEET       = "LOG_SISTEMA";
const TIME_ZONE       = "America/Manaus";
const ONESIGNAL_APP_ID = "1246a184-5550-4e12-b1f4-24efd53c6f02";
const ONESIGNAL_API_KEY = "";          // Use Script Properties: onesignal_api_key

const IMPORTANT_LOG_TYPES = {
  AGENDAMENTO: true, BLOQUEIO: true, LIBERACAO: true,
  CONFIG: true, PUSH_ADMIN: true, ERRO: true
};

// ═══════════════ UTILITÁRIOS ══════════════════════════════════
function getOrCreateSheet(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); if (headers && headers.length) sh.appendRow(headers); }
  return sh;
}
function fmt(val, tz, pattern) {
  try { if (val && typeof val.getFullYear === 'function') return Utilities.formatDate(val, tz, pattern); } catch(e) {}
  return (val || "").toString().trim();
}
function fmtDate(val, tz) { return fmt(val, tz, "yyyy-MM-dd"); }
function fmtTime(val, tz) { const s = fmt(val, tz, "HH:mm"); const m = s.match(/(\d{1,2}:\d{2})/); return m ? m[1].padStart(5,'0') : s; }
function maskName(s) { if(!s||s==="INDISPONÍVEL")return s; return s.split(' ').map(p=>p.length<=1?p:p[0]+"*".repeat(p.length-2)+p[p.length-1]).join(' '); }
function maskPhone(s) { if(!s)return""; const c=s.replace(/\D/g,''); if(c.length<4)return s; return `(${c.substring(0,2)}) ${c.substring(2,3)}****-**${c.slice(-2)}`; }
function maskToken(s) { if(!s)return""; const h=Math.floor(s.length*.5); return "*".repeat(h)+s.substring(h); }
function jsonOut(d) { return ContentService.createTextOutput(JSON.stringify(d)).setMimeType(ContentService.MimeType.JSON); }
function jsOut(cb,d) { return ContentService.createTextOutput(`${cb}(${JSON.stringify(d)})`).setMimeType(ContentService.MimeType.JAVASCRIPT); }
function respond(cb,d) { return cb ? jsOut(cb,d) : jsonOut(d); }
function getAdminPassword() { return (PropertiesService.getScriptProperties().getProperty("admin_password") || ADMIN_PASSWORD || "").trim(); }
function toComparableTime(v) { const s=(v||"").toString().trim(); const m=s.match(/(\d{1,2}):(\d{2})/); return m?`${m[1].padStart(2,"0")}:${m[2]}`:""; }
function makeId_() { return 'proc_'+Utilities.getUuid().replace(/-/g,'').slice(0,18); }
function normalizePhoneValue(p) { let c=(p||"").toString().replace(/\D/g,""); if(c.indexOf("55")===0&&c.length>11)c=c.substring(2); return c; }

// ═══════════════ CONFIG HELPERS ═══════════════════════════════
function getConfig() {
  const defaults = { start:"08:00", end:"20:00", duration:60, pix_value:"0.00" };
  try {
    const saved = PropertiesService.getScriptProperties().getProperties();
    if (!saved.start) return defaults;
    return { start:saved.start||defaults.start, end:saved.end||defaults.end, duration:parseInt(saved.duration)||defaults.duration, pix_value:saved.pix_value||defaults.pix_value };
  } catch(e) { return defaults; }
}
function saveConfig(cfg) {
  let p = (cfg.pix_value||"0.00").toString().replace(",",".").trim();
  if(!p||isNaN(parseFloat(p)))p="0.00";
  PropertiesService.getScriptProperties().setProperties({ start:cfg.start||"08:00", end:cfg.end||"20:00", duration:cfg.duration.toString(), pix_value:p });
  try {
    const ss=SpreadsheetApp.getActiveSpreadsheet();
    const sh=getOrCreateSheet(ss,CONFIG_SHEET,["Início","Fim","Duração","Valor PIX"]);
    sh.getRange(2,1,1,4).setValues([[cfg.start||"08:00",cfg.end||"20:00",Number(cfg.duration),p]]);
  } catch(e) {}
}

// ═══════════════ LOG HELPERS ══════════════════════════════════
function appendLog(ss, entry) {
  const type = (entry.type||"SISTEMA").toString().trim();
  if (!IMPORTANT_LOG_TYPES[type]) return;
  const sh = getOrCreateSheet(ss, LOG_SHEET, ["Data/Hora","Tipo","Data Agend.","Horário","Cliente","Telefone","Token","Mensagem"]);
  sh.appendRow([new Date(), type, entry.dataAgend||"", entry.horario||"", entry.cliente||"", entry.telefone||"", entry.token||"", entry.msg||""]);
}
function getSystemLogs(ss, tz, limit) {
  const sh = ss.getSheetByName(LOG_SHEET); if(!sh)return[];
  const rows = sh.getDataRange().getValues(); if(rows.length<=1)return[];
  return rows.slice(1).filter(r=>r.some(c=>String(c||"").trim()!=="")).filter(r=>IMPORTANT_LOG_TYPES[(r[1]||"").toString().trim()])
    .map(row=>({ timestamp:row[0]&&typeof row[0].getFullYear==='function'?Utilities.formatDate(row[0],tz,"yyyy-MM-dd'T'HH:mm:ss"):String(row[0]||""), displayTime:row[0]&&typeof row[0].getFullYear==='function'?Utilities.formatDate(row[0],tz,"dd/MM/yyyy HH:mm"):String(row[0]||""), type:String(row[1]||"").trim(), dataAgend:String(row[2]||"").trim(), horario:String(row[3]||"").trim(), cliente:String(row[4]||"").trim(), telefone:String(row[5]||"").trim(), token:String(row[6]||"").trim(), msg:String(row[7]||"").trim() }))
    .sort((a,b)=>String(b.timestamp).localeCompare(String(a.timestamp))).slice(0,limit||100);
}
function clearSystemLogs(ss) { const sh=ss.getSheetByName(LOG_SHEET);if(!sh)return 0;const lr=sh.getLastRow();if(lr<=1)return 0;sh.deleteRows(2,lr-1);return lr-1; }

// ═══════════════ ROTA PRINCIPAL ═══════════════════════════════
function doGet(e) {
  const ss=SpreadsheetApp.getActiveSpreadsheet(), tz=ss.getSpreadsheetTimeZone();
  const params=(e&&e.parameter)||{}, cb=params.callback||null;

  if (params.ping) return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);

  const passIn = (params.pass||"").toString().trim();
  const adminOk = getAdminPassword().length>0 && passIn.length>0 && passIn===getAdminPassword();

  // ── update_config via GET ──
  if (params.action==="update_config") {
    if(!adminOk) return respond(cb,{status:"ERRO",message:"Senha incorreta."});
    let vPix=(params.pix_value||"0.00").toString().replace(",",".").trim();
    if(!vPix||isNaN(parseFloat(vPix)))vPix="0.00";
    saveConfig({start:params.start,end:params.end,duration:params.duration,pix_value:vPix});
    appendLog(ss,{type:"CONFIG",msg:`Config salva: R$ ${vPix}`});
  }

  // ── CMS reads ──
  if (params.aba==="ABAS")        return respond(cb, getAbas(ss));
  if (params.aba==="PROCEDIMENTOS") return respond(cb, getProcs(ss));
  if (params.aba==="VIDEO")       return respond(cb, getVideo(ss));
  if (params.aba==="FOTO")        return respond(cb, getFoto(ss));
  if (params.aba==="FOTO_CONFIG") return respond(cb, getFotoConfig(ss));
  if (params.aba==="MIDIA_CONFIG") return respond(cb, getMidiaConfig(ss));

  // ── agenda ──
  const sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) return respond(cb,{status:"ERRO",message:`Aba "${SHEET_NAME}" não encontrada.`});
  const data=sh.getDataRange().getValues(), agenda=[];
  for(let i=1;i<data.length;i++){
    const row=data[i]; if(!row[0]&&!row[1])continue;
    const rowDate=fmtDate(row[0],tz), rowTime=fmtTime(row[1],tz);
    if(!rowDate||!rowTime)continue;
    const status=(row[2]||"Livre").toString().trim();
    const cliente=(row[3]||"").toString().trim(), telefone=(row[4]||"").toString().trim();
    const codigo=(row[5]||"").toString().trim(), bookingTime=(row[6]||"").toString().trim();
    const reservedUntil=(row[7]||"").toString().trim(), log=(row[8]||"").toString().trim();
    const duration=(row[9]||"").toString().trim();
    agenda.push({data:rowDate,horario:rowTime,status,cliente:adminOk?cliente:maskName(cliente),telefone:adminOk?telefone:maskPhone(telefone),codigo:adminOk?codigo:maskToken(codigo),bookingTime:adminOk?bookingTime:"",reservedUntil,log:adminOk?log:"",duration});
  }
  return respond(cb,{status:"OK",agenda,logs:adminOk?getSystemLogs(ss,tz,100):[],isAdmin:adminOk,config:getConfig(),serverTime:new Date().toISOString()});
}

function doPost(e) {
  const ss=SpreadsheetApp.getActiveSpreadsheet(), tz=ss.getSpreadsheetTimeZone();
  try {
    if(!e||!e.postData||!e.postData.contents) return jsonOut({status:"ERRO",message:"Corpo vazio."});
    let body; try{body=JSON.parse(e.postData.contents);}catch(_){return jsonOut({status:"ERRO",message:"JSON inválido."});}
    const updates=Array.isArray(body)?body:(body.updates?body.updates:[body]);
    if(!updates.length) return jsonOut({status:"ERRO",message:"Nenhuma atualização."});

    const passIn=((updates[0].password)||"").toString().trim();
    const adminOk=getAdminPassword().length>0&&passIn===getAdminPassword();

    // ── CMS actions ──
    const action=updates[0].action||"";
    if(action==="setAbas")     return jsonOut(setAbas(ss,JSON.parse(updates[0].dados)));
    if(action==="setProcs")    return jsonOut(setProcs(ss,JSON.parse(updates[0].dados)));
    if(action==="addProc")     return jsonOut(addProc(ss,JSON.parse(updates[0].dado)));
    if(action==="updateProc")  return jsonOut(updateProc(ss,JSON.parse(updates[0].dado)));
    if(action==="deleteProc")  return jsonOut(deleteProc_(ss,updates[0].id));
    if(action==="renameProcAba") return jsonOut(renameProcAba(ss,updates[0].oldName,updates[0].newName));
    if(action==="deleteAbaProcs") return jsonOut(deleteAbaProcs(ss,updates[0].abaNome));
    if(action==="setVideo")    return jsonOut(setVideo(ss,updates[0].url));
    if(action==="setFoto")     return jsonOut(setFoto(ss,updates[0].url));
    if(action==="setFotoConfig") return jsonOut(setFotoConfig(ss,updates[0].posY,updates[0].altura));
    if(action==="setMidiaConfig") return jsonOut(setMidiaConfig(ss,updates[0].tipoMidia));
    if(action==="update_config") { if(!adminOk)return jsonOut({status:"ERRO",message:"Senha incorreta."}); saveConfig(updates[0].config); return jsonOut({status:"OK"}); }
    if(action==="clear_logs") { if(!adminOk)return jsonOut({status:"ERRO",message:"Senha incorreta."}); return jsonOut({status:"OK",cleared:clearSystemLogs(ss)}); }

    // ── agenda updates ──
    const sh=getOrCreateSheet(ss,SHEET_NAME,["Data","Horário","Status","Cliente","Telefone","Código","Início Reserva","Expira em","Log","Duração"]);
    const data=sh.getDataRange().getValues();
    let rowsModified=0, newBookingNotify=null;

    updates.forEach(upd=>{
      const updDate=(upd.data||"").toString().trim(), updTime=toComparableTime(upd.horario);
      if(!updDate||!updTime)return;
      const rowIdx=data.findIndex(r=>fmtDate(r[0],tz)===updDate&&toComparableTime(fmtTime(r[1],tz))===updTime);
      if(rowIdx>-1){
        const curStatus=data[rowIdx][2];
        if(adminOk||curStatus==="Livre"||(curStatus==="Aguardando Pagamento"&&upd.codigo===data[rowIdx][5])){
          sh.getRange(rowIdx+1,3,1,8).setValues([[upd.status,upd.cliente,upd.telefone,upd.codigo,upd.bookingTime,upd.reservedUntil,upd.log||"",upd.duration||60]]);
          rowsModified++;
          if(upd.status==="Ocupado"&&curStatus==="Livre"){newBookingNotify=upd;appendLog(ss,{type:"AGENDAMENTO",dataAgend:upd.data,horario:upd.horario,cliente:upd.cliente||"",telefone:upd.telefone||"",token:upd.codigo||"",msg:`Agendamento: ${upd.cliente||"cliente"}`});}
          else if(upd.status==="Bloqueado")appendLog(ss,{type:"BLOQUEIO",dataAgend:upd.data,horario:upd.horario,msg:"Horário bloqueado."});
          else if(upd.status==="Livre"&&curStatus!=="Livre")appendLog(ss,{type:"LIBERACAO",dataAgend:upd.data,horario:upd.horario,cliente:(data[rowIdx][3]||"").toString(),token:(data[rowIdx][5]||"").toString(),msg:`Liberado. Status anterior: ${curStatus}`});
        }
      } else if(adminOk||upd.status==="Ocupado"){
        sh.appendRow([updDate,updTime,upd.status||"Livre",upd.cliente||"",upd.telefone||"",upd.codigo||"",upd.bookingTime||"",upd.reservedUntil||"",upd.log||"",upd.duration||60]);
        rowsModified++;
        if(upd.status==="Ocupado"){newBookingNotify=upd;appendLog(ss,{type:"AGENDAMENTO",dataAgend:upd.data,horario:upd.horario,cliente:upd.cliente||"",telefone:upd.telefone||"",token:upd.codigo||"",msg:`Novo agendamento: ${upd.cliente||"cliente"}`});}
      }
    });
    if(newBookingNotify&&rowsModified>0)sendPushNotification(newBookingNotify);
    return jsonOut({status:"OK",modified:rowsModified});
  } catch(err) {
    const ss2=SpreadsheetApp.getActiveSpreadsheet();
    appendLog(ss2,{type:"ERRO",msg:"Falha no doPost: "+err.toString()});
    return jsonOut({status:"ERRO",message:err.toString()});
  }
}

// ═══════════════ CMS — ABAS ═══════════════════════════════════
function getAbas(ss) {
  const sh=getOrCreateSheet(ss,"ABAS",["ID","Nome","Emoji"]);
  const data=sh.getDataRange().getValues();
  return data.filter(r=>r[0]&&String(r[0]).trim()).map(r=>({col1:String(r[0]||"").trim(),col2:String(r[1]||"").trim(),col3:String(r[2]||"").trim()}));
}
function setAbas(ss,linhas) {
  const sh=getOrCreateSheet(ss,"ABAS",["ID","Nome","Emoji"]);
  sh.clearContents();
  if(linhas&&linhas.length)sh.getRange(1,1,linhas.length,3).setValues(linhas);
  return{ok:true,rows:linhas?linhas.length:0};
}

// ═══════════════ CMS — PROCEDIMENTOS ══════════════════════════
function normalizeProcRow_(row) {
  const out=Array.isArray(row)?row.slice(0,14):[];
  while(out.length<14)out.push('');
  out[8]=String(out[8]||'50').trim();out[9]=String(out[9]||'145').trim();
  out[10]=String(out[10]||'false').trim();out[13]=String(out[13]||makeId_()).trim();
  return out;
}
function getProcData_(ss) {
  const sh=getOrCreateSheet(ss,"PROCEDIMENTOS",["Aba","Nome","Descrição","Valor","Duração","Efeito","Indicado","Imagens","PosY","Altura","TemManut","ManutPrazo","ManutValor","ID"]);
  const data=sh.getDataRange().getValues();if(!data.length)return{sh,data:[]};
  const normalized=data.map(normalizeProcRow_);
  let changed=false;
  normalized.forEach((row,i)=>{const orig=data[i]||[];if(orig.length<14||String(orig[13]||"").trim()!==row[13])changed=true;});
  if(changed){sh.clearContents();if(normalized.length)sh.getRange(1,1,normalized.length,14).setValues(normalized);}
  return{sh,data:normalized};
}
function getProcs(ss) {
  const{data}=getProcData_(ss);
  return data.filter(r=>r[1]&&String(r[1]).trim()).map((row,i)=>({rowId:String(i+1),col1:String(row[0]||"").trim(),col2:String(row[1]||"").trim(),col3:String(row[2]||"").trim(),col4:String(row[3]||"").trim(),col5:String(row[4]||"").trim(),col6:String(row[5]||"").trim(),col7:String(row[6]||"").trim(),col8:String(row[7]||"").trim(),col9:String(row[8]||"50").trim(),col10:String(row[9]||"145").trim(),col11:String(row[10]||"false").trim(),col12:String(row[11]||"").trim(),col13:String(row[12]||"").trim(),col14:String(row[13]||"").trim()}));
}
function setProcs(ss,linhas) {
  const sh=getOrCreateSheet(ss,"PROCEDIMENTOS",["Aba","Nome","Descrição","Valor","Duração","Efeito","Indicado","Imagens","PosY","Altura","TemManut","ManutPrazo","ManutValor","ID"]);
  sh.clearContents();
  if(linhas&&linhas.length){const n=linhas.map(normalizeProcRow_);sh.getRange(1,1,n.length,14).setValues(n);}
  return{ok:true,rows:linhas?linhas.length:0};
}
function addProc(ss,proc) {
  const sh=getOrCreateSheet(ss,"PROCEDIMENTOS",["Aba","Nome","Descrição","Valor","Duração","Efeito","Indicado","Imagens","PosY","Altura","TemManut","ManutPrazo","ManutValor","ID"]);
  const row=normalizeProcRow_([proc.aba,proc.nome,proc.descricao,proc.valor,proc.duracao,proc.fixacao,proc.indicado,proc.imagem,proc.imgPosY,proc.imgAltura,proc.temManut,proc.manutPrazo,proc.manutValor,proc.id]);
  sh.appendRow(row);return{ok:true,id:row[13]};
}
function updateProc(ss,proc) {
  const{sh,data}=getProcData_(ss);
  const procId=String(proc.id||"").trim()||makeId_();
  const row=normalizeProcRow_([proc.aba,proc.nome,proc.descricao,proc.valor,proc.duracao,proc.fixacao,proc.indicado,proc.imagem,proc.imgPosY,proc.imgAltura,proc.temManut,proc.manutPrazo,proc.manutValor,procId]);
  const idx=data.findIndex(r=>String(r[13]||"").trim()===procId);
  if(idx===-1){sh.appendRow(row);return{ok:true,id:procId,inserted:true};}
  sh.getRange(idx+1,1,1,14).setValues([row]);return{ok:true,id:procId,updated:true};
}
function deleteProc_(ss,procId) {
  const{sh,data}=getProcData_(ss);const wanted=String(procId||"").trim();if(!wanted)return{ok:false};
  const filtered=data.filter(r=>String(r[13]||"").trim()!==wanted);
  if(filtered.length===data.length)return{ok:true,removed:0};
  sh.clearContents();if(filtered.length)sh.getRange(1,1,filtered.length,14).setValues(filtered);
  return{ok:true,removed:data.length-filtered.length};
}
function renameProcAba(ss,oldName,newName) {
  const{sh,data}=getProcData_(ss);const from=String(oldName||"").trim(),to=String(newName||"").trim();if(!from||!to)return{ok:false};
  let updated=0;data.forEach(r=>{if(String(r[0]||"").trim()===from){r[0]=to;updated++;}});
  if(updated){sh.clearContents();sh.getRange(1,1,data.length,14).setValues(data);}
  return{ok:true,updated};
}
function deleteAbaProcs(ss,abaNome) {
  const{sh,data}=getProcData_(ss);const aba=String(abaNome||"").trim();if(!aba)return{ok:false};
  const filtered=data.filter(r=>String(r[0]||"").trim()!==aba);
  if(filtered.length===data.length)return{ok:true,removed:0};
  sh.clearContents();if(filtered.length)sh.getRange(1,1,filtered.length,14).setValues(filtered);
  return{ok:true,removed:data.length-filtered.length};
}

// ═══════════════ CMS — MÍDIA ═══════════════════════════════════
function getVideo(ss) { const sh=getOrCreateSheet(ss,"VIDEO",["URL"]);const d=sh.getDataRange().getValues();return[{col1:d&&d[0]&&d[0][0]?String(d[0][0]).trim():""}]; }
function setVideo(ss,url) { const sh=getOrCreateSheet(ss,"VIDEO",["URL"]);sh.clearContents();if(url)sh.getRange(1,1).setValue(url);return{ok:true,url}; }
function getFoto(ss) { const sh=getOrCreateSheet(ss,"FOTO",["URL"]);const d=sh.getDataRange().getValues();return[{col1:d&&d[0]&&d[0][0]?String(d[0][0]).trim():""}]; }
function setFoto(ss,url) { const sh=getOrCreateSheet(ss,"FOTO",["URL"]);sh.clearContents();if(url)sh.getRange(1,1).setValue(url);return{ok:true,url}; }
function getFotoConfig(ss) { const sh=getOrCreateSheet(ss,"FOTO_CONFIG",["PosY","Altura"]);const d=sh.getDataRange().getValues();if(!d||!d[0])return[{col1:"50",col2:"420"}];return[{col1:String(d[0][0]||"50").trim(),col2:String(d[0][1]||"420").trim()}]; }
function setFotoConfig(ss,posY,altura) { const sh=getOrCreateSheet(ss,"FOTO_CONFIG",["PosY","Altura"]);sh.clearContents();sh.getRange(1,1,1,2).setValues([[posY||50,altura||420]]);return{ok:true,posY,altura}; }
function getMidiaConfig(ss) { const sh=getOrCreateSheet(ss,"MIDIA_CONFIG",["Tipo"]);const d=sh.getDataRange().getValues();if(!d||!d[0]||!d[0][0])return[{col1:"video"}];return[{col1:String(d[0][0]).trim()}]; }
function setMidiaConfig(ss,tipo) { const sh=getOrCreateSheet(ss,"MIDIA_CONFIG",["Tipo"]);sh.clearContents();if(tipo)sh.getRange(1,1).setValue(tipo);return{ok:true,tipo}; }

// ═══════════════ PUSH NOTIFICATION ════════════════════════════
function sendPushNotification(booking) {
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const apiKey=(PropertiesService.getScriptProperties().getProperty("onesignal_api_key")||ONESIGNAL_API_KEY||"").trim();
  if(!ONESIGNAL_APP_ID||!apiKey){appendLog(ss,{type:"PUSH_ADMIN",msg:"Push ignorado: OneSignal não configurado."});return;}
  const payload={app_id:ONESIGNAL_APP_ID,target_channel:"push",filters:[{field:"tag",key:"user_type",relation:"=",value:"admin"}],headings:{pt:"Novo agendamento"},contents:{pt:`${booking.cliente||"?"} · ${booking.data||""} às ${booking.horario||""}`},data:{event:"booking_confirmed",...booking}};
  try{
    const r=UrlFetchApp.fetch("https://api.onesignal.com/notifications",{method:"post",contentType:"application/json",muteHttpExceptions:true,headers:{Authorization:"Key "+apiKey},payload:JSON.stringify(payload)});
    appendLog(ss,{type:"PUSH_ADMIN",cliente:booking.cliente,telefone:booking.telefone,token:booking.codigo,dataAgend:booking.data,horario:booking.horario,msg:`Push enviado. HTTP ${r.getResponseCode()}`});
  }catch(e){appendLog(ss,{type:"ERRO",msg:"Falha push: "+e.message});}
}

// ═══════════════ AUTO-RELEASE ══════════════════════════════════
function autoReleaseExpiredSlots() {
  const ss=SpreadsheetApp.getActiveSpreadsheet(), tz=ss.getSpreadsheetTimeZone();
  const sheet=ss.getSheetByName(SHEET_NAME); if(!sheet)return;
  const data=sheet.getDataRange().getValues(), now=new Date();
  const nowStr=Utilities.formatDate(now,tz,"dd/MM/yyyy HH:mm");
  let released=0;
  for(let i=1;i<data.length;i++){
    const status=(data[i][2]||"").toString().trim(), expiryStr=(data[i][7]||"").toString().trim();
    if(status==="Aguardando Pagamento"&&expiryStr){
      let expiryDate;try{expiryDate=new Date(expiryStr);}catch(_){continue;}
      if(expiryDate<now){
        const cliente=(data[i][3]||"").toString().trim(), telefone=(data[i][4]||"").toString().trim(), token=(data[i][5]||"").toString().trim();
        const dataAgend=fmtDate(data[i][0],tz), horario=fmtTime(data[i][1],tz);
        sheet.getRange(i+1,3).setValue("Livre");sheet.getRange(i+1,4,1,5).clearContent();
        sheet.getRange(i+1,9).setValue(`[AUTO-RELEASE ${nowStr}] ${cliente} | ${telefone} | ${token}`);
        appendLog(ss,{type:"AUTO-RELEASE",dataAgend,horario,cliente,telefone,token,msg:"Reserva expirada. Vaga liberada."});
        released++;
      }
    }
  }
  if(released>0)Logger.log(`[AUTO-RELEASE] ${released} vaga(s) liberada(s) em ${nowStr}`);
}

// ═══════════════ SETUP / TEST ══════════════════════════════════
function criarTriggerAutoRelease() {
  ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='autoReleaseExpiredSlots').forEach(t=>ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('autoReleaseExpiredSlots').timeBased().everyMinutes(5).create();
  Logger.log('✓ Trigger autoReleaseExpiredSlots criado (a cada 5 min).');
}
function testSetup() {
  const ss=SpreadsheetApp.getActiveSpreadsheet(), tz=ss.getSpreadsheetTimeZone();
  Logger.log("=== LOOK DESIGNER v4 — Verificação ===");
  Logger.log("Spreadsheet: "+ss.getName());
  Logger.log("Fuso: "+tz);
  Logger.log("Hora atual: "+Utilities.formatDate(new Date(),tz,"dd/MM/yyyy HH:mm"));
  Logger.log("Admin password: "+(getAdminPassword()?"✅ Configurada":"⚠️ AUSENTE — configure em Script Properties"));
  Logger.log("Aba AGENDA: "+(ss.getSheetByName(SHEET_NAME)?"✅":"⚠️ Será criada no primeiro POST"));
  Logger.log("Config: "+JSON.stringify(getConfig()));
  Logger.log("=================================");
}
