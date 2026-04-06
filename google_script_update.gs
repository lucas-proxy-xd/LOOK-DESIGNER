/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         LOOK DESIGNER — Backend Google Apps Script           ║
 * ║              Studio de Cílios · Versão 3.0                   ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  INSTALAÇÃO:                                                  ║
 * ║  1. Abra seu Google Sheets                                    ║
 * ║  2. Extensões > Apps Script                                   ║
 * ║  3. Cole este código e salve                                  ║
 * ║  4. Implantar > Nova implantação > App da Web               ║
 * ║     - Executar como: Você (seu e-mail)                       ║
 * ║     - Quem acessa: Qualquer pessoa                           ║
 * ║  5. Copie a URL gerada e cole no index.html (CFG.API_URL)    ║
 * ║                                                              ║
 * ║  GATILHO AUTOMÁTICO (Auto-Release):                          ║
 * ║  - Ícone de Relógio (Gatilhos) > Adicionar Gatilho          ║
 * ║  - Função: autoReleaseExpiredSlots                           ║
 * ║  - Origem: Baseado no tempo > Minutos > A cada 5 minutos    ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

// ════════════════════════════════════════════════════════════════
//  ⚙️  CONFIGURAÇÕES — EDITE APENAS AQUI
// ════════════════════════════════════════════════════════════════
const ADMIN_PASSWORD = "ALVES20";   // ← Troque por uma senha forte
const SHEET_NAME     = "AGENDA";           // Nome da aba principal
const CONFIG_SHEET   = "CONFIG";           // Nome da aba de configurações
const LOG_SHEET      = "LOG_SISTEMA";      // Nome da aba de log do sistema
const TIME_ZONE      = "America/Manaus";   // Fuso horário (GMT-4)

// ════════════════════════════════════════════════════════════════
//  🔧  UTILITÁRIOS
// ════════════════════════════════════════════════════════════════

function getOrCreateSheet(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (headers && headers.length) sh.appendRow(headers);
  }
  return sh;
}

function fmt(val, tz, pattern) {
  try {
    if (val && typeof val.getFullYear === 'function') {
      return Utilities.formatDate(val, tz, pattern);
    }
  } catch(e) {}
  return (val || "").toString().trim();
}

function fmtDate(val, tz) { return fmt(val, tz, "yyyy-MM-dd"); }
function fmtTime(val, tz) {
  const s = fmt(val, tz, "HH:mm");
  const m = s.match(/(\d{1,2}:\d{2})/);
  return m ? m[1].padStart(5,'0') : s;
}

function maskName(str) {
  if (!str || str === "INDISPONÍVEL" || str === "RESERVADO") return str;
  return str.split(' ').map(p => {
    if (p.length <= 1) return p;
    if (p.length === 2) return p[0] + "*";
    return p[0] + "*".repeat(p.length - 2) + p[p.length - 1];
  }).join(' ');
}

function maskPhone(str) {
  if (!str) return "";
  const c = str.replace(/\D/g, '');
  if (c.length < 4) return str;
  return `(${c.substring(0,2)}) ${c.substring(2,3)}****-**${c.slice(-2)}`;
}

