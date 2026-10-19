/* Till Count sums, all in whole pence so nothing rounds wrongly. Also loaded by the tests (module.exports).
   window.TillMoney */
(function (root) {
  'use strict';

  var NOTES = [
    { id: 'n5000', p: 5000, label: '£50' },
    { id: 'n2000', p: 2000, label: '£20' },
    { id: 'n1000', p: 1000, label: '£10' },
    { id: 'n500', p: 500, label: '£5' }
  ];
  var COINS = [
    { id: 'c200', p: 200, label: '£2' },
    { id: 'c100', p: 100, label: '£1' },
    { id: 'c50', p: 50, label: '50p' },
    { id: 'c20', p: 20, label: '20p' },
    { id: 'c10', p: 10, label: '10p' },
    { id: 'c5', p: 5, label: '5p' },
    { id: 'c2', p: 2, label: '2p' },
    { id: 'c1', p: 1, label: '1p' }
  ];
  var FLOATS = [5000, 7500];

  /* typed amount -> pence. '' -> null, not a sensible amount -> NaN.
     Takes 9.60, £9.60, 9.6, 9, 1,250.00 and 960p */
  function parseMoney(text) {
    var t = String(text == null ? '' : text).replace(/[£,\s]/g, '');
    if (!t) return null;
    var m = /^(\d+)p$/i.exec(t);
    if (m) return parseInt(m[1], 10);
    if (!/^(\d+\.?\d{0,2}|\.\d{1,2})$/.test(t)) return NaN;
    return Math.round(parseFloat(t) * 100);
  }

  /* typed number of coins -> whole number. '' -> null, anything else (5.5, -2, abc) -> NaN */
  function parseCount(text) {
    var t = String(text == null ? '' : text).replace(/[,\s]/g, '');
    if (!t) return null;
    if (!/^\d+$/.test(t)) return NaN;
    return parseInt(t, 10);
  }

  /* 123456 -> '£1,234.56', -3500 -> '−£35.00' */
  function money(pence) {
    var neg = pence < 0, p = Math.abs(Math.round(pence)), pounds = Math.floor(p / 100), pp = p % 100;
    var s = String(pounds).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '−' : '') + '£' + s + '.' + (pp < 10 ? '0' : '') + pp;
  }

  /* 960 -> '9.60', for putting back in a box */
  function plain(pence) {
    var p = Math.round(pence);
    return Math.floor(p / 100) + '.' + (p % 100 < 10 ? '0' : '') + (p % 100);
  }

  /* how many of a coin or note a value makes: {count, whole}. 110p of 20p -> {count: 5.5, whole: false} */
  function countOf(pence, each) {
    var c = pence / each;
    return { count: Math.round(c * 100) / 100, whole: pence % each === 0 };
  }

  /* rows: {id: pence or null} (the pence each row adds up to) -> {notes, coins, gross, net} */
  function totals(rows, floatPence) {
    var notes = 0, coins = 0;
    NOTES.forEach(function (d) { var v = rows[d.id]; if (typeof v === 'number' && isFinite(v)) notes += v; });
    COINS.forEach(function (d) { var v = rows[d.id]; if (typeof v === 'number' && isFinite(v)) coins += v; });
    return { notes: notes, coins: coins, gross: notes + coins, net: notes + coins - floatPence };
  }

  var api = { NOTES: NOTES, COINS: COINS, FLOATS: FLOATS, parseMoney: parseMoney, parseCount: parseCount, money: money, plain: plain, countOf: countOf, totals: totals };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TillMoney = api;
})(typeof window !== 'undefined' ? window : this);
