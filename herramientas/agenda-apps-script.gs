
function instalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'enviarAgenda') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('enviarAgenda').timeBased().everyMinutes(10).create();
  PropertiesService.getScriptProperties().deleteProperty('HUELLA');
  enviarAgenda();
}

function enviarAgenda() {
  const props = PropertiesService.getScriptProperties(), hook = props.getProperty('SLACK_WEBHOOK');
  if (!hook) throw new Error('Falta SLACK_WEBHOOK en las propiedades del script');
  const ini = new Date(); ini.setHours(0, 0, 0, 0);
  const fin = new Date(ini.getTime() + 2 * 86400000);
  let lista; try { lista = conApi_(ini, fin); } catch (err) { lista = sinApi_(ini, fin); }
  const json = JSON.stringify(lista), huella = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, json + ini.getTime()));
  const ultima = +(props.getProperty('ULTIMA') || 0);
  if (huella === props.getProperty('HUELLA') && Date.now() - ultima < 6 * 3600000) return;   // nada nuevo
  const r = UrlFetchApp.fetch(hook, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ text: '📅 Agenda de Humano (automática, para la oficina; no contestar)\n```' + json + '```' }) });
  if (r.getResponseCode() !== 200) throw new Error('Slack respondió ' + r.getResponseCode() + ': ' + r.getContentText());
  props.setProperty('HUELLA', huella); props.setProperty('ULTIMA', String(Date.now()));
}

function conApi_(ini, fin) {
  const r = Calendar.Events.list('primary', { timeMin: ini.toISOString(), timeMax: fin.toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 100 });
  return (r.items || []).filter(function (ev) {
    if (ev.status === 'cancelled') return false;
    const yo = (ev.attendees || []).filter(function (a) { return a.self; })[0];
    return !(yo && yo.responseStatus === 'declined');
  }).map(function (ev) {
    const todoDia = !!(ev.start && ev.start.date);
    const t = todoDia ? diaLocal_(ev.start.date) : new Date(ev.start.dateTime).getTime();
    const f = todoDia ? diaLocal_(ev.end.date) : new Date(ev.end.dateTime).getTime();
    let meet = ev.hangoutLink || null;
    if (!meet && ev.conferenceData && ev.conferenceData.entryPoints) {
      const v = ev.conferenceData.entryPoints.filter(function (p) { return p.entryPointType === 'video'; })[0]; if (v) meet = v.uri;
    }
    return { t: t, fin: f, titulo: ev.summary || '(sin título)', todoDia: todoDia, meet: meet, lugar: ev.location || null, uid: ev.id };
  });
}

// Sin el servicio avanzado: CalendarApp (el enlace de Meet solo si está en la descripción o el lugar)
function sinApi_(ini, fin) {
  return CalendarApp.getDefaultCalendar().getEvents(ini, fin).filter(function (ev) {
    return ev.getMyStatus() !== CalendarApp.GuestStatus.NO;
  }).map(function (ev) {
    const txt = (ev.getLocation() || '') + ' ' + (ev.getDescription() || '');
    const m = txt.match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/i);
    return { t: ev.getStartTime().getTime(), fin: ev.getEndTime().getTime(), titulo: ev.getTitle(), todoDia: ev.isAllDayEvent(),
      meet: m ? m[0] : null, lugar: ev.getLocation() || null, uid: ev.getId() };
  });
}

function diaLocal_(s) { const p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).getTime(); }