function jsonOut(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsOut(callback, data) {
  return ContentService
    .createTextOutput(`${callback}(${JSON.stringify(data)})`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function respond(callback, data) {
  return callback ? jsOut(callback, data) : jsonOut(data);
}

// ════════════════════════════════════════════════════════════════
//  📖  CONFIG HELPERS
// ════════════════════════════════════════════════════════════════

function getConfig(ss) {
  const defaults = { start: "08:00", end: "20:00", duration: 60 };
  try {
    const sh = ss.getSheetByName(CONFIG_SHEET);
    if (!sh) return defaults;
    const d = sh.getDataRange().getValues();
    if (d.length < 2) return defaults;
    const tz = ss.getSpreadsheetTimeZone();
    return {
      start:    fmtTime(d[1][0], tz) || defaults.start,
      end:      fmtTime(d[1][1], tz) || defaults.end,
      duration: parseInt(d[1][2]) || defaults.duration
    };
  } catch(e) { return defaults; }
}

function saveConfig(ss, cfg) {
  const sh = getOrCreateSheet(ss, CONFIG_SHEET, ["Início","Fim","Duração (min)"]);
  sh.getRange(2,1,1,3).setValues([[cfg.start, cfg.end, Number(cfg.duration)]]);
}

// ════════════════════════════════════════════════════════════════
//  📋  LOG HELPERS
// ════════════════════════════════════════════════════════════════

function appendLog(ss, entry) {
  const sh = getOrCreateSheet(ss, LOG_SHEET, [
    "Data/Hora","Tipo","Data Agend.","Horário","Cliente","Telefone","Token","Mensagem"
  ]);
  sh.appendRow([
    new Date(),
    entry.type || "SISTEMA",
    entry.dataAgend || "",
    entry.horario || "",
    entry.cliente || "",
    entry.telefone || "",
    entry.token || "",
    entry.msg || ""
  ]);
}

// ════════════════════════════════════════════════════════════════
//  🌐  GET — Retorna agenda
// ════════════════════════════════════════════════════════════════

function doGet(e) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const tz  = ss.getSpreadsheetTimeZone();
  const cb  = e && e.parameter && e.parameter.callback ? e.parameter.callback : null;
  const sh  = ss.getSheetByName(SHEET_NAME);

  if (!sh) return respond(cb, { status:"ERRO", message:`Aba "${SHEET_NAME}" não encontrada.` });

  const passIn   = ((e && e.parameter && e.parameter.pass) || "").toString().trim();
  const adminOk  = passIn.length > 0 && passIn === ADMIN_PASSWORD.trim();
  const data     = sh.getDataRange().getValues();
  const agenda   = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0] && !row[1]) continue;

    const rowDate = fmtDate(row[0], tz);
    const rowTime = fmtTime(row[1], tz);
    if (!rowDate || !rowTime) continue;

    const status       = (row[2]  || "Livre").toString().trim();
    const cliente      = (row[3]  || "").toString().trim();
    const telefone     = (row[4]  || "").toString().trim();
    const codigo       = (row[5]  || "").toString().trim();
    const bookingTime  = (row[6]  || "").toString().trim();
    const reservedUntil= (row[7]  || "").toString().trim();
    const log          = (row[8]  || "").toString().trim();
    const duration     = (row[9]  || "").toString().trim();

    agenda.push({
      data:          rowDate,
      horario:       rowTime,
      status:        status,
      cliente:       adminOk ? cliente    : maskName(cliente),
      telefone:      adminOk ? telefone   : maskPhone(telefone),
      codigo:        codigo,
      bookingTime:   adminOk ? bookingTime   : "",
      reservedUntil: reservedUntil,
      log:           adminOk ? log        : "",
      duration:      duration
    });
  }

  return respond(cb, {
    status:     "OK",
    agenda:     agenda,
    isAdmin:    adminOk,
    config:     getConfig(ss),
    serverTime: new Date().toISOString()
  });
}

// ════════════════════════════════════════════════════════════════
//  📝  POST — Salva / atualiza registros
// ════════════════════════════════════════════════════════════════

