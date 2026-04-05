
// ============================================================
// CONFIGURAÇÕES (AJUSTE AQUI)
// ============================================================
const ADMIN_PASSWORD = "borboletas"; // Troque por uma senha segura
const SHEET_NAME     = "TRONCO";     // Nome da aba no seu Google Sheets
const PREFS_SHEET    = "CONFIG_AGENDA"; // Nome da aba de configurações
const TIME_ZONE      = "GMT-4";      // Seu fuso horário (ex: GMT-3 para Brasília)

// ============================================================
// HELPERS
// ============================================================

function isDateObject(v) {
  return v !== null && typeof v === 'object' && typeof v.getFullYear === 'function';
}

function formatDateValue(val, tz) {
  try {
    if (isDateObject(val)) {
      return Utilities.formatDate(val, tz, "yyyy-MM-dd");
    }
  } catch(e) {}
  return (val || "").toString().trim();
}

function formatTimeValue(val, tz) {
  try {
    if (isDateObject(val)) {
      return Utilities.formatDate(val, tz, "HH:mm");
    }
  } catch(e) {}
  return (val || "").toString().trim();
}

function maskString(str) {
  if (!str) return "";
  if (str === "RESERVADO" || str === "INDISPONÍVEL") return str;
  const parts = str.split(' ');
  const maskedParts = parts.map(p => {
    if (p.length <= 1) return p;
    if (p.length === 2) return p[0] + "*";
    return p[0] + "*".repeat(p.length - 2) + p[p.length - 1];
  });
  return maskedParts.join(' ');
}

function maskPhone(str) {
  if (!str) return "";
  const clean = str.replace(/\D/g, '');
  if (clean.length < 4) return str;
  const init = clean.substring(0, clean.length - 4);
  const end = clean.substring(clean.length - 2);
  return `(${clean.substring(0, 2)}) ${clean.substring(2, 3)}****-**${end}`;
}

// ============================================================
// GET — retorna agenda em JSON
// ============================================================
function doGet(e) {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const sheet    = ss.getSheetByName(SHEET_NAME);
  const tz       = ss.getSpreadsheetTimeZone();
  const callback = (e && e.parameter && e.parameter.callback) ? e.parameter.callback : null;

  if (!sheet) {
    const err = JSON.stringify({ status: "ERRO", message: "Aba '" + SHEET_NAME + "' não encontrada." });
    return callback
      ? ContentService.createTextOutput(callback + "(" + err + ")").setMimeType(ContentService.MimeType.JAVASCRIPT)
      : ContentService.createTextOutput(err).setMimeType(ContentService.MimeType.JSON);
  }

  const passProvided = ((e && e.parameter && e.parameter.pass) ? e.parameter.pass : "").toString().trim();
  const isAdmin      = (passProvided.length > 0 && passProvided === ADMIN_PASSWORD.trim());

  // Garante que o cabeçalho existe ou expande a área se necessário
  const data   = sheet.getDataRange().getValues();
  const agenda = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];

    if (!row[0] && !row[1]) continue;

    var rowDate = formatDateValue(row[0], tz);
    var rowTime = formatTimeValue(row[1], tz);

    if (!rowDate || !rowTime) continue;

    var status   = ((row[2] || "Livre") + "").trim();
    var client   = ((row[3] || "")      + "").trim();
    var telefone = ((row[4] || "")      + "").trim(); // Coluna E
    var codigo   = ((row[5] || "")      + "").trim(); // Coluna F
    var bTime    = ((row[6] || "")      + "").trim(); // Coluna G
    var rUntil   = ((row[7] || "")      + "").trim(); // Coluna H
    var log      = ((row[8] || "")      + "").trim(); // Coluna I
    var duration = ((row[9] || "")      + "").trim(); // Coluna J

    var clienteExibicao = "";
    var telefoneExibicao = "";
    var codigoExibicao = "";
    var bookingTimeExibicao = "";
    var reservedUntilExibicao = "";
    
    if (isAdmin) {
      clienteExibicao = client;
      telefoneExibicao = telefone;
      codigoExibicao = codigo;
      bookingTimeExibicao = bTime;
      reservedUntilExibicao = rUntil;
    } else if (status === "Ocupado" || status === "Bloqueado" || status === "Aguardando Pagamento") {
      clienteExibicao = maskString(client);
      telefoneExibicao = maskPhone(telefone);
      codigoExibicao = codigo; // Agora liberado para todos verem o token v6
    }

  agenda.push({
      data:    rowDate,
      horario: rowTime,
      status:  status,
      cliente: clienteExibicao,
      telefone: telefoneExibicao,
      codigo: codigoExibicao,
      bookingTime: bookingTimeExibicao,
      reservedUntil: reservedUntilExibicao,
      duration: duration
    });
  }

  const config = getScheduleConfig(ss);
  var result = JSON.stringify({ 
    status: "OK", 
    agenda: agenda, 
    isAdmin: isAdmin, 
    serverTime: new Date().toISOString(),
    config: config 
  });

  return callback
    ? ContentService.createTextOutput(callback + "(" + result + ")").setMimeType(ContentService.MimeType.JAVASCRIPT)
    : ContentService.createTextOutput(result).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// POST — salva/atualiza registros na aba TRONCO
