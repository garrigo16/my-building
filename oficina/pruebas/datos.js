// datos.js - ayudas para escribir casos de prueba con datos de MENTIRA (nunca mensajes reales: ver CONTRIBUIR.md).
// El reloj de las pruebas es fijo: T("hh:mm") es esa hora del día DIA.
"use strict";
const DIA = "2026-01-12";   // un lunes cualquiera
const T = (hms) => new (global.FechaReal || Date)(`${DIA}T${hms.length === 5 ? hms + ":00" : hms}`).getTime();
const ts = (hms) => (T(hms) / 1000).toFixed(6);
const m = (hms, quien, texto, extra) => ({ ts: ts(hms), quien, texto, menc: [], ...(extra || {}) });
// los logs del equipo, vacíos
const LOGS0 = () => ({ arranquesCursor: [], frenos: [], avisosCoo: [], sesionHilo: {}, lanzHilo: {}, cursorSlack: [], esperas: [], ultEsc: 0, lanz: [], timbreHilo: "", traspasos: [] });
module.exports = { DIA, T, ts, m, LOGS0 };