function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut({ status:"ERRO", message:"Corpo vazio." });
    }

    let body;
    try { body = JSON.parse(e.postData.contents); }
    catch(_) { return jsonOut({ status:"ERRO", message:"JSON inválido." }); }

    // Handle single object (update_config or {updates:[]})
    const updates = Array.isArray(body)
      ? body
      : (body.updates ? body.updates : [body]);

    if (!updates.length) return jsonOut({ status:"ERRO", message:"Nenhuma atualização." });

    const passIn    = ((updates[0].password) || "").toString().trim();
    const adminOk   = passIn === ADMIN_PASSWORD.trim();

    // ── update_config ──────────────────────────────────
    if (updates[0].action === "update_config") {
      if (!adminOk) return jsonOut({ status:"ERRO", message:"Senha incorreta." });
      const c = updates[0].config;
      const timeRx = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!timeRx.test(c.start) || !timeRx.test(c.end)) {
        return jsonOut({ status:"ERRO", message:"Horário inválido (use HH:mm)." });
      }
      const allowed = [15,30,45,60,75,90,120,180];
      if (!allowed.includes(Number(c.duration))) c.duration = 60;
      saveConfig(ss, c);
      appendLog(ss, { type:"CONFIG", msg:`Config atualizada: ${JSON.stringify(c)}` });
      return jsonOut({ status:"OK", message:"Configurações salvas." });
    }

    // ── agenda updates ──────────────────────────────────
    const sh = ss.getSheetByName(SHEET_NAME);
    if (!sh) {
      // Create with headers if missing
      const newSh = ss.insertSheet(SHEET_NAME);
      newSh.appendRow(["Data","Horário","Status","Cliente","Telefone","Código","Início Reserva","Expira em","Log","Duração"]);
    }

    const sheet = ss.getSheetByName(SHEET_NAME);
    const data  = sheet.getDataRange().getValues();
    let saved   = 0;

    for (const upd of updates) {
      const targetDate = (upd.data    || "").toString().trim().substring(0,10);
      const targetTime = (upd.horario || "").toString().trim().substring(0,5);
      const newStatus  = (upd.status  || "").toString().trim();

      if (!targetDate || !targetTime || !newStatus) continue;

      // Security: block restricted ops for non-admins
      const restrictedStatuses = ["Bloqueado"];
      if (restrictedStatuses.includes(newStatus) && !adminOk) continue;
      if (newStatus === "Livre" && !adminOk) continue;

      // Sanitize inputs
      const newClient  = (upd.cliente   || "").toString().trim().substring(0, 120);
      const newPhone   = (upd.telefone  || "").toString().trim().replace(/[^0-9+\-() ]/g,'').substring(0, 20);
      const newCodigo  = (upd.codigo    || "").toString().trim().substring(0, 10);
      const bTime      = (upd.bookingTime   || "").toString().trim();
      const rUntil     = (upd.reservedUntil || "").toString().trim();
      const durMin     = Math.min(Math.max(Number(upd.duration)||60, 15), 480);

      // Find existing row
      let foundRow = -1;
      for (let i = 1; i < data.length; i++) {
        const rDate = fmtDate(data[i][0], tz).substring(0,10);
        const rTime = fmtTime(data[i][1], tz).substring(0,5);
        if (rDate === targetDate && rTime === targetTime) { foundRow = i; break; }
      }

      if (foundRow > -1) {
        sheet.getRange(foundRow+1, 3).setValue(newStatus);
        sheet.getRange(foundRow+1, 4).setValue(newClient);
        sheet.getRange(foundRow+1, 5).setValue(newPhone);
        if (newCodigo) sheet.getRange(foundRow+1, 6).setValue(newCodigo);
        if (bTime)     sheet.getRange(foundRow+1, 7).setValue(bTime);
        if (rUntil)    sheet.getRange(foundRow+1, 8).setValue(rUntil);
        if (durMin)    sheet.getRange(foundRow+1, 10).setValue(durMin);

        // Clear sensitive fields when freeing
        if (newStatus === "Livre") {
          sheet.getRange(foundRow+1, 4, 1, 5).clearContent(); // D–H
        }
        if (newStatus === "Ocupado") {
          sheet.getRange(foundRow+1, 8).clearContent(); // Clear expiry
        }
      } else {
        sheet.appendRow([targetDate, targetTime, newStatus, newClient, newPhone, newCodigo, bTime, rUntil, "", durMin]);
      }

      // Log the action
      appendLog(ss, {
        type: `AGEND:${newStatus}`,
        dataAgend: targetDate,
        horario: targetTime,
        cliente: newClient,
        telefone: newPhone,
        token: newCodigo,
        msg: `Status definido como "${newStatus}" por ${adminOk?'ADMIN':'cliente'}.`
      });

      saved++;
    }

    return jsonOut({ status:"OK", message:`${saved} registro(s) salvos.` });

  } catch(err) {
    Logger.log("doPost ERROR: " + err.message + " | Stack: " + err.stack);
    return jsonOut({ status:"ERRO", message:"Erro interno: " + err.message });
  }
}