// ============================================================
function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse("ERRO", "Requisição sem corpo.");
    }

    var rawBody = e.postData.contents;
    var updates;
    try {
      var parsed = JSON.parse(rawBody);
      updates = Array.isArray(parsed) ? parsed : [parsed];
    } catch (jsonErr) {
      try {
        var match = rawBody.match(/^payload=(.+)$/);
        if (match) {
          var parsed2 = JSON.parse(decodeURIComponent(match[1]));
          updates = Array.isArray(parsed2) ? parsed2 : [parsed2];
        } else {
          return jsonResponse("ERRO", "Formato de corpo inválido.");
        }
      } catch (legacyErr) {
        return jsonResponse("ERRO", "Falha ao parsear: " + legacyErr.message);
      }
    }

    if (!updates || updates.length === 0) {
      return jsonResponse("ERRO", "Nenhuma atualização recebida.");
    }

    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return jsonResponse("ERRO", "Aba '" + SHEET_NAME + "' não encontrada.");

    var providedPass = ((updates[0].password) || "").toString().trim();
    var callerIsAdmin = (providedPass === ADMIN_PASSWORD.trim());

    // ACTION: UPDATE_CONFIG
    if (updates[0].action === "update_config") {
      if (!callerIsAdmin) return jsonResponse("ERRO", "Senha administrativa incorreta.");
      updateScheduleConfig(ss, updates[0].config);
      return jsonResponse("OK", "Configurações atualizadas com sucesso.");
    }

    var tz           = ss.getSpreadsheetTimeZone();
    var data         = sheet.getDataRange().getValues();
    var savedCount = 0;

    for (var u = 0; u < updates.length; u++) {
      var update     = updates[u];
      var targetDate = (update.data    || "").toString().trim();
      var targetTime = (update.horario || "").toString().trim();
      var newStatus  = (update.status  || "").toString().trim();
      var newClient  = (update.cliente || "").toString().trim();
      var newPhone   = (update.telefone || "").toString().trim();
      var newCodigo  = (update.codigo   || "").toString().trim();
      var bTime      = (update.bookingTime || "").toString().trim();
      var rUntil     = (update.reservedUntil || "").toString().trim();
      var dMinutes   = (update.duration || "").toString().trim();

      if (!targetDate || !targetTime || !newStatus) continue;

      var isRestricted = (newStatus === "Bloqueado" || newStatus === "Livre");
      if (isRestricted && !callerIsAdmin) continue;

      var foundRow = -1;
      for (var i = 1; i < data.length; i++) {
        var sDate = formatDateValue(data[i][0], tz);
        var sTime = formatTimeValue(data[i][1], tz);

        var sDateNorm = sDate.substring(0, 10);
        var sTimeNorm = sTime.substring(0, 5);
        var tDateNorm = targetDate.substring(0, 10);
        var tTimeNorm = targetTime.substring(0, 5);

        if (sDateNorm === tDateNorm && sTimeNorm === tTimeNorm) {
          foundRow = i;
          break;
        }
      }

      if (foundRow > -1) {
        sheet.getRange(foundRow + 1, 3).setValue(newStatus);
        sheet.getRange(foundRow + 1, 4).setValue(newClient);
        sheet.getRange(foundRow + 1, 5).setValue(newPhone);
        if (newCodigo) sheet.getRange(foundRow + 1, 6).setValue(newCodigo);
        if (bTime)     sheet.getRange(foundRow + 1, 7).setValue(bTime);
        if (rUntil)    sheet.getRange(foundRow + 1, 8).setValue(rUntil);
        if (dMinutes)  sheet.getRange(foundRow + 1, 10).setValue(dMinutes);
        
        // Limpa campos de tempo se liberado ou ocupado definitivamente
        if (newStatus === "Livre" || newStatus === "Ocupado" || newStatus === "Bloqueado") {
            if (newStatus === "Livre" && !callerIsAdmin) {
               // Se "Livre" não foi por admin (improvável via app, mas para segurança), apenas limpa
               sheet.getRange(foundRow + 1, 6, 1, 3).clearContent();
            } else if (newStatus === "Livre" && callerIsAdmin) {
                sheet.getRange(foundRow + 1, 6, 1, 3).clearContent();
            } else if (newStatus === "Ocupado") {
                sheet.getRange(foundRow + 1, 8).clearContent(); // Limpa expiração (H)
            }
        }

      } else {
        sheet.appendRow([targetDate, targetTime, newStatus, newClient, newPhone, newCodigo, bTime, rUntil, "", dMinutes]);
      }

      savedCount++;
    }

    return jsonResponse("OK", savedCount + " registro(s) salvo(s).");

  } catch (err) {
    return jsonResponse("ERRO", "Erro interno: " + err.message);
  }
}

