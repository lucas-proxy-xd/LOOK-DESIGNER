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
  // Exemplo: (92) 9****-**40
  return `(${c.substring(0,2)}) ${c.substring(2,3)}****-**${c.slice(-2)}`;
}

function maskToken(str) {
  if (!str) return "";
  const len = str.length;
  const hide = Math.floor(len * 0.5);
  return "*".repeat(hide) + str.substring(hide);
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

// ════════════════════════════════════════════════════════════════
//  ⚙️  GESTÃO DE CONFIGURAÇÕES (RESILIÊNCIA TOTAL)
// ════════════════════════════════════════════════════════════════

function getConfig(ss) {
  const defaults = { start: "08:00", end: "20:00", duration: 60, pix_value: "0.00" };
  try {
    const props = PropertiesService.getScriptProperties();
    const saved = props.getProperties();
    
    // Se nunca foi salvo nada, retorna os padrões
    if (!saved.start) return defaults;

    return {
      start:     saved.start    || defaults.start,
      end:       saved.end      || defaults.end,
      duration:  parseInt(saved.duration) || defaults.duration,
      pix_value: saved.pix_value || defaults.pix_value
    };
  } catch(e) {
    appendLog(ss || SpreadsheetApp.getActiveSpreadsheet(), { type:"ERRO", msg: "Erro ao ler config: " + e.message });
    return defaults;
  }
}

function saveConfig(ss, cfg) {
  const props = PropertiesService.getScriptProperties();
  
  // Limpar valor do PIX e garantir que os dados sejam strings seguras
  let p = (cfg.pix_value || "0.00").toString().replace(",", ".").trim();
  if (p === "" || isNaN(parseFloat(p))) p = "0.00";

  const newProps = {
    start:     cfg.start || "08:00",
    end:       cfg.end   || "20:00",
    duration:  cfg.duration.toString(),
    pix_value: p
  };

  props.setProperties(newProps);

  // Opcional: Atualiza a planilha CONFIG apenas para registro visual
  try {
    const sh = getOrCreateSheet(ss, CONFIG_SHEET, ["Início","Fim","Duração (min)","Valor PIX"]);
    sh.getRange(2,1,1,4).setValues([[newProps.start, newProps.end, Number(newProps.duration), newProps.pix_value]]);
  } catch(e) {}
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
  const cb  = (e && e.parameter && e.parameter.callback) || null;
  const sh  = ss.getSheetByName(SHEET_NAME);

  if (!sh) return respond(cb, { status:"ERRO", message:`Aba "${SHEET_NAME}" não encontrada.` });

  const passIn   = ((e && e.parameter && e.parameter.pass) || "").toString().trim();
  const adminOk  = passIn.length > 0 && passIn === ADMIN_PASSWORD.trim();

  // ── ATUALIZAÇÃO DE CONFIG VIA GET (Resiliência Total) ──
  if (e && e.parameter && e.parameter.action === "update_config") {
    if (!adminOk) return respond(cb, { status:"ERRO", message:"Senha admin incorreta para configurar." });
    
    // Pega o valor, limpa e garante que seja número válido
    let vPix = (e.parameter.pix_value || "0.00").toString().replace(",", ".").trim();
    if (!vPix || isNaN(parseFloat(vPix))) vPix = "0.00";

    saveConfig(ss, {
      start:    e.parameter.start,
      end:      e.parameter.end,
      duration: e.parameter.duration,
      pix_value: vPix
    });
    
    appendLog(ss, { type:"CONFIG", msg:`Config salva com sucesso: R$ ${vPix}` });
    // Continua para retornar agenda e config já atualizada
  }

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
      codigo:        adminOk ? codigo     : maskToken(codigo),
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

    const updates = Array.isArray(body) ? body : (body.updates ? body.updates : [body]);
    if (!updates.length) return jsonOut({ status:"ERRO", message:"Nenhuma atualização." });

    const passIn    = ((updates[0].password) || "").toString().trim();
    const adminOk   = passIn === ADMIN_PASSWORD.trim();

    // ── update_config ──────────────────────────────────
    if (updates[0].action === "update_config") {
      if (!adminOk) return jsonOut({ status:"ERRO", message:"Senha incorreta." });
      const c = updates[0].config;
      saveConfig(ss, c);
      appendLog(ss, { type:"CONFIG", msg:`Config atualizada: ${JSON.stringify(c)}` });
      return jsonOut({ status:"OK", message:"Configurações salvas." });
    }

    // ── agenda updates ──────────────────────────────────
    const sh = getOrCreateSheet(ss, SHEET_NAME, ["Data","Horário","Status","Cliente","Telefone","Código","Início Reserva","Expira em","Log","Duração"]);
    const data  = sh.getDataRange().getValues();
    let rowsModified = 0;
    let newBookingNotify = null;

    updates.forEach(upd => {
      const rowIdx = data.findIndex(r => fmtDate(r[0], tz) === upd.data && fmtTime(r[1], tz) === upd.horario);
      if (rowIdx > -1) {
        const curStatus = data[rowIdx][2];
        // Permite salvar se for admin ou se estiver livre
        if (adminOk || curStatus === "Livre" || (curStatus === "Aguardando Pagamento" && upd.codigo === data[rowIdx][5])) {
          sh.getRange(rowIdx + 1, 3, 1, 8).setValues([[
            upd.status, upd.cliente, upd.telefone, upd.codigo,
            upd.bookingTime, upd.reservedUntil, upd.log || "", upd.duration || 60
          ]]);
          rowsModified++;
          
          // Se for uma NOVA reserva pendente, prepara notificação do sistema
          if (upd.status === "Aguardando Pagamento" && curStatus === "Livre") {
            newBookingNotify = upd;
          }
        }
      }
    });

    // Dispara a Notificação Silenciosa para a Gerente (Se houver nova reserva)
    if (newBookingNotify) {
      sendInternalNotification(newBookingNotify);
    }

    return jsonOut({ status:"OK", modified: rowsModified });

  } catch (err) {
    return jsonOut({ status:"ERRO", message: err.toString() });
  }
}

/**
 * 📧 NOTIFICAÇÃO DO SISTEMA (Gerente)
 * Envia um e-mail automático assim que alguém faz uma reserva.
 */
function sendInternalNotification(booking) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ownerEmail = Session.getEffectiveUser().getEmail(); // Envia para o dono do script
  
  const subject = `🔔 NOVA RESERVA: ${booking.cliente} - ${booking.data} ${booking.horario}`;
  const body = 
    `Olá, Gerente!\n\n` +
    `Acaba de entrar uma NOVA reserva pelo site:\n\n` +
    `📌 DETALHES:\n` +
    `• Cliente: ${booking.cliente}\n` +
    `• Telefone: ${booking.telefone}\n` +
    `• Data: ${booking.data}\n` +
    `• Horário: ${booking.horario}\n` +
    `• Token de Reserva: ${booking.codigo}\n\n` +
    `O cliente está na tela de pagamento. Fique atento ao WhatsApp para receber o comprovante do PIX.\n\n` +
    `LINK DA PLANILHA:\n${ss.getUrl()}`;

  try {
    MailApp.sendEmail(ownerEmail, subject, body);
    appendLog(ss, { type:"NOTIFICAÇÃO", msg: `Aviso enviado para ${ownerEmail}` });
  } catch(e) {
    appendLog(ss, { type:"ERRO", msg: `Falha ao enviar notificação: ${e.message}` });
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
