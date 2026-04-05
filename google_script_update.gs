/**
 * LOOK DESIGNER — Google Apps Script
 * Planilha: TRONCO (única aba)
 *
 * Estrutura da aba TRONCO:
 *   Coluna A: Data       (ex: 2026-04-05 ou Date)
 *   Coluna B: Horário    (ex: 09:00 ou Time)
 *   Coluna C: Status     (Livre | Ocupado | Bloqueado)
 *   Coluna D: Cliente    (nome do cliente ou RESERVADO)
 *   Coluna E: Telefone   (telefone do cliente)
 *   Coluna F: Código     (código único de rastreio, ex: a3f2:8b1d:4c09:e7a1)
 */

const ADMIN_PASSWORD = "borboletas";
const SHEET_NAME     = "TRONCO";

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

    var clienteExibicao = "";
    var telefoneExibicao = "";
    var codigoExibicao = "";
    
    if (isAdmin) {
      clienteExibicao = client;
      telefoneExibicao = telefone;
      codigoExibicao = codigo;
    } else if (status === "Ocupado" || status === "Bloqueado" || status === "Aguardando Pagamento") {
      clienteExibicao = "INDISPONÍVEL";
      telefoneExibicao = ""; // Esconde telefone para não-admin
    }

    agenda.push({
      data:    rowDate,
      horario: rowTime,
      status:  status,
      cliente: clienteExibicao,
      telefone: telefoneExibicao,
      codigo: codigoExibicao
    });
  }

  var result = JSON.stringify({ status: "OK", agenda: agenda, isAdmin: isAdmin });

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

    var tz           = ss.getSpreadsheetTimeZone();
    var data         = sheet.getDataRange().getValues();
    var providedPass = ((updates[0].password) || "").toString().trim();
    var callerIsAdmin = (providedPass === ADMIN_PASSWORD.trim());

    var savedCount = 0;

    for (var u = 0; u < updates.length; u++) {
      var update     = updates[u];
      var targetDate = (update.data    || "").toString().trim();
      var targetTime = (update.horario || "").toString().trim();
      var newStatus  = (update.status  || "").toString().trim();
      var newClient  = (update.cliente || "").toString().trim();
      var newPhone   = (update.telefone || "").toString().trim();
      var newCodigo  = (update.codigo   || "").toString().trim();

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
        if (newCodigo) sheet.getRange(foundRow + 1, 6).setValue(newCodigo); // Coluna F
      } else {
        sheet.appendRow([targetDate, targetTime, newStatus, newClient, newPhone, newCodigo]);
      }

      savedCount++;
    }

    return jsonResponse("OK", savedCount + " registro(s) salvo(s).");

  } catch (err) {
    return jsonResponse("ERRO", "Erro interno: " + err.message);
  }
}

function jsonResponse(status, msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: status, message: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}