// ============================================================
// HELPERS CONFIG
// ============================================================
function getScheduleConfig(ss) {
  let sheet = ss.getSheetByName(PREFS_SHEET);
  const defaults = { start: "08:00", end: "20:00", duration: 30 };
  
  if (!sheet) return defaults;
  
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return defaults;
  
  return {
    start: (data[1][0] || defaults.start).toString(),
    end: (data[1][1] || defaults.end).toString(),
    duration: parseInt(data[1][2] || defaults.duration)
  };
}

function updateScheduleConfig(ss, config) {
  let sheet = ss.getSheetByName(PREFS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PREFS_SHEET);
    sheet.appendRow(["Hora Início", "Hora Fim", "Duração (min)"]);
  }
  
  sheet.getRange(2, 1, 1, 3).setValues([[
    config.start, 
    config.end, 
    config.duration
  ]]);
}

// ============================================================
// AUTO-RELEASE (Deve ser ativado por Trigger de Tempo)
// ============================================================
function autoReleaseExpiredSlots() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  const now = new Date();

  for (let i = 1; i < data.length; i++) {
    const status = (data[i][2] || "").toString();
    const client = (data[i][3] || "").toString();
    const phone  = (data[i][4] || "").toString(); // Coluna E
    const token  = (data[i][5] || "").toString(); // Col F
    const expiryStr = (data[i][7] || "").toString(); // Coluna H
    
    if (status === "Aguardando Pagamento" && expiryStr) {
      const expiryDate = new Date(expiryStr);
      if (expiryDate < now) {
        // Libera a vaga e gera o Log de Auditoria na Coluna I
        const logMsg = "[SISTEMA " + Utilities.formatDate(now, TIME_ZONE, "HH:mm") + "] Vaga liberada por falta de confirmação. Cliente: " + client + " (" + phone + ") / Token: " + token;
        
        sheet.getRange(i + 1, 3).setValue("Livre");
        sheet.getRange(i + 1, 4, 1, 5).clearContent(); // Limpa D, E, F, G, H
        sheet.getRange(i + 1, 9).setValue(logMsg); // Coluna I
        
        Logger.log(logMsg);
      }
    }
  }
}

function jsonResponse(status, msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: status, message: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}