// ════════════════════════════════════════════════════════════════
//  ⏰  AUTO-RELEASE — Ativar via Gatilho de Tempo (5 min)
// ════════════════════════════════════════════════════════════════

function autoReleaseExpiredSlots() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const tz    = ss.getSpreadsheetTimeZone();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  const now  = new Date();
  const nowStr = Utilities.formatDate(now, tz, "dd/MM/yyyy HH:mm");
  let released = 0;

  for (let i = 1; i < data.length; i++) {
    const status     = (data[i][2] || "").toString().trim();
    const cliente    = (data[i][3] || "").toString().trim();
    const telefone   = (data[i][4] || "").toString().trim();
    const token      = (data[i][5] || "").toString().trim();
    const expiryStr  = (data[i][7] || "").toString().trim();
    const dataAgend  = fmtDate(data[i][0], tz);
    const horario    = fmtTime(data[i][1], tz);

    if (status === "Aguardando Pagamento" && expiryStr) {
      let expiryDate;
      try { expiryDate = new Date(expiryStr); }
      catch(_) { continue; }

      if (expiryDate < now) {
        // Build detailed log message
        const logMsg = `[AUTO-RELEASE ${nowStr}] Reserva expirada sem confirmação. Cliente: "${cliente}" | Tel: ${telefone} | Token: ${token} | Slot: ${dataAgend} ${horario}`;

        // Free the slot
        sheet.getRange(i+1, 3).setValue("Livre");
        sheet.getRange(i+1, 4, 1, 5).clearContent(); // Limpa D-H

        // Write log to column I (visible to admin in agenda view)
        sheet.getRange(i+1, 9).setValue(logMsg);

        // Also append to system log sheet
        appendLog(ss, {
          type:      "AUTO-RELEASE",
          dataAgend: dataAgend,
          horario:   horario,
          cliente:   cliente,
          telefone:  telefone,
          token:     token,
          msg:       "Reserva expirada sem confirmação. Vaga liberada automaticamente."
        });

        Logger.log(logMsg);
        released++;
      }
    }
  }

  if (released > 0) {
    Logger.log(`[AUTO-RELEASE] ${released} vaga(s) liberada(s) em ${nowStr}`);
  }
}

// ════════════════════════════════════════════════════════════════
//  🔍  TESTE — Execute manualmente para verificar tudo
// ════════════════════════════════════════════════════════════════

function testSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();

  Logger.log("=== LOOK DESIGNER — Verificação de Setup ===");
  Logger.log("Spreadsheet: " + ss.getName());
  Logger.log("Fuso horário: " + tz);
  Logger.log("Hora atual: " + Utilities.formatDate(new Date(), tz, "dd/MM/yyyy HH:mm"));

  const agendaSh = ss.getSheetByName(SHEET_NAME);
  Logger.log("Aba AGENDA: " + (agendaSh ? "✅ Encontrada" : "❌ Não encontrada (será criada no 1º POST)"));

  const cfgSh = ss.getSheetByName(CONFIG_SHEET);
  Logger.log("Aba CONFIG: " + (cfgSh ? "✅ Encontrada" : "⚠️ Não existe ainda"));

  const logSh = ss.getSheetByName(LOG_SHEET);
  Logger.log("Aba LOG: " + (logSh ? "✅ Encontrada" : "⚠️ Não existe ainda (criada automaticamente)"));

  const cfg = getConfig(ss);
  Logger.log("Config atual: " + JSON.stringify(cfg));

  Logger.log("Admin password configurada: " + (ADMIN_PASSWORD !== "SUA_SENHA_AQUI" ? "✅" : "⚠️  AINDA É O PADRÃO! Troque antes de implantar."));
  Logger.log("===========================================");
}
